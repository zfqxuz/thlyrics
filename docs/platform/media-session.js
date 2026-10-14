/**
 * 媒体会话（锁屏 / 通知栏 / 耳机线控）。
 *
 * - 网页端：用浏览器自带的 Media Session Web API（navigator.mediaSession）。
 * - 原生壳：Android WebView **不支持** Media Session Web API（这是官方插件的原话，实测亦然），
 *   所以走自己写的 Capacitor 插件 MediaSession：
 *     · 原生侧起一个 mediaPlayback 类型的前台服务（顺带解决"后台播放被系统挂起"）
 *     · 通知栏/锁屏的按钮事件通过 action 事件回传给这里
 * 两者对上层是同一个接口：update(info) / onAction(fn) / stop()。
 */
const cap = (typeof window !== 'undefined' && window.Capacitor) ? window.Capacitor : null;
const nativePlugin = (cap && typeof cap.isNativePlatform === 'function' && cap.isNativePlatform() && cap.Plugins)
  ? cap.Plugins.MediaSession : null;
const web = (typeof navigator !== 'undefined' && navigator.mediaSession) ? navigator.mediaSession : null;

let handler = null;          // 上层注册的动作处理函数
let webWired = false;

function webWire() {
  if (!web || webWired) return;
  webWired = true;
  const bind = (action, fn) => { try { web.setActionHandler(action, fn); } catch { /* 浏览器不支持某个动作时忽略 */ } };
  bind('play', () => handler && handler({ action: 'play' }));
  bind('pause', () => handler && handler({ action: 'pause' }));
  bind('nexttrack', () => handler && handler({ action: 'next' }));
  bind('previoustrack', () => handler && handler({ action: 'prev' }));
  bind('seekto', (d) => handler && handler({ action: 'seek', position: (d && d.seekTime) || 0 }));
  bind('stop', () => handler && handler({ action: 'stop' }));
}

export const mediaSession = {
  /** 有没有可用的媒体会话（网页端浏览器可能没有；原生壳一定有） */
  available: !!(nativePlugin || web),
  /** 是否运行在原生壳里 */
  native: !!nativePlugin,

  /** 推状态：标题/歌手/是否在播/进度/时长 */
  update(info) {
    const i = info || {};
    if (nativePlugin) {
      try { nativePlugin.update({
        title: String(i.title || ''), artist: String(i.artist || ''),
        playing: !!i.playing, position: Number(i.position) || 0, duration: Number(i.duration) || 0,
      }).catch(() => {}); } catch { /* 插件不可用时忽略 */ }
      return;
    }
    if (web) {
      try {
        if (typeof MediaMetadata !== 'undefined') {
          web.metadata = new MediaMetadata({ title: i.title || '', artist: i.artist || '', album: i.album || '' });
        }
        web.playbackState = i.playing ? 'playing' : 'paused';
        const dur = Number(i.duration) || 0, pos = Number(i.position) || 0;
        if (dur > 0 && pos <= dur && web.setPositionState) web.setPositionState({ duration: dur, position: pos, playbackRate: 1 });
      } catch { /* 元数据不合法就跳过 */ }
    }
  },

  /** 注册动作处理；返回取消函数 */
  onAction(fn) {
    handler = fn;
    if (nativePlugin) {
      let sub = null;
      try { sub = nativePlugin.addListener('action', (d) => handler && handler(d || {})); } catch { /* 忽略 */ }
      return () => { try { sub && sub.remove && sub.remove(); } catch { /* 忽略 */ } };
    }
    webWire();
    return () => { handler = null; };
  },

  /** 停止后台播放服务（退出播放/清空时调用） */
  stop() {
    if (nativePlugin) { try { nativePlugin.stop().catch(() => {}); } catch { /* 忽略 */ } }
  },
};
