package com.frenchflair.libvr;

import java.io.BufferedInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Petit serveur HTTP statique (GET / HEAD + requêtes « Range » pour les vidéos),
 * équivalent de server.mjs. Indépendant d'Android pour pouvoir être testé sur PC.
 */
public final class HttpServer {

    /** Un fichier lisible à une position quelconque (vidéos : avance rapide). */
    public interface Entry {
        long length();
        int read(long position, byte[] buf, int off, int len) throws IOException;
        void close();
    }

    /** Fournit les fichiers du site ; renvoie null si absent. */
    public interface Source {
        Entry open(String path);
    }

    private static final Map<String, String> TYPES = new HashMap<>();
    static {
        TYPES.put("html", "text/html; charset=utf-8");
        TYPES.put("js", "text/javascript; charset=utf-8");
        TYPES.put("mjs", "text/javascript; charset=utf-8");
        TYPES.put("css", "text/css; charset=utf-8");
        TYPES.put("json", "application/json");
        TYPES.put("svg", "image/svg+xml");
        TYPES.put("png", "image/png");
        TYPES.put("jpg", "image/jpeg");
        TYPES.put("jpeg", "image/jpeg");
        TYPES.put("webp", "image/webp");
        TYPES.put("woff2", "font/woff2");
        TYPES.put("wasm", "application/wasm");
        TYPES.put("glb", "model/gltf-binary");
        TYPES.put("gltf", "model/gltf+json");
        TYPES.put("mp4", "video/mp4");
        TYPES.put("webm", "video/webm");
        TYPES.put("mkv", "video/x-matroska");
        TYPES.put("vtt", "text/vtt");
    }

    private static final Pattern RANGE = Pattern.compile("bytes=(\\d*)-(\\d*)");

    private final Source source;
    private final int port;
    private final ExecutorService pool = Executors.newCachedThreadPool();
    private ServerSocket server;

    public HttpServer(Source source, int port) {
        this.source = source;
        this.port = port;
    }

    /** Ouvre le port (127.0.0.1 uniquement) et accepte les connexions en arrière-plan. */
    public synchronized void start() throws IOException {
        if (server != null) return;
        ServerSocket s = new ServerSocket();
        s.setReuseAddress(true);
        s.bind(new java.net.InetSocketAddress(InetAddress.getByName("127.0.0.1"), port), 64);
        server = s;
        Thread t = new Thread(() -> {
            while (!s.isClosed()) {
                try {
                    Socket c = s.accept();
                    pool.execute(() -> handle(c));
                } catch (IOException e) {
                    if (s.isClosed()) break;
                }
            }
        }, "libvr-http");
        t.setDaemon(true);
        t.start();
    }

    public synchronized void stop() {
        try { if (server != null) server.close(); } catch (IOException ignored) { }
        server = null;
        pool.shutdownNow();
    }

    private void handle(Socket c) {
        try (Socket sock = c) {
            sock.setSoTimeout(30000);
            InputStream in = new BufferedInputStream(sock.getInputStream());
            OutputStream out = sock.getOutputStream();
            // connexions persistantes : le navigateur enchaîne les requêtes sur le même socket
            while (true) {
                String requestLine = readLine(in);
                if (requestLine == null || requestLine.isEmpty()) return;
                Map<String, String> headers = new HashMap<>();
                String line;
                while ((line = readLine(in)) != null && !line.isEmpty()) {
                    int i = line.indexOf(':');
                    if (i > 0) headers.put(line.substring(0, i).trim().toLowerCase(Locale.ROOT), line.substring(i + 1).trim());
                }
                if (line == null) return;
                boolean keepAlive = !"close".equalsIgnoreCase(headers.get("connection"));
                if (!respond(requestLine, headers, out)) return;
                out.flush();
                if (!keepAlive) return;
            }
        } catch (IOException ignored) {
            // client parti (fréquent avec les vidéos : le navigateur annule des plages)
        }
    }

