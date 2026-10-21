"""Draws the Saints Service home-screen icons (no image libraries needed).

    python3 web/console/make-icons.py

Writes web/console/public/icon-{180,192,512}.png and icon-maskable-512.png:
a lit orb with an orbit ring on a dark tile, the same motif as the console's
Welcome scene. Full-bleed squares: iOS and Android apply their own corner
mask, and the maskable variant keeps the art inside the 80% safe zone.
"""
import math
import struct
import zlib
from pathlib import Path

OUT = Path(__file__).resolve().parent / 'public'


def png(path, size, pixels):
    raw = b''.join(b'\x00' + bytes(pixels[y * size * 4:(y + 1) * size * 4]) for y in range(size))
    def chunk(kind, data):
        return struct.pack('>I', len(data)) + kind + data + struct.pack('>I', zlib.crc32(kind + data) & 0xffffffff)
    path.write_bytes(b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 6, 0, 0, 0))
                     + chunk(b'IDAT', zlib.compress(raw, 9)) + chunk(b'IEND', b''))


def mix(a, b, t):
    return tuple(a[i] + (b[i] - a[i]) * t for i in range(3))


def draw(size, scale):
    px = bytearray(size * size * 4)
    ss = 3  # supersampling per axis
    c = size / 2
    orb_r = size * 0.2 * scale
    ring_a, ring_b = size * 0.36 * scale, size * 0.13 * scale
    ring_w = max(1.2, size * 0.012)
    tilt = math.radians(-18)
    teal, violet = (45, 212, 191), (139, 92, 246)
    for y in range(size):
        for x in range(size):
            acc = [0.0, 0.0, 0.0]
            for sy in range(ss):
                for sx in range(ss):
                    fx = x + (sx + 0.5) / ss - c
                    fy = y + (sy + 0.5) / ss - c
                    # Background: deep vertical gradient with a teal glow.
                    t = (fy + c) / size
                    col = mix((24, 27, 33), (9, 10, 13), t)
                    glow = max(0.0, 1 - math.hypot(fx, fy + size * 0.05) / (size * 0.62))
                    col = mix(col, (18, 64, 70), glow ** 2 * 0.55)
                    # Orbit ring (behind the orb on the upper half).
                    rx = fx * math.cos(tilt) - fy * math.sin(tilt)
                    ry = fx * math.sin(tilt) + fy * math.cos(tilt)
                    e = math.hypot(rx / ring_a, ry / ring_b)
                    ring_d = abs(e - 1) * min(ring_a, ring_b)
                    ring = max(0.0, 1 - ring_d / ring_w)
                    d = math.hypot(fx, fy)
                    in_orb = d <= orb_r
                    if ring and (ry < 0 or not in_orb):
                        col = mix(col, mix(teal, violet, (rx / ring_a + 1) / 2), ring * 0.9)
                    if in_orb:
                        # Lit sphere: light from the upper left, teal to violet.
                        nx, ny = fx / orb_r, fy / orb_r
                        nz = math.sqrt(max(0.0, 1 - nx * nx - ny * ny))
                        light = max(0.0, -0.45 * nx - 0.55 * ny + 0.7 * nz)
                        base = mix(teal, violet, (nx + ny + 2) / 4)
                        col = mix(mix(base, (6, 8, 12), 0.45), (235, 255, 252), light ** 3 * 0.85)
                        col = mix(col, base, 0.35 * light)
                        edge = max(0.0, (d - (orb_r - 1.2)) / 1.2)
                        col = mix(col, mix((24, 27, 33), (9, 10, 13), t), min(1.0, edge))
                    acc = [acc[i] + col[i] for i in range(3)]
            i = (y * size + x) * 4
            px[i:i + 4] = bytes([round(v / (ss * ss)) for v in acc] + [255])
    return px


if __name__ == '__main__':
    OUT.mkdir(parents=True, exist_ok=True)
    for name, size, scale in [('icon-180.png', 180, 1.0), ('icon-192.png', 192, 1.0),
                              ('icon-512.png', 512, 1.0), ('icon-maskable-512.png', 512, 0.78)]:
        png(OUT / name, size, draw(size, scale))
        print('wrote', OUT / name)
