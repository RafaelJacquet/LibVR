package com.frenchflair.libvr;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.Intent;
import android.content.res.AssetFileDescriptor;
import android.content.res.AssetManager;
import android.os.IBinder;
import android.util.Log;

import java.io.FileInputStream;
import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.channels.FileChannel;

/**
 * Service de premier plan qui garde le serveur local actif pendant que le
 * Quest Browser affiche l'expérience (sinon le système pourrait arrêter l'appli).
 */
public final class ServerService extends Service {

    public static final int PORT = AppConfig.PORT;
    private static final String TAG = "LibVR";
    private static final String CHANNEL = "libvr";
    /** Les fichiers du site sont rangés sous assets/web/ dans l'APK (stockés sans compression). */
    private static final String ROOT = "web/";

    private static volatile boolean running;
    private HttpServer server;

    public static boolean isRunning() { return running; }

    @Override
    public void onCreate() {
        super.onCreate();
        NotificationManager nm = getSystemService(NotificationManager.class);
        nm.createNotificationChannel(new NotificationChannel(CHANNEL, AppConfig.NAME, NotificationManager.IMPORTANCE_LOW));
        Notification n = new Notification.Builder(this, CHANNEL)
                .setContentTitle(AppConfig.NAME)
                .setContentText("Serveur local actif")
                .setSmallIcon(android.R.drawable.ic_media_play)
                .setOngoing(true)
                .build();
        startForeground(1, n);

        final AssetManager assets = getAssets();
        server = new HttpServer(path -> openAsset(assets, ROOT + path), PORT);
        try {
            server.start();
            running = true;
        } catch (IOException e) {
            Log.e(TAG, "Impossible d'ouvrir le port " + PORT, e);
        }
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        running = false;
        if (server != null) server.stop();
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) { return null; }

    private static HttpServer.Entry openAsset(AssetManager assets, String path) {
        final AssetFileDescriptor afd;
        try {
            afd = assets.openFd(path);
        } catch (IOException e) {
            return null; // absent (ou compressé, ce que le script de build évite)
        }
        final FileInputStream fis;
        try {
            fis = afd.createInputStream();
        } catch (IOException e) {
            try { afd.close(); } catch (IOException ignored) { }
            return null;
        }
        final FileChannel ch = fis.getChannel();
        final long base = afd.getStartOffset();
        final long len = afd.getLength();
        return new HttpServer.Entry() {
            @Override public long length() { return len; }

            @Override public int read(long position, byte[] buf, int off, int n) throws IOException {
                n = (int) Math.min(n, len - position);
                if (n <= 0) return -1;
                // lecture positionnelle : sûre même si plusieurs requêtes lisent la même vidéo
                return ch.read(ByteBuffer.wrap(buf, off, n), base + position);
            }

            @Override public void close() {
                try { fis.close(); } catch (IOException ignored) { }
                try { afd.close(); } catch (IOException ignored) { }
            }
        };
    }
}
