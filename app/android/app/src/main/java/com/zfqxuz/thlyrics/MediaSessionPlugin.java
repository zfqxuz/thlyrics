package com.zfqxuz.thlyrics;

import android.content.Intent;
import android.os.Build;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * JS ↔ 原生媒体会话的桥。
 * JS 侧每次播放状态变化调 update()，原生把它变成通知栏/锁屏的媒体卡片；
 * 用户按了播放/暂停/上一句/下一句，原生通过 action 事件回传给 JS 执行。
 */
@CapacitorPlugin(name = "MediaSession")
public class MediaSessionPlugin extends Plugin {
    private static MediaSessionPlugin inst;

    @Override public void load() { inst = this; }

    @PluginMethod
    public void update(PluginCall call) {
        try {
            Intent i = new Intent(getContext(), PlaybackService.class);
            i.putExtra("title", call.getString("title", ""));
            i.putExtra("artist", call.getString("artist", ""));
            i.putExtra("playing", Boolean.TRUE.equals(call.getBoolean("playing", false)));
            i.putExtra("position", orZero(call.getDouble("position")));
            i.putExtra("duration", orZero(call.getDouble("duration")));
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) getContext().startForegroundService(i);
            else getContext().startService(i);
            call.resolve();
        } catch (Throwable e) {
            call.reject(String.valueOf(e.getMessage()));
        }
    }

    @PluginMethod
    public void stop(PluginCall call) {
        try {
            getContext().stopService(new Intent(getContext(), PlaybackService.class));
            call.resolve();
        } catch (Throwable e) {
            call.reject(String.valueOf(e.getMessage()));
        }
    }

    private static double orZero(Double d) { return d == null ? 0 : d; }

    /** 由前台服务调用：把用户的媒体键操作回传给 JS */
    static void emit(String action, double position) {
        MediaSessionPlugin p = inst;
        if (p == null) return;
        try {
            JSObject o = new JSObject();
            o.put("action", action);
            if (position > 0) o.put("position", position);
            p.notifyListeners("action", o, true);
        } catch (Throwable ignored) {}
    }
}
