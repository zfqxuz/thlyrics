package com.zfqxuz.thlyrics;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(MediaSessionPlugin.class);
        registerPlugin(AppUpdaterPlugin.class);
        registerPlugin(LocalAudioPlugin.class);
        registerPlugin(VoicePackPlugin.class);
        registerPlugin(BackPlugin.class);
        super.onCreate(savedInstanceState);
        debugHooks();
    }

    /** 真机自检（debug）：--es vptest "こんにちは"（合成）/ --es vpinstall 1（按 assets 清单下载数据包） */
    private void debugHooks() {
        boolean debuggable = (getApplicationInfo().flags & android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE) != 0;
        if (!debuggable || getIntent() == null) return;
        final String vt = getIntent().getStringExtra("vptest");
        final String vi = getIntent().getStringExtra("vpinstall");
        if (vt == null && vi == null) return;
        new Thread(() -> {
            String r;
            try {
                VoicePackPlugin vp = (VoicePackPlugin) getBridge().getPlugin("VoicePack").getInstance();
                if (vi != null) {
                    String[] cfg = packAsset(vi);
                    r = cfg == null ? "no-asset" : vp.debugInstall(cfg[4], cfg[0], cfg[1], cfg[2], cfg[3]);
                } else {
                    r = vp.debugSynth(vt);
                }
            } catch (Throwable e) {
                r = "hook-error " + e;
            }
            android.util.Log.i("THLYRICS", "VPDEBUG " + r);
        }).start();
    }

    /** 从打包进 APK 的 data/voice-packs.json 按 id 读语音包配置（id 传 "1" 取第一个） */
    private String[] packAsset(String id) {
        try (java.io.InputStream in = getAssets().open("public/data/voice-packs.json")) {
            byte[] b = new byte[in.available()];
            int n = in.read(b);
            org.json.JSONObject j = new org.json.JSONObject(new String(b, 0, Math.max(n, 0), "UTF-8"));
            org.json.JSONArray arr = j.getJSONArray("packs");
            org.json.JSONObject p = arr.getJSONObject(0);
            for (int i = 0; i < arr.length(); i++) {
                org.json.JSONObject x = arr.getJSONObject(i);
                if (x.optString("id").equals(id)) { p = x; break; }
            }
            return new String[] { p.optString("url"), p.optString("sha256"), p.optString("version"),
                    p.optString("kind", "ojt"), p.optString("id", "openjtalk-ja") };
        } catch (Throwable e) {
            return null;
        }
    }

    @Override
    public void onBackPressed() {
        // 一律先问网页：收抽屉 / 收播放器 / 详情页二次确认 / 最后退桌面，都由网页决定。
        // 不交给 super，否则详情页侧滑返回会直接把 Activity finish 掉（用户反馈的“直接回桌面”）。
        try {
            if (getBridge() != null && getBridge().getWebView() != null) {
                getBridge().eval("window.__tlOnBackPressed && window.__tlOnBackPressed();", null);
                return;
            }
        } catch (Throwable ignored) { /* 桥没起来时退回系统默认 */ }
        super.onBackPressed();
    }
}
