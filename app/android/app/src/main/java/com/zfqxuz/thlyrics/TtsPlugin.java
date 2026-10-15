package com.zfqxuz.thlyrics;

import android.content.Intent;
import android.content.pm.PackageInfo;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import android.speech.tts.TextToSpeech;
import android.speech.tts.Voice;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Set;

/**
 * 发音朗读：走系统 TTS（本地语音包，离线免费）。
 *
 * 关键：很多国产引擎会“谎报”日语可用（列表里有个叫 ja 的嗓子），实际没有日语音库，
 * setLanguage 后还是拿中文嗓子读。这里只认真正的日语嗓子：
 * locale 的语言必须是 ja，且国家是 JP（或名字里写明 ja-jp/ja_jp），并排除 notInstalled。
 * 没有真嗓子就返回 ja:false，前端弹「没有日语语音包 → 去安装」，绝不拿中文凑合。
 *
 * 同时支持多引擎 / 多嗓子：engines() 列已装引擎，voices(engine) 列该引擎的嗓子，
 * speak({engine,voice}) 按用户选的来。
 */
@CapacitorPlugin(name = "Tts")
public class TtsPlugin extends Plugin {

    private TextToSpeech tts = null;
    private boolean ready = false;
    private String curEngine = "";       // 当前实例绑定的引擎；"" = 系统默认
    private String prefEngine = "";      // 用户偏好
    private String prefVoice = "";
    private Voice picked = null;
    private String pendingText = null;
    private PluginCall pendingCall = null;

    @Override
    public void load() {
        initTts("");
    }

    private void initTts(String engine) {
        try { if (tts != null) { tts.stop(); tts.shutdown(); } } catch (Throwable ignored) { /* 旧实例可能已经坏了 */ }
        tts = null; ready = false; picked = null;
        curEngine = engine == null ? "" : engine;
        try {
            tts = new TextToSpeech(getContext(), (status) -> {
                ready = status == TextToSpeech.SUCCESS;
                if (ready) {
                    try { tts.setLanguage(Locale.JAPANESE); } catch (Throwable ignored) { /* 有些引擎不支持 locale 查询 */ }
                    refreshVoice(prefVoice);
                }
                if (pendingCall != null) {                 // 引擎刚起：把等着的这次读完并回结果
                    PluginCall c = pendingCall; String tx = pendingText;
                    pendingCall = null; pendingText = null;
                    c.resolve(doSpeak(tx));
                }
            }, curEngine.isEmpty() ? null : curEngine);
        } catch (Throwable e) { tts = null; }
    }

    /** 我们信任的开源日语引擎：eSpeak NG（ja 嗓子是实日语） */
    private static final String TRUSTED_ENGINE = "com.reecedunn.espeak";

    /** 是不是“真日语”嗓子（讯飞那种 locale=ja 但没国家、名字就叫 ja 的不算） */
    private boolean genuine(Voice v, String engine) {
        try {
            Locale l = v.getLocale();
            if (l == null || !"ja".equals(l.getLanguage())) return false;
            Set<String> f = v.getFeatures();
            if (f != null && f.contains(TextToSpeech.Engine.KEY_FEATURE_NOT_INSTALLED)) return false;
            if (TRUSTED_ENGINE.equals(engine)) return true;
            String name = String.valueOf(v.getName()).toLowerCase(Locale.ROOT);
            return "JP".equalsIgnoreCase(l.getCountry()) || name.contains("ja-jp") || name.contains("ja_jp");
        } catch (Throwable e) { return false; }
    }

    /** 探测一个信任引擎是否能按名字设置日语嗓子（eSpeak 不报 voices，只能这样验） */
    private boolean probeJa(TextToSpeech t) {
        try {
            java.util.Set<String> feats = new java.util.HashSet<>();
            t.setVoice(new Voice("ja", Locale.JAPANESE, Voice.QUALITY_NORMAL, Voice.LATENCY_NORMAL, false, feats));
            return true;
        } catch (Throwable e) { return false; }
    }

    private List<Voice> jaVoices(String engine) {
        List<Voice> out = new ArrayList<>();
        try { for (Voice v : tts.getVoices()) if (genuine(v, engine)) out.add(v); } catch (Throwable ignored) { /* 列不出来就当没有 */ }
        return out;
    }

    private void refreshVoice(String want) {
        picked = null;
        List<Voice> vs = jaVoices(curEngine);
        if (vs.isEmpty()) return;
        if (want != null && !want.isEmpty()) {
            for (Voice v : vs) if (String.valueOf(v.getName()).equals(want)) { picked = v; break; }
        }
        if (picked == null) picked = vs.get(0);
    }

