package com.zfqxuz.thlyrics;

import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;

import androidx.core.content.FileProvider;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/**
 * App 自更新：下载新版 APK 并拉起系统安装界面。
 * 用法（JS）：AppUpdater.install({ url, version }) → 进度走 'progress' 事件（pct 0-100）→ 'done' / 'error'。
 * 前提：签名一致（同一个 keystore 出的包才能覆盖安装），以及用户允许「安装未知应用」。
 * 只用于自用分发，不上架商店。
 */
@CapacitorPlugin(name = "AppUpdater")
public class AppUpdaterPlugin extends Plugin {

    @PluginMethod
    public void install(PluginCall call) {
        String url = call.getString("url");
        if (url == null || url.trim().isEmpty()) { call.reject("没有下载地址"); return; }
        final String version = call.getString("version", "update");
        // Android 8+ 装未知来源的包要先在系统设置里授权，否则点安装会被静默拒绝
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && !getContext().getPackageManager().canRequestPackageInstalls()) {
            try {
                Intent i = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                        Uri.parse("package:" + getContext().getPackageName()));
                getActivity().startActivity(i);
            } catch (Throwable ignored) { /* 有些 ROM 没这个页面 */ }
            call.reject("需要先允许「安装未知应用」：在刚弹出的设置里打开开关，再回来点一次");
            return;
        }
        call.resolve();                                    // 先回话，下载在后台线程跑
        final String u = url.trim();
        new Thread(() -> {
            try {
                File dir = new File(getContext().getCacheDir(), "update");
                if (!dir.exists() && !dir.mkdirs()) throw new Exception("建不了缓存目录");
                File apk = new File(dir, "thlyrics-" + version + ".apk");
                HttpURLConnection conn = (HttpURLConnection) new URL(u).openConnection();
                conn.setInstanceFollowRedirects(true);
                conn.setConnectTimeout(20000);
                conn.setReadTimeout(30000);
                // OSS 桶开了来源白名单：原生下载默认不带 Referer 会被 403，这里带一个白名单内的来源
                conn.setRequestProperty("Referer", "https://zfqxuz.github.io/");
                conn.connect();
                int code = conn.getResponseCode();
                if (code != 200) throw new Exception("下载失败 HTTP " + code);
                int total = conn.getContentLength();
                long got = 0;
                int lastPct = -1;
                try (InputStream in = conn.getInputStream(); FileOutputStream out = new FileOutputStream(apk)) {
                    byte[] buf = new byte[64 * 1024];
                    int n;
                    while ((n = in.read(buf)) > 0) {
                        out.write(buf, 0, n);
                        got += n;
                        if (total > 0) {
                            int pct = (int) (got * 100 / total);
                            if (pct != lastPct) {
                                lastPct = pct;
                                JSObject o = new JSObject();
                                o.put("pct", pct);
                                notifyListeners("progress", o);
                            }
                        }
                    }
                }
                final File done = apk;
                getActivity().runOnUiThread(() -> {
                    try {
                        install(done);
                        JSObject o = new JSObject();
                        o.put("path", done.getAbsolutePath());
                        notifyListeners("done", o);
                    } catch (Throwable e) {
                        JSObject o = new JSObject();
                        o.put("message", String.valueOf(e.getMessage()));
                        notifyListeners("error", o);
                    }
                });
            } catch (Throwable e) {
                JSObject o = new JSObject();
                o.put("message", String.valueOf(e.getMessage()));
                notifyListeners("error", o);
            }
        }).start();
    }

    /** 用 FileProvider 把私有目录里的 APK 交给系统安装器（file_paths.xml 已覆盖 cache 目录） */
    private void install(File apk) {
        Uri uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", apk);
        Intent i = new Intent(Intent.ACTION_VIEW);
        i.setDataAndType(uri, "application/vnd.android.package-archive");
        i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(i);
    }
}
