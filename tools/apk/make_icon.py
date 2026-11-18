"""Génère l'icône du lanceur (PNG 192x192) sans dépendance : fond verre fumé, anneau champagne.
Usage : make_icon.py <sortie.png> [proto]   (« proto » : point central évidé, pour distinguer la variante)"""
import math
import struct
import sys
import zlib

S = 192
BG = (24, 26, 30)
RING = (214, 190, 140)
INNER = (245, 239, 226)
PROTO = len(sys.argv) > 2 and sys.argv[2] == "proto"


def px(x, y):
    cx = cy = (S - 1) / 2
    # carré arrondi (rayon 40) avec anticrénelage simple
    r = 40
    dx = max(abs(x - cx) - (S / 2 - r), 0)
    dy = max(abs(y - cy) - (S / 2 - r), 0)
    a_bg = max(0.0, min(1.0, r - math.hypot(dx, dy) + 0.5))
    d = math.hypot(x - cx, y - cy)
    col = BG
    ring = max(0.0, min(1.0, 7 - abs(d - 58) + 0.5))   # anneau extérieur
    dot = max(0.0, min(1.0, 22 - d + 0.5))              # point central
    if PROTO:                                           # … ou anneau intérieur
        dot = max(0.0, min(1.0, 5 - abs(d - 20) + 0.5))
    col = tuple(c * (1 - ring) + rc * ring for c, rc in zip(col, RING))
    col = tuple(c * (1 - dot) + ic * dot for c, ic in zip(col, INNER))
    return tuple(int(round(c)) for c in col) + (int(round(255 * a_bg)),)


rows = b"".join(b"\x00" + b"".join(struct.pack("BBBB", *px(x, y)) for x in range(S)) for y in range(S))


def chunk(t, d):
    return struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xFFFFFFFF)


png = (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", S, S, 8, 6, 0, 0, 0))
       + chunk(b"IDAT", zlib.compress(rows, 9)) + chunk(b"IEND", b""))
open(sys.argv[1], "wb").write(png)
