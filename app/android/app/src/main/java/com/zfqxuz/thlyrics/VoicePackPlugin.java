package com.zfqxuz.thlyrics;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.BufferedOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;
import java.util.HashMap;
import java.util.Map;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

/**
 * 自建离线日语语音包：数据（Open JTalk 词典 + HTS 嗓子）从我们 OSS 下到 App 私有目录，
 * 解压即用，不装 APK、不走系统 TTS。合成走 APK 里的 libopenjtalk（见 cpp/）。
 *
 * JS 用法：
 *   VoicePack.status({id})                    -> { installed, version, path, dicDir, voiceFile, size }
 *   VoicePack.install({id,url,sha256,version}) -> 事件 progress / done / error
 *   VoicePack.remove({id})
 *   VoicePack.synth({id,text})                -> { path }（WAV，48kHz）
 */
@CapacitorPlugin(name = "VoicePack")
public class VoicePackPlugin extends Plugin {

    static { System.loadLibrary("openjtalk"); }

    private static final String ROOT = "voicepacks";
    private static final String REFERER = "https://zfqxuz.github.io/";
    private static final Object IO_LOCK = new Object();
    private final Map<String, org.json.JSONObject> indexCache = new HashMap<>();

    private native boolean nativeInit(String dicDir, String voiceFile);
    private native boolean nativeSynth(String text, String outPath);
    private native String nativeVersion();

    private File root() {
        File d = new File(getContext().getFilesDir(), ROOT);
        if (!d.exists() && !d.mkdirs()) return d;
        return d;
    }

    private File packDir(String id) { return new File(root(), safe(id)); }

    private static String safe(String id) {
        String s = String.valueOf(id == null ? "" : id).trim().replaceAll("[^A-Za-z0-9._-]", "");
        return s.isEmpty() ? "pack" : s;
    }

    private static String sha256(File f) throws Exception {
        MessageDigest md = MessageDigest.getInstance("SHA-256");
        try (InputStream in = new FileInputStream(f)) {
            byte[] buf = new byte[128 * 1024];
            int n;
            while ((n = in.read(buf)) > 0) md.update(buf, 0, n);
        }
        StringBuilder sb = new StringBuilder();
        for (byte b : md.digest()) sb.append(String.format("%02x", b));
        return sb.toString();
    }

    private static String sha1(String s) throws Exception {
        MessageDigest md = MessageDigest.getInstance("SHA-1");
        byte[] d = md.digest(s.getBytes("UTF-8"));
        StringBuilder sb = new StringBuilder();
        for (byte b : d) sb.append(String.format("%02x", b));
        return sb.toString();
    }

    private static long dirSize(File f) {
        if (f == null || !f.exists()) return 0;
        if (f.isFile()) return f.length();
        long n = 0;
        File[] fs = f.listFiles();
        if (fs != null) for (File x : fs) n += dirSize(x);
        return n;
    }

    private static void deleteTree(File f) {
        if (f == null || !f.exists()) return;
        if (f.isDirectory()) {
            File[] fs = f.listFiles();
            if (fs != null) for (File x : fs) deleteTree(x);
        }
        //noinspection ResultOfMethodCallIgnored
        f.delete();
    }

    private String voiceFileIn(File dir) {
        File v = new File(dir, "voice");
        File[] fs = v.listFiles();
        if (fs != null) for (File f : fs) if (f.isFile() && f.getName().toLowerCase().endsWith(".htsvoice")) return f.getAbsolutePath();
        return "";
    }

