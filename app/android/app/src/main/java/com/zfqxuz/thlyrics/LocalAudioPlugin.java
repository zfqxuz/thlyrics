package com.zfqxuz.thlyrics;

import android.app.Activity;
import android.content.ContentResolver;
import android.database.Cursor;
import android.net.Uri;
import android.provider.OpenableColumns;

import androidx.activity.result.ActivityResult;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.security.MessageDigest;

/**
 * 本机音源：用系统文件选择器（SAF）选一个音频，复制进 App 私有沙盒。
 * 选文件不需要任何权限（SAF 是用户主动授权），落盘后在沙盒里离线可听、也不怕原文件被删。
 * 返回值给 JS：key（文件名）/ path（绝对路径）/ name（原名）/ size。
 */
@CapacitorPlugin(name = "LocalAudio")
public class LocalAudioPlugin extends Plugin {

    @PluginMethod
    public void pick(PluginCall call) {
        android.content.Intent i = new android.content.Intent(android.content.Intent.ACTION_OPEN_DOCUMENT);
        i.addCategory(android.content.Intent.CATEGORY_OPENABLE);
        i.setType("audio/*");
        i.putExtra(android.content.Intent.EXTRA_ALLOW_MULTIPLE, false);
        try {
            startActivityForResult(call, i, "pickResult");
        } catch (Throwable e) {
            call.reject("打不开文件选择器：" + e.getMessage());
        }
    }

    @ActivityCallback
    private void pickResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (result == null || result.getResultCode() != Activity.RESULT_OK
                || result.getData() == null || result.getData().getData() == null) {
            call.reject("没有选择文件");
            return;
        }
        InputStream in = null;
        FileOutputStream out = null;
        try {
            Uri uri = result.getData().getData();
            String name = displayName(uri);
            File dir = new File(getContext().getFilesDir(), "audio");
            if (!dir.exists() && !dir.mkdirs()) throw new Exception("建不了目录");
            String ext = name.contains(".") ? name.substring(name.lastIndexOf('.')) : "";
            File dst = new File(dir, sha1(uri.toString()).substring(0, 16) + ext);
            in = getContext().getContentResolver().openInputStream(uri);
            if (in == null) throw new Exception("读不到文件");
            out = new FileOutputStream(dst);
            byte[] buf = new byte[65536];
            long total = 0;
            int n;
            while ((n = in.read(buf)) > 0) { out.write(buf, 0, n); total += n; }
            out.flush();
            JSObject o = new JSObject();
            o.put("key", dst.getName());
            o.put("path", dst.getAbsolutePath());
            o.put("name", name);
            o.put("size", total);
            call.resolve(o);
        } catch (Throwable e) {
            call.reject("导入失败：" + String.valueOf(e.getMessage()));
        } finally {
            try { if (in != null) in.close(); } catch (Throwable ignored) {}
            try { if (out != null) out.close(); } catch (Throwable ignored) {}
        }
    }

    private String displayName(Uri uri) {
        ContentResolver cr = getContext().getContentResolver();
        Cursor c = null;
        try {
            c = cr.query(uri, null, null, null, null);
            if (c != null && c.moveToFirst()) {
                int idx = c.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                if (idx >= 0) {
                    String s = c.getString(idx);
                    if (s != null && !s.isEmpty()) return s;
                }
            }
        } catch (Throwable ignored) {
        } finally { try { if (c != null) c.close(); } catch (Throwable ignored) {} }
        String last = uri.getLastPathSegment();
        return last == null ? "audio" : last;
    }

    private String sha1(String s) {
        try {
            MessageDigest md = MessageDigest.getInstance("SHA-1");
            byte[] d = md.digest(s.getBytes("UTF-8"));
            StringBuilder sb = new StringBuilder();
            for (byte b : d) sb.append(String.format("%02x", b));
            return sb.toString();
        } catch (Throwable e) { return String.valueOf(s.hashCode()); }
    }
}
