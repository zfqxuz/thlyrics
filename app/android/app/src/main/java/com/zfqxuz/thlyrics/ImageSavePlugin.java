package com.zfqxuz.thlyrics;

import android.content.ContentValues;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;

/**
 * 把二维码（data:image/png;base64,...）存进系统相册。
 * 用途：网易云扫码登录 —— 手机上没法自己扫自己，只能存图后去「扫一扫 → 相册」选它。
 */
@CapacitorPlugin(name = "ImageSave")
public class ImageSavePlugin extends Plugin {

    @PluginMethod
    public void save(PluginCall call) {
        String dataUrl = String.valueOf(call.getString("data", ""));
        String name = String.valueOf(call.getString("name", "qr"));
        int comma = dataUrl.indexOf(',');
        if (comma < 0) { call.reject("不是图片数据"); return; }
        try {
            byte[] bytes = Base64.decode(dataUrl.substring(comma + 1), Base64.DEFAULT);
            Bitmap bmp = BitmapFactory.decodeByteArray(bytes, 0, bytes.length);
            if (bmp == null) { call.reject("图片解码失败"); return; }
            String fileName = name + "-" + System.currentTimeMillis() + ".png";
            Uri uri;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                ContentValues cv = new ContentValues();
                cv.put(MediaStore.Images.Media.DISPLAY_NAME, fileName);
                cv.put(MediaStore.Images.Media.MIME_TYPE, "image/png");
                cv.put(MediaStore.Images.Media.RELATIVE_PATH, Environment.DIRECTORY_PICTURES + "/thlyrics");
                uri = getContext().getContentResolver().insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, cv);
                if (uri == null) { call.reject("写入相册失败"); return; }
                try (OutputStream out = getContext().getContentResolver().openOutputStream(uri)) {
                    if (out == null) { call.reject("写入相册失败"); return; }
                    bmp.compress(Bitmap.CompressFormat.PNG, 100, out);
                }
            } else {
                File dir = new File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_PICTURES), "thlyrics");
                if (!dir.exists() && !dir.mkdirs()) { call.reject("建目录失败"); return; }
                File f = new File(dir, fileName);
                try (FileOutputStream out = new FileOutputStream(f)) {
                    bmp.compress(Bitmap.CompressFormat.PNG, 100, out);
                }
                uri = Uri.fromFile(f);
            }
            JSObject o = new JSObject();
            o.put("ok", true);
            o.put("uri", uri.toString());
            call.resolve(o);
        } catch (Throwable e) {
            call.reject(String.valueOf(e.getMessage()));
        }
    }
}