    private JSObject packInfo(String id) {
        JSObject o = new JSObject();
        o.put("id", id);
        File dir = packDir(id);
        File dic = new File(dir, "dic/sys.dic");
        String voice = voiceFileIn(dir);
        String version = "";
        String kind = "ojt";
        try {
            File mf = new File(dir, "manifest.json");
            if (mf.isFile()) {
                byte[] b;
                try (InputStream in = new FileInputStream(mf)) { b = readAll(in); }
                org.json.JSONObject j = new org.json.JSONObject(new String(b, "UTF-8"));
                version = j.optString("version", "");
                kind = j.optString("kind", "ojt");
            }
        } catch (Throwable ignored) { /* 版本读不到不影响用 */ }
        boolean installed;
        if ("audio".equals(kind)) {
            File audio = new File(dir, "audio");
            String[] fs2 = audio.list();
            installed = dir.isDirectory() && new File(dir, "index.json").isFile() && audio.isDirectory() && fs2 != null && fs2.length > 0;
        } else {
            installed = dir.isDirectory() && dic.isFile() && !voice.isEmpty();
        }
        o.put("kind", kind);
        o.put("installed", installed);
        if (!installed) { o.put("path", dir.getAbsolutePath()); return o; }
        o.put("version", version);
        o.put("path", dir.getAbsolutePath());
        o.put("dicDir", new File(dir, "dic").getAbsolutePath());
        o.put("voiceFile", voice);
        o.put("size", dirSize(dir));
        return o;
    }

    @PluginMethod
    public void status(PluginCall call) {
        String id = call.getString("id", "");
        if (id == null || id.trim().isEmpty()) { call.reject("缺 id"); return; }
        call.resolve(packInfo(safe(id)));
    }

    @PluginMethod
    public void list(PluginCall call) {
        JSObject ret = new JSObject();
        JSArray arr = new JSArray();
        File r = root();
        File[] fs = r.listFiles();
        if (fs != null) {
            for (File f : fs) {
                if (f.isDirectory() && !f.getName().endsWith(".tmp")) arr.put(packInfo(f.getName()));
            }
        }
        ret.put("packs", arr);
        call.resolve(ret);
    }

    @PluginMethod
    public void remove(PluginCall call) {
        String id = safe(call.getString("id", ""));
        final JSObject o = new JSObject();
        synchronized (IO_LOCK) {
            deleteTree(packDir(id));
            deleteTree(new File(root(), id + ".tmp"));
        }
        indexCache.remove(id);
        deleteTree(new File(getContext().getCacheDir(), "tts"));
        o.put("ok", !packDir(id).exists());
        call.resolve(o);
    }

    @PluginMethod
    public void engine(PluginCall call) {
        JSObject o = new JSObject();
        o.put("version", nativeVersion());
        call.resolve(o);
    }

    /** 合成：命中缓存直接回；否则后台线程 native 合成到 cache/tts/<sha1>.wav（别卡 UI） */
    @PluginMethod
    public void synth(PluginCall call) {
        final String id = safe(call.getString("id", ""));
        String text0 = call.getString("text", "");
        if (text0 == null || text0.trim().isEmpty()) { call.reject("没有要读的内容"); return; }
        final String text = text0.trim().length() > 300 ? text0.trim().substring(0, 300) : text0.trim();
        new Thread(() -> {
            try {
                JSObject info = packInfo(id);
                if (!info.optBoolean("installed", false)) { call.reject("语音包未安装"); return; }
                File outDir = new File(getContext().getCacheDir(), "tts");
                if (!outDir.exists() && !outDir.mkdirs()) throw new IOException("建不了缓存目录");
                File out = new File(outDir, sha1(text) + ".wav");
                if (out.isFile() && out.length() > 256) {
                    JSObject o = new JSObject();
                    o.put("path", out.getAbsolutePath());
                    call.resolve(o);
                    return;
                }
                if (!nativeInit(info.optString("dicDir"), info.optString("voiceFile"))) { call.reject("语音引擎加载失败"); return; }
                if (!nativeSynth(text, out.getAbsolutePath())) {
                    //noinspection ResultOfMethodCallIgnored
                    out.delete();
                    call.reject("合成失败");
                    return;
                }
                JSObject o = new JSObject();
                o.put("path", out.getAbsolutePath());
                call.resolve(o);
            } catch (Throwable e) {
                call.reject(String.valueOf(e.getMessage()));
            }
        }).start();
    }

    /** 进度回调（自检钩子也会用） */
    public interface Prog { void pct(int p); }

