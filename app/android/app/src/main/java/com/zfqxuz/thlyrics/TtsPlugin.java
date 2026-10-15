package com.zfqxuz.thlyrics;

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
            });
        } catch (Throwable e) { tts = null; }
    }

    @PluginMethod
    public void speak(PluginCall call) {
        String text = call.getString("text", "");
        if (text == null || text.trim().isEmpty()) { call.reject("没有要读的内容"); return; }
        JSObject out = new JSObject();
        out.put("ok", true);
        out.put("ja", jaOk);
        if (!ready) { pending = text; call.resolve(out); return; }   // 引擎刚起，就绪后自动补读
        speakNow(text);
        call.resolve(out);
    }

    private void speakNow(String text) {
        try {
            tts.setLanguage(Locale.JAPANESE);
            tts.speak(text, TextToSpeech.QUEUE_FLUSH, null, "thlyrics");
        } catch (Throwable ignored) { /* 忽略：读不出来也不该崩 */ }
    }

    @Override
    protected void handleOnDestroy() {
        try { if (tts != null) { tts.stop(); tts.shutdown(); } } catch (Throwable ignored) {}
        tts = null;
    }
}
