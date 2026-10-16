/*
 * 自建离线日语发音：Open JTalk（BSD）+ NAIST-jdic + HTS voice（放 App 沙盒的数据包）。
 * 引擎在 APK 里，数据（词典 + 嗓子）由 App 下载解压，不装系统 TTS、不依赖 Google。
 *
 * 这里只做三件事：装载(dicDir + htsvoice)、合成一段文本到 WAV、卸载。
 * Java 侧 VoicePackPlugin 负责数据包下载/解压/路径管理，并保证调用串行。
 */
#include <jni.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <pthread.h>

#include "mecab.h"
#include "njd.h"
#include "jpcommon.h"
#include "HTS_engine.h"
#include "text2mecab.h"
#include "mecab2njd.h"
#include "njd2jpcommon.h"
#include "njd_set_pronunciation.h"
#include "njd_set_digit.h"
#include "njd_set_accent_phrase.h"
#include "njd_set_accent_type.h"
#include "njd_set_unvoiced_vowel.h"
#include "njd_set_long_vowel.h"

typedef struct {
  Mecab mecab;
  NJD njd;
  JPCommon jpcommon;
  HTS_Engine engine;
} JTalk;

static JTalk g_jt;
static int g_ready = 0;
static char g_dic[2048];
static char g_voice[2048];
static pthread_mutex_t g_lock = PTHREAD_MUTEX_INITIALIZER;

static void jt_clear(void) {
  if (g_ready) {
    Mecab_clear(&g_jt.mecab);
    NJD_clear(&g_jt.njd);
    JPCommon_clear(&g_jt.jpcommon);
    HTS_Engine_clear(&g_jt.engine);
  } else {
    /* 初始化过的也可能装载失败，仍要清一遍，避免半初始化状态泄漏 */
    Mecab_clear(&g_jt.mecab);
    NJD_clear(&g_jt.njd);
    JPCommon_clear(&g_jt.jpcommon);
    HTS_Engine_clear(&g_jt.engine);
  }
  g_ready = 0;
  g_dic[0] = '\0';
  g_voice[0] = '\0';
}

static int jt_load(const char *dicdir, const char *voicefile) {
  if (g_ready && strcmp(g_dic, dicdir) == 0 && strcmp(g_voice, voicefile) == 0) return 1;
  if (g_ready) jt_clear();
  if (!dicdir || !*dicdir || !voicefile || !*voicefile) return 0;

  Mecab_initialize(&g_jt.mecab);
  NJD_initialize(&g_jt.njd);
  JPCommon_initialize(&g_jt.jpcommon);
  HTS_Engine_initialize(&g_jt.engine);

  if (Mecab_load(&g_jt.mecab, dicdir) != TRUE) { jt_clear(); return 0; }
  char *voices[1];
  voices[0] = (char *)voicefile;
  if (HTS_Engine_load(&g_jt.engine, voices, 1) != TRUE) { jt_clear(); return 0; }
  if (strcmp(HTS_Engine_get_fullcontext_label_format(&g_jt.engine), "HTS_TTS_JPN") != 0) { jt_clear(); return 0; }

  snprintf(g_dic, sizeof(g_dic), "%s", dicdir);
  snprintf(g_voice, sizeof(g_voice), "%s", voicefile);
  g_ready = 1;
  return 1;
}

static int jt_synth(const char *text, const char *outpath) {
  if (!g_ready || !text || !outpath) return 0;
  size_t n = strlen(text);
  if (n == 0 || n > 4096) return 0;

  char *buff = (char *)calloc(n * 4 + 32, 1);
  if (!buff) return 0;

  int ok = 0;
  FILE *fp = NULL;
  text2mecab(buff, text);
  Mecab_analysis(&g_jt.mecab, buff);
  mecab2njd(&g_jt.njd, Mecab_get_feature(&g_jt.mecab), Mecab_get_size(&g_jt.mecab));
  njd_set_pronunciation(&g_jt.njd);
  njd_set_digit(&g_jt.njd);
  njd_set_accent_phrase(&g_jt.njd);
  njd_set_accent_type(&g_jt.njd);
  njd_set_unvoiced_vowel(&g_jt.njd);
  njd_set_long_vowel(&g_jt.njd);
  njd2jpcommon(&g_jt.jpcommon, &g_jt.njd);
  JPCommon_make_label(&g_jt.jpcommon);

  if (JPCommon_get_label_size(&g_jt.jpcommon) > 2) {
    if (HTS_Engine_synthesize_from_strings(&g_jt.engine, JPCommon_get_label_feature(&g_jt.jpcommon), JPCommon_get_label_size(&g_jt.jpcommon)) == TRUE) {
      fp = fopen(outpath, "wb");
      if (fp) {
        HTS_Engine_save_riff(&g_jt.engine, fp);
        fclose(fp);
        ok = 1;
      }
    }
  }

  HTS_Engine_refresh(&g_jt.engine);
  JPCommon_refresh(&g_jt.jpcommon);
  NJD_refresh(&g_jt.njd);
  Mecab_refresh(&g_jt.mecab);
  free(buff);
  return ok;
}

JNIEXPORT jboolean JNICALL
Java_com_zfqxuz_thlyrics_VoicePackPlugin_nativeInit(JNIEnv *env, jobject thiz, jstring dic, jstring voice) {
  (void)thiz;
  const char *dicdir = dic ? (*env)->GetStringUTFChars(env, dic, NULL) : NULL;
  const char *voicefile = voice ? (*env)->GetStringUTFChars(env, voice, NULL) : NULL;
  pthread_mutex_lock(&g_lock);
  int ok = jt_load(dicdir, voicefile);
  pthread_mutex_unlock(&g_lock);
  if (dicdir) (*env)->ReleaseStringUTFChars(env, dic, dicdir);
  if (voicefile) (*env)->ReleaseStringUTFChars(env, voice, voicefile);
  return ok ? JNI_TRUE : JNI_FALSE;
}

JNIEXPORT jboolean JNICALL
Java_com_zfqxuz_thlyrics_VoicePackPlugin_nativeLoaded(JNIEnv *env, jobject thiz) {
  (void)env; (void)thiz;
  return g_ready ? JNI_TRUE : JNI_FALSE;
}

JNIEXPORT jboolean JNICALL
Java_com_zfqxuz_thlyrics_VoicePackPlugin_nativeSynth(JNIEnv *env, jobject thiz, jstring text, jstring out) {
  (void)thiz;
  if (!text || !out) return JNI_FALSE;
  const char *txt = (*env)->GetStringUTFChars(env, text, NULL);
  const char *outpath = (*env)->GetStringUTFChars(env, out, NULL);
  pthread_mutex_lock(&g_lock);
  int ok = jt_synth(txt, outpath);
  pthread_mutex_unlock(&g_lock);
  if (txt) (*env)->ReleaseStringUTFChars(env, text, txt);
  if (outpath) (*env)->ReleaseStringUTFChars(env, out, outpath);
  return ok ? JNI_TRUE : JNI_FALSE;
}

JNIEXPORT jstring JNICALL
Java_com_zfqxuz_thlyrics_VoicePackPlugin_nativeVersion(JNIEnv *env, jobject thiz) {
  (void)thiz;
  return (*env)->NewStringUTF(env, "Open JTalk 1.11 / MeCab 0.996 / HTS Engine 1.10");
}
