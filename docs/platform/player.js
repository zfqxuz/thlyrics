/**
 * 播放器：网页端就是 HTMLAudioElement。
 * 原生壳（M4/M5）会在这里加一个等价实现：Android 走 ExoPlayer + 前台服务 + 媒体会话，
 * 对上层暴露同一套接口（play / pause / currentTime / 事件…），业务代码不用改。
 */
export function createAudioEl() {
  const a = new Audio();
  a.preload = 'auto';
  a.setAttribute('playsinline', '');
  a.id = 'audio';
  return a;
}
