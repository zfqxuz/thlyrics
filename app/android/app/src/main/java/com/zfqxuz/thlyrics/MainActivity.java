package com.zfqxuz.thlyrics;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(MediaSessionPlugin.class);
        registerPlugin(AppUpdaterPlugin.class);
        registerPlugin(TtsPlugin.class);
        registerPlugin(LocalAudioPlugin.class);
        registerPlugin(BackPlugin.class);
        super.onCreate(savedInstanceState);
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
