"""Generate the MNDict toolbar icon (pure Python, no dependencies).

MarginNote renders icons as an alpha mask in the UI foreground color, so the
icon is a pure white silhouette on a transparent background: an open book with
a lookup magnifier. 64x64 canvas, 4x supersampled geometry.
Output: public/icon.png (64x64, PNG-32).
"""
import struct
import zlib

SIZE = 64
SCALE = 4
N = SIZE * SCALE


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
    def S(v):
        return v * SCALE

    left_page = [(S(14), S(18)), (S(30), S(23)), (S(30), S(41)), (S(14), S(36))]
    right_page = [(S(50), S(18)), (S(34), S(23)), (S(34), S(41)), (S(50), S(36))]
    cx, cy, radius, stroke = S(44), S(47), S(7), S(3.5)
    handle = ((cx + radius * 0.72, cy + radius * 0.72), (cx + radius * 1.3, cy + radius * 1.3))

    # grayscale coverage, box-downsampled to straight alpha RGBA
    coverage = bytearray(N * N)
    for y in range(N):
        for x in range(N):
            px, py = x + 0.5, y + 0.5
            on = (in_polygon(px, py, left_page) or in_polygon(px, py, right_page)
                  or abs(((px - cx) ** 2 + (py - cy) ** 2) ** 0.5 - radius) <= stroke / 2
                  or dist_segment(px, py, *handle[0], *handle[1]) <= stroke / 2)
            coverage[y * N + x] = 255 if on else 0

    out = bytearray()
    inv = 1 / (SCALE * SCALE)
    for oy in range(SIZE):
        out.append(0)  # PNG filter type 0
        for ox in range(SIZE):
            total = 0
            for sy in range(oy * SCALE, (oy + 1) * SCALE):
                row = sy * N
                for sx in range(ox * SCALE, (ox + 1) * SCALE):
                    total += coverage[row + sx]
            out += bytes((255, 255, 255, round(total * inv)))
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
