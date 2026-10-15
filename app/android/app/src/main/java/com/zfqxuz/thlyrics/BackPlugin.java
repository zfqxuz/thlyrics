package com.zfqxuz.thlyrics;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * 返回键出口：MAIN Activity 把系统 BACK/侧滑手势交给网页（window.__tlOnBackPressed），
 * 只有网页判断「这一步该退到桌面」时才调用本插件的 exit()。
 * 不这么做的话，原生壳默认会把 Activity finish 掉 —— 用户在详情页侧滑就直接回桌面。
 */
@CapacitorPlugin(name = "Back")
public class BackPlugin extends Plugin {

    @PluginMethod
    public void exit(PluginCall call) {
        try {
            getActivity().moveTaskToBack(true);   // 退到桌面/最近任务，进程保留
            call.resolve();
        } catch (Throwable e) {
            call.reject("退不出去");
        }
    }
}