    private JSObject doSpeak(String text) {
        JSObject out = new JSObject();
        out.put("ok", true);
        out.put("engine", curEngine);
        if (tts == null || !ready) { out.put("ja", false); out.put("error", "语音引擎还没就绪"); return out; }
        if (picked == null || (!prefVoice.isEmpty() && !String.valueOf(picked.getName()).equals(prefVoice))) refreshVoice(prefVoice);
        if (picked == null) {
            // eSpeak NG 这类引擎不实现 getVoices()，但能按语言/嗓子名字合成；信任引擎走兜底
            if (TRUSTED_ENGINE.equals(curEngine)) {
                // eSpeak 这类引擎不报 voices，但底层认嗓子名；探测成功后按 ja 合成
                String err = "probe failed";
                if (probeJa(tts)) {
                    try {
                        tts.setSpeechRate(0.9f);
                        if (text != null && !text.trim().isEmpty()) tts.speak(text, TextToSpeech.QUEUE_FLUSH, null, "thlyrics");
                        out.put("ja", true);
                        out.put("voice", "ja");
                        return out;
                    } catch (Throwable e) { err = String.valueOf(e.getMessage()); }
                }
                out.put("ja", false); out.put("voice", ""); out.put("error", err);
                return out;
            }
            out.put("ja", false); out.put("voice", ""); return out;   // 没有真日语嗓子：不出声
        }
        try {
            int a = tts.setLanguage(Locale.JAPANESE);
            boolean trusted = TRUSTED_ENGINE.equals(curEngine);
            if (!trusted && (a == TextToSpeech.LANG_MISSING_DATA || a == TextToSpeech.LANG_NOT_SUPPORTED)) { out.put("ja", false); return out; }
            tts.setVoice(picked);           // 指定嗓子放在 setLanguage 之后，避免被默认嗓子顶掉
            tts.setSpeechRate(0.9f);
            if (text != null && !text.trim().isEmpty()) tts.speak(text, TextToSpeech.QUEUE_FLUSH, null, "thlyrics");
            out.put("ja", true);
            out.put("voice", picked.getName());
        } catch (Throwable e) {
            out.put("ok", false); out.put("ja", false); out.put("error", String.valueOf(e.getMessage()));
        }
        return out;
    }

    @PluginMethod
    public void speak(PluginCall call) {
        String text = call.getString("text", "");
        if (text == null || text.trim().isEmpty()) { call.reject("没有要读的内容"); return; }
        String engine = call.getString("engine", "");
        String voice = call.getString("voice", "");
        prefEngine = engine == null ? "" : engine;
        prefVoice = voice == null ? "" : voice;
        if (!prefEngine.equals(curEngine)) {               // 换引擎：重挂，就绪后补读
            pendingText = text; pendingCall = call;
            initTts(prefEngine);
            return;
        }
        if (!ready) { pendingText = text; pendingCall = call; return; }
        JSObject out = doSpeak(text);
        call.resolve(out);
    }

    @PluginMethod
    public void engines(PluginCall call) {
        JSObject out = new JSObject();
        JSONArray arr = new JSONArray();
        try {
            String def = "";
            if (tts != null) {
                try { def = tts.getDefaultEngine(); } catch (Throwable ignored) { /* 旧引擎可能没有 */ }
                for (TextToSpeech.EngineInfo e : tts.getEngines()) {
                    JSONObject o = new JSONObject();
                    o.put("name", e.name == null ? "" : e.name);
                    o.put("label", e.label == null ? "" : e.label);
                    o.put("def", e.name != null && e.name.equals(def));
                    arr.put(o);
                }
            }
            out.put("default", def == null ? "" : def);
        } catch (Throwable e) {
            out.put("error", String.valueOf(e.getMessage()));
        }
        out.put("ok", true);
        out.put("engines", arr);
        call.resolve(out);
    }

    private JSONArray voicesOf(TextToSpeech t, String engine) {
        JSONArray arr = new JSONArray();
        try {
            for (Voice v : t.getVoices()) {
                JSONObject o = new JSONObject();
                Locale l = v.getLocale();
                o.put("name", v.getName());
                o.put("locale", l == null ? "" : l.toString());
                o.put("quality", v.getQuality());
                o.put("latency", v.getLatency());
                o.put("network", v.isNetworkConnectionRequired());
                Set<String> f = v.getFeatures();
                o.put("features", f == null ? new JSONArray() : new JSONArray(new ArrayList<>(f)));
                o.put("ja", l != null && "ja".equals(l.getLanguage()));
                o.put("genuine", genuine(v, engine));
                arr.put(o);
            }
        } catch (Throwable ignored) { /* 引擎不实现就返回空表 */ }
        return arr;
    }

