#!/usr/bin/env python3
"""Генерация assets/icon.ico без внешних библиотек."""
import struct, zlib, os

W = H = 256
BG = (26, 29, 33, 255)
EDGE = (200, 120, 60, 255)
WHITE = (232, 234, 238, 255)

def px(x, y):
    r = 26
    inset = 18
    # внешняя рамка
    if x < inset or y < inset or x >= W - inset or y >= W - inset:
        return (0, 0, 0, 0)
    x1, y1 = x - inset, y - inset
    w = W - 2 * inset
    cx = min(max(x1, r), w - 1 - r)
    cy = min(max(y1, r), w - 1 - r)
    if (x1 - cx) ** 2 + (y1 - cy) ** 2 > r * r:
        return (0, 0, 0, 0)
    border = 5
    if x1 < border or y1 < border or x1 >= w - border or y1 >= w - border:
        return EDGE
    # буква N
    if 62 <= x <= 84 and 58 <= y <= 198:
        return WHITE
    if 172 <= x <= 194 and 58 <= y <= 198:
        return WHITE
    for k in range(-13, 14):
        if abs(x - (84 + (y - 58) * 88 / 140) - k) < 1:
            return WHITE
    return BG

raw = bytearray()
for y in range(H):
    raw.append(0)
    for x in range(W):
        raw.extend(px(x, y))

def chunk(tag, data):
    return struct.pack('>I', len(data)) + tag + data + struct.pack('>I', zlib.crc32(tag + data) & 0xffffffff)

png = b'\x89PNG\r\n\x1a\n'
png += chunk(b'IHDR', struct.pack('>IIBBBBB', W, H, 8, 6, 0, 0, 0))
png += chunk(b'IDAT', zlib.compress(bytes(raw), 9))
png += chunk(b'IEND', b'')

ico = struct.pack('<HHH', 0, 1, 1)
ico += struct.pack('<BBBBHHII', 0, 0, 0, 0, 1, 32, len(png), 22)
ico += png

out = os.path.join(os.path.dirname(__file__), 'icon.ico')
with open(out, 'wb') as f:
    f.write(ico)
print('saved', out, len(ico), 'bytes')