    /** @return false si la connexion doit être fermée */
    private boolean respond(String requestLine, Map<String, String> headers, OutputStream out) throws IOException {
        String[] parts = requestLine.split(" ");
        if (parts.length < 2) { status(out, 400, "Bad Request"); return false; }
        String method = parts[0];
        boolean head = method.equals("HEAD");
        if (!head && !method.equals("GET")) { status(out, 405, "Method Not Allowed"); return true; }

        String path = parts[1];
        int q = path.indexOf('?');
        if (q >= 0) path = path.substring(0, q);
        int h = path.indexOf('#');
        if (h >= 0) path = path.substring(0, h);
        try {
            path = URLDecoder.decode(path.replace("+", "%2B"), "UTF-8");
        } catch (IllegalArgumentException e) {
            status(out, 400, "Bad Request"); return true;
        }
        if (path.endsWith("/")) path += "index.html";
        while (path.startsWith("/")) path = path.substring(1);
        if (path.contains("..") || path.contains("\\")) { status(out, 403, "Forbidden"); return true; }

        Entry e = source.open(path);
        if (e == null) { status(out, 404, "Not Found"); return true; }
        try {
            long size = e.length();
            long start = 0, end = size - 1;
            boolean partial = false;
            String range = headers.get("range");
            if (range != null) {
                Matcher m = RANGE.matcher(range);
                if (m.find()) {
                    String a = m.group(1), b = m.group(2);
                    if (a.isEmpty() && b.isEmpty()) {
                        // plage invalide : on renvoie le fichier entier
                    } else {
                        if (a.isEmpty()) start = size - Long.parseLong(b);
                        else start = Long.parseLong(a);
                        if (!a.isEmpty() && !b.isEmpty()) end = Long.parseLong(b);
                        end = Math.min(end, size - 1);
                        if (start < 0 || start > end) {
                            String hdr = "HTTP/1.1 416 Range Not Satisfiable\r\nContent-Range: bytes */" + size
                                    + "\r\nContent-Length: 0\r\n\r\n";
                            out.write(hdr.getBytes(StandardCharsets.ISO_8859_1));
                            return true;
                        }
                        partial = true;
                    }
                }
            }
            long len = end - start + 1;
            StringBuilder sb = new StringBuilder();
            sb.append(partial ? "HTTP/1.1 206 Partial Content\r\n" : "HTTP/1.1 200 OK\r\n");
            sb.append("Content-Type: ").append(type(path)).append("\r\n");
            sb.append("Accept-Ranges: bytes\r\n");
            sb.append("Cache-Control: no-cache\r\n");
            if (partial) sb.append("Content-Range: bytes ").append(start).append('-').append(end).append('/').append(size).append("\r\n");
            sb.append("Content-Length: ").append(len).append("\r\n\r\n");
            out.write(sb.toString().getBytes(StandardCharsets.ISO_8859_1));
            if (head) return true;

            byte[] buf = new byte[256 * 1024];
            long pos = start, remaining = len;
            while (remaining > 0) {
                int n = e.read(pos, buf, 0, (int) Math.min(buf.length, remaining));
                if (n <= 0) return false;
                out.write(buf, 0, n);
                pos += n;
                remaining -= n;
            }
            return true;
        } finally {
            e.close();
        }
    }

    private static String type(String path) {
        int dot = path.lastIndexOf('.');
        String ext = dot >= 0 ? path.substring(dot + 1).toLowerCase(Locale.ROOT) : "";
        String t = TYPES.get(ext);
        return t != null ? t : "application/octet-stream";
    }

    private static void status(OutputStream out, int code, String msg) throws IOException {
        byte[] body = (code + " " + msg).getBytes(StandardCharsets.UTF_8);
        String hdr = "HTTP/1.1 " + code + " " + msg + "\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: "
                + body.length + "\r\n\r\n";
        out.write(hdr.getBytes(StandardCharsets.ISO_8859_1));
        out.write(body);
    }

    private static String readLine(InputStream in) throws IOException {
        StringBuilder sb = new StringBuilder();
        int c;
        while ((c = in.read()) != -1) {
            if (c == '\n') break;
            if (c != '\r') sb.append((char) c);
            if (sb.length() > 16384) throw new IOException("ligne trop longue");
        }
        if (c == -1 && sb.length() == 0) return null;
        return sb.toString();
    }
}
