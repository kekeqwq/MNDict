"""Generate the MNDict toolbar icon (pure Python, no dependencies).

Renders at 4x and box-filters down for antialiasing: a purple gradient
rounded square with a white open book and a small lookup magnifier.
Output: public/icon.png (88x88, PNG-32).
"""
import struct
import zlib

SIZE = 88
SCALE = 4
N = SIZE * SCALE


def rounded_rect(px, py, x0, y0, x1, y1, radius):
    dx = max(x0 + radius - px, 0, px - (x1 - radius))
    dy = max(y0 + radius - py, 0, py - (y1 - radius))
    return dx * dx + dy * dy <= radius * radius


def in_polygon(px, py, points):
    inside = False
    j = len(points) - 1
    for i, (xi, yi) in enumerate(points):
        xj, yj = points[j]
        if (yi > py) != (yj > py) and px < (xj - xi) * (py - yi) / (yj - yi) + xi:
            inside = not inside
        j = i
    return inside


def dist_segment(px, py, ax, ay, bx, by):
    vx, vy = bx - ax, by - ay
    wx, wy = px - ax, py - ay
    t = max(0.0, min(1.0, (wx * vx + wy * vy) / (vx * vx + vy * vy)))
    dx, dy = px - (ax + t * vx), py - (ay + t * vy)
    return (dx * dx + dy * dy) ** 0.5


def render():
    bg = (0, 0, 0, 0)
    white = (255, 255, 255, 255)
    # 4x RGB accumulation with straight alpha
    buf = [[list(bg) for _ in range(N)] for _ in range(N)]
    margin = 3 * SCALE
    radius = 20 * SCALE
    spine_x = N / 2
    for y in range(N):
        mix = y / N
        top, bottom = (139, 92, 246), (109, 55, 180)  # violet -> deep purple
        tint = tuple(round(top[i] + (bottom[i] - top[i]) * mix) for i in range(3)) + (255,)
        for x in range(N):
            px, py = x + 0.5, y + 0.5
            on = False
            if rounded_rect(px, py, margin, margin, N - margin, N - margin, radius):
                on = True
                buf[y][x] = list(tint)
            # open book: two pages leaning toward the spine
            left_page = [(22 * SCALE, 26 * SCALE), (spine_x - 2 * SCALE, 32 * SCALE),
                         (spine_x - 2 * SCALE, 58 * SCALE), (22 * SCALE, 52 * SCALE)]
            right_page = [(N - 22 * SCALE, 26 * SCALE), (spine_x + 2 * SCALE, 32 * SCALE),
                          (spine_x + 2 * SCALE, 58 * SCALE), (N - 22 * SCALE, 52 * SCALE)]
            if on and (in_polygon(px, py, left_page) or in_polygon(px, py, right_page)):
                buf[y][x] = list(white)
            # lookup magnifier at bottom-right, overlapping the book
            cx, cy, r, stroke = 58 * SCALE, 58 * SCALE, 10 * SCALE, 3.2 * SCALE
            ring = abs(((px - cx) ** 2 + (py - cy) ** 2) ** 0.5 - r) <= stroke / 2
            handle = dist_segment(px, py, cx + r * 0.72, cy + r * 0.72,
                                  cx + r * 1.65, cy + r * 1.65) <= stroke / 2
            if on and (ring or handle):
                buf[y][x] = list(white)
    # box downsample
    out = bytearray()
    inv = 1 / (SCALE * SCALE)
    for oy in range(SIZE):
        out.append(0)  # PNG filter type 0
        for ox in range(SIZE):
            r = g = b = a = 0
            for sy in range(oy * SCALE, (oy + 1) * SCALE):
                for sx in range(ox * SCALE, (ox + 1) * SCALE):
                    pr, pg, pb, pa = buf[sy][sx]
                    r += pr * pa; g += pg * pa; b += pb * pa; a += pa
            if a:
                out += bytes((round(r / a), round(g / a), round(b / a), round(a * inv)))
            else:
                out += b"\x00\x00\x00\x00"
    return bytes(out)


def chunk(tag, data):
    return (struct.pack(">I", len(data)) + tag + data +
            struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF))


raw = render()
png = (b"\x89PNG\r\n\x1a\n"
       + chunk(b"IHDR", struct.pack(">IIBBBBB", SIZE, SIZE, 8, 6, 0, 0, 0))
       + chunk(b"IDAT", zlib.compress(raw, 9))
       + chunk(b"IEND", b""))
with open("public/icon.png", "wb") as handle:
    handle.write(png)
print(f"public/icon.png {len(png)} bytes")