    @PluginMethod
    public void voices(PluginCall call) {
        String engine0 = call.getString("engine", "");
        final String engine = engine0 == null ? "" : engine0;
        if (engine.isEmpty() || engine.equals(curEngine)) {
            JSObject out = new JSObject();
            out.put("ok", true); out.put("engine", curEngine); out.put("voices", voicesOf(tts, curEngine));
            boolean trusted = TRUSTED_ENGINE.equals(curEngine) && (jaVoices(curEngine).size() > 0 || probeJa(tts));
            out.put("trusted", trusted);
            call.resolve(out);
            return;
        }
        final TextToSpeech[] holder = new TextToSpeech[1];
        try {
            holder[0] = new TextToSpeech(getContext(), (status) -> {
                TextToSpeech tmp = holder[0];
                if (status == TextToSpeech.SUCCESS && tmp != null) {
                    try { tmp.setLanguage(Locale.JAPANESE); } catch (Throwable ignored) { /* 忽略 */ }
                }
                JSObject out = new JSObject();
                out.put("ok", status == TextToSpeech.SUCCESS);
                out.put("engine", engine);
                boolean trusted = TRUSTED_ENGINE.equals(engine) && status == TextToSpeech.SUCCESS && tmp != null
                        && (jaVoices(engine).size() > 0 || probeJa(tmp));
                out.put("trusted", trusted);
                out.put("voices", status == TextToSpeech.SUCCESS && tmp != null ? voicesOf(tmp, engine) : new JSONArray());
                try { if (tmp != null) tmp.shutdown(); } catch (Throwable ignored) { /* 忽略 */ }
                call.resolve(out);
            }, engine);
        } catch (Throwable e) {
            call.reject("列不出嗓子：" + String.valueOf(e.getMessage()));
        }
    }

    /** 查某个语音引擎包的安装状态/版本（App 内语音包页用） */
    @PluginMethod
    public void packInfo(PluginCall call) {
        String pkg = call.getString("pkg", "");
        JSObject out = new JSObject();
        out.put("ok", true);
        try {
            if (pkg == null || pkg.trim().isEmpty()) { out.put("installed", false); call.resolve(out); return; }
            PackageInfo pi = getContext().getPackageManager().getPackageInfo(pkg, 0);
            out.put("installed", true);
            out.put("versionName", pi.versionName == null ? "" : pi.versionName);
            long vc;
            if (Build.VERSION.SDK_INT >= 28) vc = pi.getLongVersionCode(); else vc = pi.versionCode;
            out.put("versionCode", vc);
        } catch (Throwable e) {
            out.put("installed", false);
        }
        call.resolve(out);
    }

    /** 打开系统「文字转语音」设置（选引擎/下语音数据） */
    @PluginMethod
    public void openSettings(PluginCall call) {
        try {
            Intent i = new Intent("com.android.settings.TTS_SETTINGS");
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(i);
            call.resolve();
        } catch (Throwable e) {
            call.reject("打不开文字转语音设置");
        }
    }

    /** 打开某引擎的应用详情页（更新/清数据/权限都在这） */
    @PluginMethod
    public void appInfo(PluginCall call) {
        String pkg = String.valueOf(call.getString("pkg", ""));
        if (pkg == null || pkg.trim().isEmpty()) { call.reject("缺 pkg"); return; }
        try {
            Intent i = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + pkg));
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(i);
            call.resolve();
        } catch (Throwable e) {
            call.reject("打不开应用详情页");
        }
    }

    /** 卸载某语音引擎：系统卸载确认页（非静默，用户点确认） */
    @PluginMethod
    public void uninstall(PluginCall call) {
        String pkg = String.valueOf(call.getString("pkg", ""));
        if (pkg == null || pkg.trim().isEmpty()) { call.reject("缺 pkg"); return; }
        try {
            Intent i = new Intent(Intent.ACTION_DELETE, Uri.parse("package:" + pkg));
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(i);
            call.resolve();
            return;
        } catch (Throwable ignored) { /* 换下一种入口 */ }
        try {
            Intent i = new Intent(Intent.ACTION_UNINSTALL_PACKAGE, Uri.parse("package:" + pkg));
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(i);
            call.resolve();
        } catch (Throwable e) {
            call.reject("打不开卸载页");
        }
    }

    /** 去官方商店页面（更新/首次安装）：优先 Play 商店，其次官方网页，最后 market 协议 */
    @PluginMethod
    public void openStore(PluginCall call) {
        String pkg = String.valueOf(call.getString("pkg", ""));
        if (pkg == null || pkg.trim().isEmpty()) { call.reject("缺 pkg"); return; }
        String web = "https://play.google.com/store/apps/details?id=" + pkg;
        try {
            Intent i = new Intent(Intent.ACTION_VIEW, Uri.parse(web));
            i.setPackage("com.android.vending");                  // 只交给 Play，避免 market:// 被第三方商店抢
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(i);
            call.resolve();
            return;
        } catch (Throwable ignored) { /* 没 Play 就开网页 */ }
        try {
            Intent i = new Intent(Intent.ACTION_VIEW, Uri.parse(web));
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(i);
            call.resolve();
            return;
        } catch (Throwable ignored) { /* 再看 market */ }
        try {
            Intent i = new Intent(Intent.ACTION_VIEW, Uri.parse("market://details?id=" + pkg));
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(i);
            call.resolve();
        } catch (Throwable e) {
            call.reject("打不开商店页面");
        }
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

    @Override
    protected void handleOnDestroy() {
        try { if (tts != null) { tts.stop(); tts.shutdown(); } } catch (Throwable ignored) {}
        tts = null;
    }
}
