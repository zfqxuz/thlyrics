package com.zfqxuz.thlyrics;

import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.WindowManager;

import androidx.core.view.WindowCompat;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // 让 webview 延伸到状态栏 / 导航栏：CSS 里用 env(safe-area-inset-*) 自动适配
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        getWindow().setStatusBarColor(Color.TRANSPARENT);
        getWindow().setNavigationBarColor(Color.TRANSPARENT);
        // 状态栏图标 = 深色（warm 主题背景是浅纸色；dark 主题时 webview 会重设文字色）
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            var ctrl = WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
            ctrl.setAppearanceLightStatusBars(true);
            ctrl.setAppearanceLightNavigationBars(true);
        } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            getWindow().getDecorView().setSystemUiVisibility(
                View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR | View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR);
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            getWindow().setNavigationBarContrastEnforced(false);
            getWindow().setStatusBarContrastEnforced(false);
        }
        registerPlugin(MediaSessionPlugin.class);
        registerPlugin(AppUpdaterPlugin.class);
        registerPlugin(LocalAudioPlugin.class);
        registerPlugin(VoicePackPlugin.class);
        registerPlugin(BackPlugin.class);
        registerPlugin(TtsPlugin.class);
        registerPlugin(ImageSavePlugin.class);
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
