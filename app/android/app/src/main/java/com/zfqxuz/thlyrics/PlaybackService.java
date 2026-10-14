package com.zfqxuz.thlyrics;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;

import androidx.core.app.NotificationCompat;
import android.support.v4.media.MediaMetadataCompat;
import androidx.media.app.NotificationCompat.MediaStyle;
import android.support.v4.media.session.MediaSessionCompat;
import android.support.v4.media.session.PlaybackStateCompat;

/**
 * 前台服务：两边都要它。
 * ① 保活 —— WebView 里播的 <audio> 进后台会被系统挂起（真机实测：切后台几十秒后进度停住），
 *    挂上 mediaPlayback 类型的前台服务，进程就不会被当作可回收的后台进程。
 * ② 媒体会话 —— 通知栏 / 锁屏 / 耳机线控的播放控制（WebView 不支持 Media Session Web API）。
 * 状态由 JS 侧通过 MediaSessionPlugin 推过来，用户按按钮再回传给 JS 执行。
 */
public class PlaybackService extends Service {
    public static final String CHANNEL_ID = "thlyrics-playback";
    public static final int NOTI_ID = 4711;

    private MediaSessionCompat session;
    private String title = "", artist = "";
    private boolean playing = false;
    private long positionMs = 0, durationMs = 0;

    @Override
    public void onCreate() {
        super.onCreate();
        createChannel();
        try {
            session = new MediaSessionCompat(this, "thlyrics");
            session.setCallback(new MediaSessionCompat.Callback() {
                @Override public void onPlay() { MediaSessionPlugin.emit("play", 0); }
                @Override public void onPause() { MediaSessionPlugin.emit("pause", 0); }
                @Override public void onSkipToNext() { MediaSessionPlugin.emit("next", 0); }
                @Override public void onSkipToPrevious() { MediaSessionPlugin.emit("prev", 0); }
                @Override public void onSeekTo(long pos) { MediaSessionPlugin.emit("seek", pos / 1000.0); }
                @Override public void onStop() { MediaSessionPlugin.emit("stop", 0); }
            });
            session.setActive(true);
        } catch (Throwable ignored) { /* 没有媒体会话也不影响保活 */ }
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null) {
            String cmd = intent.getStringExtra("cmd");
            if (cmd != null) {                       // 通知栏/耳机按钮：只转发给 JS，不动状态
                if ("stop".equals(cmd)) { stopSelfSafely(); return START_NOT_STICKY; }
                MediaSessionPlugin.emit(cmd, intent.getDoubleExtra("position", 0));
                return START_STICKY;
            }
            if (intent.hasExtra("title")) title = nz(intent.getStringExtra("title"));
            if (intent.hasExtra("artist")) artist = nz(intent.getStringExtra("artist"));
            if (intent.hasExtra("playing")) playing = intent.getBooleanExtra("playing", false);
            if (intent.hasExtra("position")) positionMs = (long) (intent.getDoubleExtra("position", 0) * 1000);
            if (intent.hasExtra("duration")) durationMs = (long) (intent.getDoubleExtra("duration", 0) * 1000);
        }
        updateSession();
        startForegroundCompat();
        return START_STICKY;
    }

    private void startForegroundCompat() {
        try {
            Notification n = buildNotification();
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                startForeground(NOTI_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
            } else {
                startForeground(NOTI_ID, n);
            }
        } catch (Throwable ignored) { /* 前台服务起不来也不该崩掉 App */ }
    }

    private PendingIntent pi(String cmd) {
        Intent i = new Intent(this, PlaybackService.class).putExtra("cmd", cmd);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) flags |= PendingIntent.FLAG_IMMUTABLE;
        return PendingIntent.getService(this, cmd.hashCode(), i, flags);
    }

    private Notification buildNotification() {
        Intent open = new Intent(this, MainActivity.class).setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        int oflags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) oflags |= PendingIntent.FLAG_IMMUTABLE;
        PendingIntent openPi = PendingIntent.getActivity(this, 0, open, oflags);

        NotificationCompat.Builder b = new NotificationCompat.Builder(this, CHANNEL_ID)
                .setSmallIcon(android.R.drawable.ic_media_play)
                .setContentTitle(title.isEmpty() ? "TH Lyrics" : title)
                .setContentText(artist)
                .setContentIntent(openPi)
                .setOngoing(playing)
                .setOnlyAlertOnce(true)
                .setShowWhen(false)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC);
        b.addAction(new NotificationCompat.Action(android.R.drawable.ic_media_previous, "上一句", pi("prev")));
        b.addAction(playing
                ? new NotificationCompat.Action(android.R.drawable.ic_media_pause, "暂停", pi("pause"))
                : new NotificationCompat.Action(android.R.drawable.ic_media_play, "播放", pi("play")));
        b.addAction(new NotificationCompat.Action(android.R.drawable.ic_media_next, "下一句", pi("next")));
        if (session != null) {
            try {
                b.setStyle(new MediaStyle().setMediaSession(session.getSessionToken()).setShowActionsInCompactView(0, 1, 2));
            } catch (Throwable ignored) {}
        }
        return b.build();
    }

    private void updateSession() {
        if (session == null) return;
        try {
            session.setMetadata(new MediaMetadataCompat.Builder()
                    .putString(MediaMetadataCompat.METADATA_KEY_TITLE, title)
                    .putString(MediaMetadataCompat.METADATA_KEY_ARTIST, artist)
                    .putLong(MediaMetadataCompat.METADATA_KEY_DURATION, Math.max(0, durationMs))
                    .build());
            long actions = PlaybackStateCompat.ACTION_PLAY | PlaybackStateCompat.ACTION_PAUSE
                    | PlaybackStateCompat.ACTION_PLAY_PAUSE | PlaybackStateCompat.ACTION_SKIP_TO_NEXT
                    | PlaybackStateCompat.ACTION_SKIP_TO_PREVIOUS | PlaybackStateCompat.ACTION_SEEK_TO
                    | PlaybackStateCompat.ACTION_STOP;
            session.setPlaybackState(new PlaybackStateCompat.Builder()
                    .setActions(actions)
                    .setState(playing ? PlaybackStateCompat.STATE_PLAYING : PlaybackStateCompat.STATE_PAUSED,
                            Math.max(0, positionMs), 1f)
                    .build());
        } catch (Throwable ignored) {}
    }

    private void createChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        try {
            NotificationManager nm = getSystemService(NotificationManager.class);
            if (nm == null || nm.getNotificationChannel(CHANNEL_ID) != null) return;
            NotificationChannel ch = new NotificationChannel(CHANNEL_ID, "播放控制", NotificationManager.IMPORTANCE_LOW);
            ch.setShowBadge(false);
            nm.createNotificationChannel(ch);
        } catch (Throwable ignored) {}
    }

    private void stopSelfSafely() {
        try { if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) stopForeground(STOP_FOREGROUND_REMOVE); else stopForeground(true); } catch (Throwable ignored) {}
        stopSelf();
    }

    @Override
    public void onDestroy() {
        try { if (session != null) { session.setActive(false); session.release(); } } catch (Throwable ignored) {}
        session = null;
        try { stopSelfSafely(); } catch (Throwable ignored) {}
        super.onDestroy();
    }

    @Override public IBinder onBind(Intent intent) { return null; }

    private static String nz(String s) { return s == null ? "" : s; }
}
