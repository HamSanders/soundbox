"""Placeholder art for the Windows installer (NSIS wizard).

Draws the Mirli waveform mark from app/public/favicon.svg onto the dusk
background, at the two sizes the NSIS wizard wants:

  sidebar.bmp  164 x 314  welcome and finish pages
  header.bmp   150 x 57   the strip on the inner pages

Both are 24-bit BMP (NSIS does not read anything else). There is no text in
the art on purpose, so a rename does not mean redrawing it. Replace these with
the real brand art when it exists; the wiring in tauri.conf.json stays.

  python scripts/gen-installer-art.py
"""

import re
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
SVG = (ROOT / "app/public/favicon.svg").read_text(encoding="utf8")
OUT = ROOT / "src-tauri/installer"

DUSK = (0x18, 0x18, 0x17)
CREAM = (0xF1, 0xEC, 0xE0)
SIGNAL = (0xF2, 0xA4, 0x0C)
SS = 4  # supersampling


def wave_points():
    """Sample the favicon's one path (M plus cubic C segments) into points."""
    d = re.search(r'<path d="([^"]+)"', SVG).group(1)
    nums = [float(n) for n in re.findall(r"-?\d+(?:\.\d+)?", d)]
    x, y, rest = nums[0], nums[1], nums[2:]
    pts = [(x, y)]
    for i in range(0, len(rest), 6):
        x1, y1, x2, y2, x3, y3 = rest[i : i + 6]
        for s in range(1, 13):
            t = s / 12
            u = 1 - t
            px = u**3 * x + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t**3 * x3
            py = u**3 * y + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t**3 * y3
            pts.append((px, py))
        x, y = x3, y3
    return pts


def draw_wave(img, box, color, width_ratio=0.055):
    """Fit the wave into box=(x0, y0, x1, y1), keeping its proportions."""
    pts = wave_points()
    xs, ys = [p[0] for p in pts], [p[1] for p in pts]
    x0, y0, x1, y1 = box
    scale = min((x1 - x0) / (max(xs) - min(xs)), (y1 - y0) / (max(ys) - min(ys)))
    ox = x0 + ((x1 - x0) - (max(xs) - min(xs)) * scale) / 2 - min(xs) * scale
    oy = y0 + ((y1 - y0) - (max(ys) - min(ys)) * scale) / 2 - min(ys) * scale
    pts = [(ox + px * scale, oy + py * scale) for px, py in pts]
    w = max(2, (max(xs) - min(xs)) * scale * width_ratio)
    d = ImageDraw.Draw(img)
    # Stamp round dots along the path, densified so the stroke has no gaps or
    # speckled joins.
    r = w / 2
    for (ax, ay), (bx, by) in zip(pts, pts[1:]):
        steps = max(1, int(max(abs(bx - ax), abs(by - ay)) / (r / 3)))
        for k in range(steps + 1):
            t = k / steps
            cx, cy = ax + (bx - ax) * t, ay + (by - ay) * t
            d.ellipse((cx - r, cy - r, cx + r, cy + r), fill=color)


def canvas(w, h):
    return Image.new("RGB", (w * SS, h * SS), DUSK)


def finish(img, w, h, name):
    img.resize((w, h), Image.LANCZOS).save(OUT / name, format="BMP")


def sidebar():
    w, h = 164, 314
    img = canvas(w, h)
    draw_wave(img, (14 * SS, 96 * SS, (w - 14) * SS, 190 * SS), CREAM)
    d = ImageDraw.Draw(img)
    d.rectangle((14 * SS, 214 * SS, 44 * SS, 217 * SS), fill=SIGNAL)  # the signal tick
    finish(img, w, h, "sidebar.bmp")


def header():
    w, h = 150, 57
    img = canvas(w, h)
    draw_wave(img, (22 * SS, 12 * SS, (w - 22) * SS, (h - 12) * SS), CREAM)
    finish(img, w, h, "header.bmp")


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    sidebar()
    header()
    print("wrote", OUT / "sidebar.bmp", OUT / "header.bmp")
