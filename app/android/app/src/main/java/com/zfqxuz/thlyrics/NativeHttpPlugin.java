package com.zfqxuz.thlyrics;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.List;
import java.util.Map;

/**
 * 不跟随重定向的一跳 HTTP（只用 JDK 的 HttpURLConnection，不引第三方库）。
 * 为什么需要：QQ 扫码登录的 qm_keyst 是在 check_sig 的 302 链路上用 Set-Cookie 下发的，
 * CapacitorHttp 会自动跟随重定向，中间的 Set-Cookie 就丢了。
 */
@CapacitorPlugin(name = "NativeHttp")
public class NativeHttpPlugin extends Plugin {

    @PluginMethod
    public void raw(PluginCall call) {
        final String url = String.valueOf(call.getString("url", ""));
        final String method = String.valueOf(call.getString("method", "GET"));
        final JSObject h = call.getObject("headers", new JSObject());
        new Thread(() -> {
            HttpURLConnection conn = null;
            try {
                conn = (HttpURLConnection) new URL(url).openConnection();
                conn.setInstanceFollowRedirects(false);
                conn.setConnectTimeout(15000);
                conn.setReadTimeout(15000);
                conn.setRequestMethod(method);
                if (h != null) {
                    java.util.Iterator<String> it = h.keys();
                    while (it.hasNext()) {
                        String k = it.next();
                        conn.setRequestProperty(k, String.valueOf(h.opt(k)));
                    }
                }
                int status = conn.getResponseCode();
                JSObject hdr = new JSObject();
                for (Map.Entry<String, List<String>> e : conn.getHeaderFields().entrySet()) {
                    if (e.getKey() == null) continue;
                    hdr.put(e.getKey().toLowerCase(), String.join("\n", e.getValue()));
                }
                InputStream in = status >= 400 ? conn.getErrorStream() : conn.getInputStream();
                String body = "";
                if (in != null) {
                    ByteArrayOutputStream bos = new ByteArrayOutputStream();
                    byte[] buf = new byte[8192];
                    int n;
                    while ((n = in.read(buf)) > 0) bos.write(buf, 0, n);
                    in.close();
                    body = bos.toString("UTF-8");
                }
                JSObject out = new JSObject();
                out.put("status", status);
                out.put("headers", hdr);
                out.put("body", body);
                call.resolve(out);
            } catch (Throwable e) {
                call.reject(String.valueOf(e.getMessage()));
            } finally {
                if (conn != null) conn.disconnect();
            }
        }).start();
    }
}
