package com.zfqxuz.thlyrics;

import android.content.Intent;
import android.net.Uri;
import android.speech.tts.TextToSpeech;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.Locale;

/**
 * 发音朗读：走安卓自带的 TTS（TextToSpeech）。
 * 为什么必须原生：Android WebView **不支持** Web Speech API（speechSynthesis），
 * 网页端那句 speak() 在壳里点下去永远没声音（用户反馈）。
 * 返回 { ok, ja }：ja=false 表示系统里没装日语语音包，前端提示去系统设置装。
 */
@CapacitorPlugin(name = "Tts")
public class TtsPlugin extends Plugin {

    private TextToSpeech tts = null;
    private boolean ready = false;
    private String pending = null;
    private PluginCall pendingCall = null;
    private boolean jaOk = false;

    @Override
    public void load() {
        try {
            tts = new TextToSpeech(getContext(), (status) -> {
                ready = status == TextToSpeech.SUCCESS;
                if (ready) {
                    try {
                        int a = tts.isLanguageAvailable(Locale.JAPANESE);
                        jaOk = a == TextToSpeech.LANG_AVAILABLE || a == TextToSpeech.LANG_COUNTRY_AVAILABLE
                                || a == TextToSpeech.LANG_COUNTRY_VAR_AVAILABLE;
                        tts.setLanguage(Locale.JAPANESE);
                        tts.setSpeechRate(0.9f);
                    } catch (Throwable ignored) { /* 引擎怪就怪吧，别把 App 带崩 */ }
                }
                if (ready && pending != null) { speakNow(pending); pending = null; }
                if (pendingCall != null) {
                    JSObject o = new JSObject();
                    o.put("ok", ready);
                    o.put("ja", jaOk);
                    pendingCall.resolve(o);
                    pendingCall = null;
                }
            });
        } catch (Throwable e) { tts = null; }
    }

    @PluginMethod
    public void speak(PluginCall call) {
        String text = call.getString("text", "");
        if (text == null || text.trim().isEmpty()) { call.reject("没有要读的内容"); return; }
        if (!ready) { pending = text; pendingCall = call; return; }   // 引擎刚起：就绪后再回结果并补读
        JSObject out = new JSObject();
        out.put("ok", true);
        out.put("ja", jaOk);
        speakNow(text);
        call.resolve(out);
    }

    /** 打开系统语音数据安装入口：系统 TTS 安装页 → TTS 设置 → 应用商店（App 不能静默装语音包） */
    @PluginMethod
    public void openInstall(PluginCall call) {
        try {
            Intent i = new Intent(TextToSpeech.Engine.ACTION_INSTALL_TTS_DATA);
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(i);
            call.resolve();
            return;
        } catch (Throwable ignored) { /* 换下一种入口 */ }
        try {
            Intent i = new Intent("com.android.settings.TTS_SETTINGS");
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(i);
            call.resolve();
            return;
        } catch (Throwable ignored) { /* 换下一种入口 */ }
        try {
            Intent i = new Intent(Intent.ACTION_VIEW, Uri.parse("market://details?id=com.google.android.tts"));
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(i);
            call.resolve();
        } catch (Throwable e) {
            call.reject("打不开语音包安装页");
        }
    }

    private void speakNow(String text) {
        try {
            // 关键：只认日语。没有日语包时 setLanguage 会失败并退回默认语言（中文），
            // 跟着 speak 就会把日文汉字按中文读出来 —— 用户反馈的"发音是中文"。
            int a = tts.setLanguage(Locale.JAPANESE);
            boolean ok = a == TextToSpeech.LANG_AVAILABLE || a == TextToSpeech.LANG_COUNTRY_AVAILABLE
                    || a == TextToSpeech.LANG_COUNTRY_VAR_AVAILABLE;
            jaOk = ok;
            if (!ok) return;                       // 没日语包就不出声，前端会提示去装
            tts.speak(text, TextToSpeech.QUEUE_FLUSH, null, "thlyrics");
        } catch (Throwable ignored) { /* 忽略：读不出来也不该崩 */ }
    }

    @Override
    protected void handleOnDestroy() {
        try { if (tts != null) { tts.stop(); tts.shutdown(); } } catch (Throwable ignored) {}
        tts = null;
    }
}