    /** 下载 OSS 数据包 → 校验 sha256 → 解压进私有目录（无需任何系统权限） */
    @PluginMethod
    public void install(PluginCall call) {
        final String id = safe(call.getString("id", ""));
        final String url = String.valueOf(call.getString("url", "")).trim();
        final String wantSha = String.valueOf(call.getString("sha256", "")).trim().toLowerCase();
        final String version = String.valueOf(call.getString("version", "")).trim();
        final String kind = String.valueOf(call.getString("kind", "")).trim();
        if (url.isEmpty()) { call.reject("没有下载地址"); return; }
        call.resolve();                                    // 立刻回话，进度/结果走事件
        new Thread(() -> {
            String err = installSync(id, url, wantSha, version, kind, (pct) -> {
                JSObject p = new JSObject();
                p.put("id", id);
                p.put("pct", pct);
                notifyListeners("progress", p);
            });
            if (err == null) {
                notifyListeners("done", packInfo(id));
            } else {
                JSObject o = new JSObject();
                o.put("id", id);
                o.put("message", err);
                notifyListeners("error", o);
            }
        }).start();
    }

    /** 同步下载 + 校验 + 解压；返回 null 表示成功，否则错误信息 */
    private String installSync(String id, String url, String wantSha, String version, String kind, Prog prog) {
        File tmp = new File(root(), id + ".tmp");
        File zip = new File(getContext().getCacheDir(), "voicepack-" + id + ".zip");
        try {
            synchronized (IO_LOCK) { deleteTree(tmp); }
            if (!tmp.mkdirs()) throw new IOException("建不了语音包目录");

            HttpURLConnection conn = (HttpURLConnection) new URL(url).openConnection();
            conn.setInstanceFollowRedirects(true);
            conn.setConnectTimeout(20000);
            conn.setReadTimeout(60000);
            conn.setRequestProperty("Referer", REFERER);
            conn.connect();
            int code = conn.getResponseCode();
            if (code != 200) throw new IOException("下载失败 HTTP " + code);
            int total = conn.getContentLength();
            long got = 0;
            int lastPct = -1;
            try (InputStream in = conn.getInputStream(); OutputStream out = new BufferedOutputStream(new FileOutputStream(zip))) {
                byte[] buf = new byte[128 * 1024];
                int n;
                while ((n = in.read(buf)) > 0) {
                    out.write(buf, 0, n);
                    got += n;
                    if (total > 0 && prog != null) {
                        int pct = (int) (got * 100 / total);
                        if (pct != lastPct) { lastPct = pct; prog.pct(pct); }
                    }
                }
            }

            if (!wantSha.isEmpty()) {
                String gotSha = sha256(zip);
                if (!gotSha.equals(wantSha)) throw new IOException("校验失败");
            }

            unzip(zip, tmp);
            if ("audio".equals(kind)) {
                File audio = new File(tmp, "audio");
                String[] fs2 = audio.list();
                if (!new File(tmp, "index.json").isFile() || !audio.isDirectory() || fs2 == null || fs2.length == 0) throw new IOException("数据包不完整");
            } else {
                if (!new File(tmp, "dic/sys.dic").isFile() || voiceFileIn(tmp).isEmpty()) throw new IOException("数据包不完整");
            }

            File mf = new File(tmp, "manifest.json");
            try (OutputStream out = new FileOutputStream(mf)) {
                org.json.JSONObject j = new org.json.JSONObject();
                j.put("id", id);
                j.put("kind", kind);
                j.put("version", version);
                j.put("sha256", wantSha);
                j.put("installedAt", System.currentTimeMillis());
                out.write(j.toString().getBytes("UTF-8"));
            }

            synchronized (IO_LOCK) {
                File dst = packDir(id);
                deleteTree(dst);
                if (!tmp.renameTo(dst)) throw new IOException("落盘失败");
            }
            indexCache.remove(id);
            //noinspection ResultOfMethodCallIgnored
            zip.delete();
            return null;
        } catch (Throwable e) {
            synchronized (IO_LOCK) { deleteTree(tmp); }
            //noinspection ResultOfMethodCallIgnored
            zip.delete();
            return String.valueOf(e.getMessage());
        }
    }

