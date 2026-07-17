"""Tier-2 procedural tile renderer (build-plan-v2 §4.1).

Renders a single upright domino tile as an RGBA sprite from the canonical pip
grid. Randomization is strictly color-agnostic for pips (full spectrum,
excluding pure black and excluding too-light-to-see-on-white); tile body is
always white and the divider bar always black — universal domino facts, never
randomized (CLAUDE.md).
"""
import colorsys

from PIL import Image, ImageDraw, ImageFilter

from .grids import pip_positions

_SS = 2  # supersampling factor for antialiasing


def _pip_color(rng):
    """Random pip color: any hue/darkness except pure black or near-white.

    The luminance cap must stay HIGH: real sets use bright yellow / light
    blue pips (luminance ~0.8) that remain visible via saturation and the
    embossed outline, and capping at 0.72 made the pip CNN blind to them
    (measured on eval 2026-07-16: yellow/light-blue 10-halves read as 6).
    """
    while True:
        h, s, v = rng.random(), rng.uniform(0.2, 1.0), rng.uniform(0.06, 0.97)
        r, g, b = colorsys.hsv_to_rgb(h, s, v)
        lum = 0.299 * r + 0.587 * g + 0.114 * b
        # exclude only near-white/unsaturated-light (invisible on white body)
        if lum <= 0.88 and not (lum > 0.72 and s < 0.45):
            return (int(r * 255), int(g * 255), int(b * 255))


def _draw_half(draw, count, x0, y0, size, rng, mirror_x, mirror_y):
    r = size * rng.uniform(0.085, 0.12)
    color = _pip_color(rng)
    outline = tuple(int(c * 0.55) for c in color)
    gloss = rng.random() < 0.5
    for px, py in pip_positions(count):
        if mirror_x:
            px = 1.0 - px
        if mirror_y:
            py = 1.0 - py
        cx, cy = x0 + px * size, y0 + py * size
        draw.ellipse([cx - r, cy - r, cx + r, cy + r], fill=color,
                     outline=outline, width=max(1, int(r * 0.18)))
        if gloss:
            gr = r * 0.3
            gx, gy = cx - r * 0.35, cy - r * 0.35
            hi = tuple(min(255, int(c + 90)) for c in color)
            draw.ellipse([gx - gr, gy - gr, gx + gr, gy + gr], fill=hi)


def render_tile(rng, first, second, long_px=512):
    """Render one upright 2:1 tile; `first` is the TOP half.

    Returns dict: image (RGBA sprite), corners (4 rect corners in sprite px,
    clockwise from top-left), first, second.
    """
    w, h = long_px // 2, long_px
    W, H = w * _SS, h * _SS
    img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    # Body: always white (slight off-white variation only)
    base = rng.randint(238, 255)
    tint = (base, base - rng.randint(0, 6), base - rng.randint(0, 10))
    radius = W * rng.uniform(0.03, 0.10)
    draw.rounded_rectangle([0, 0, W - 1, H - 1], radius=radius, fill=tint + (255,))
    # subtle edge shading
    edge = tuple(int(c * rng.uniform(0.6, 0.85)) for c in tint)
    draw.rounded_rectangle([0, 0, W - 1, H - 1], radius=radius,
                           outline=edge + (255,), width=max(1, int(W * 0.012)))

    # Divider bar: always black (slight dark variation only), centred
    bar_v = rng.randint(0, 32)
    bar_h = H * rng.uniform(0.012, 0.03)
    inset = W * rng.uniform(0.03, 0.10)
    draw.rectangle([inset, H / 2 - bar_h / 2, W - inset, H / 2 + bar_h / 2],
                   fill=(bar_v, bar_v, bar_v, 255))
    if rng.random() < 0.4:  # some sets have a centre dot/rivet on the bar
        dr = bar_h * rng.uniform(0.5, 0.9)
        draw.ellipse([W / 2 - dr, H / 2 - dr, W / 2 + dr, H / 2 + dr],
                     fill=(bar_v, bar_v, bar_v, 255))

    # Pips: each half is a square of side w, inset slightly from the bar
    pad = H * 0.01
    _draw_half(draw, first, 0, pad, W, rng,
               rng.random() < 0.5, rng.random() < 0.5)
    _draw_half(draw, second, 0, H - W - pad, W, rng,
               rng.random() < 0.5, rng.random() < 0.5)

    if rng.random() < 0.3:  # mild gloss sheen across the tile
        sheen = Image.new("L", (W, H), 0)
        sd = ImageDraw.Draw(sheen)
        y = rng.uniform(0, H)
        sd.ellipse([-W, y - H * 0.4, W * 2, y + H * 0.4], fill=28)
        sheen = sheen.filter(ImageFilter.GaussianBlur(W * 0.2))
        white = Image.new("RGBA", (W, H), (255, 255, 255, 0))
        white.putalpha(sheen)
        img = Image.alpha_composite(img, white)

    img = img.resize((w, h), Image.LANCZOS)
    corners = [(0.0, 0.0), (float(w), 0.0), (float(w), float(h)), (0.0, float(h))]
    return {"image": img, "corners": corners, "first": first, "second": second}
