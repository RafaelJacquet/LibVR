package com.frenchflair.libvr;

/** Réglages propres à chaque variante d'APK. Réécrit par tools/apk/build.sh à chaque construction. */
final class AppConfig {
    static final String NAME = "protoLibVR";
    /** Port du serveur local : distinct par variante, pour que plusieurs variantes cohabitent. */
    static final int PORT = 8724;

    private AppConfig() {}
}