    /** 真机自检（debug）：读本地数据包合成一个 WAV，返回结果字符串 */
    public String debugSynth(String text) {
        try {
            File dir = packDir("openjtalk-ja");
            String voice = voiceFileIn(dir);
            File dic = new File(dir, "dic");
            if (!new File(dic, "sys.dic").isFile() || voice.isEmpty()) return "pack-missing";
            File out = new File(getContext().getFilesDir(), "selftest.wav");
            if (!nativeInit(dic.getAbsolutePath(), voice)) return "init-fail";
            if (!nativeSynth(text, out.getAbsolutePath())) return "synth-fail";
            return "ok " + out.length();
        } catch (Throwable e) { return "error " + e; }
    }

    /** 真机自检（debug）：同步装一次数据包，返回结果字符串 */
    public String debugInstall(String id, String url, String sha, String version, String kind) {
        String err = installSync(safe(id), url, sha == null ? "" : sha, version == null ? "" : version, kind == null ? "ojt" : kind, null);
        return err == null ? "ok" : "error " + err;
    }

    /** 音频语音包：按文本查表拿本地文件（查不到返回 found:false，调用方再兜底） */
    @PluginMethod
    public void resolve(PluginCall call) {
        final String id = safe(call.getString("id", ""));
        final String text = String.valueOf(call.getString("text", "")).trim();
        if (text.isEmpty()) { call.reject("没有要读的内容"); return; }
        new Thread(() -> {
            try {
                JSObject info = packInfo(id);
                if (!info.optBoolean("installed", false) || !"audio".equals(info.optString("kind"))) {
                    JSObject o = new JSObject();
                    o.put("found", false);
                    call.resolve(o);
                    return;
                }
                org.json.JSONObject idx = indexCache.get(id);
                if (idx == null) {
                    byte[] b;
                    try (InputStream in = new FileInputStream(new File(packDir(id), "index.json"))) { b = readAll(in); }
                    idx = new org.json.JSONObject(new String(b, "UTF-8"));
                    indexCache.put(id, idx);
                }
                String file = idx.optJSONObject("files") == null ? "" : idx.optJSONObject("files").optString(text, "");
                if (file.isEmpty() || file.contains("/") || file.contains("..")) {
                    JSObject o = new JSObject();
                    o.put("found", false);
                    call.resolve(o);
                    return;
                }
                File af = new File(new File(packDir(id), "audio"), file);
                JSObject o = new JSObject();
                if (af.isFile()) { o.put("found", true); o.put("path", af.getAbsolutePath()); }
                else o.put("found", false);
                call.resolve(o);
            } catch (Throwable e) {
                call.reject(String.valueOf(e.getMessage()));
            }
        }).start();
    }

    private static byte[] readAll(InputStream in) throws IOException {
        java.io.ByteArrayOutputStream bos = new java.io.ByteArrayOutputStream();
        byte[] buf = new byte[64 * 1024];
        int n;
        while ((n = in.read(buf)) > 0) bos.write(buf, 0, n);
        return bos.toByteArray();
    }

    /** 只收 zip 内的相对路径，挡住 ../ 穿越 */
    private static void unzip(File zip, File dst) throws IOException {
        try (ZipInputStream zin = new ZipInputStream(new FileInputStream(zip))) {
            ZipEntry e;
            byte[] buf = new byte[128 * 1024];
            while ((e = zin.getNextEntry()) != null) {
                String name = e.getName().replace('\\', '/');
                while (name.startsWith("/")) name = name.substring(1);
                if (name.isEmpty() || name.contains("..")) continue;
                File f = new File(dst, name);
                String canon = f.getCanonicalPath();
                if (!canon.startsWith(dst.getCanonicalPath() + File.separator) && !canon.equals(dst.getCanonicalPath())) continue;
                if (e.isDirectory()) {
                    if (!f.exists() && !f.mkdirs()) throw new IOException("建不了目录");
                    continue;
                }
                File parent = f.getParentFile();
                if (parent != null && !parent.exists() && !parent.mkdirs()) throw new IOException("建不了目录");
                try (OutputStream out = new BufferedOutputStream(new FileOutputStream(f))) {
                    int n;
                    while ((n = zin.read(buf)) > 0) out.write(buf, 0, n);
                }
                zin.closeEntry();
            }
        }
    }
}
