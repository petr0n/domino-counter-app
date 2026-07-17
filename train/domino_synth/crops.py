"""Stage-2 training-crop generator (build-plan-v2 §5.2 baseline).

Each sample walks the real inference path: render tile -> paste onto a
background with rotation/perspective -> photometric noise -> add Gaussian
noise to the 4 corners (simulating detector keypoint error) -> rectify ->
bar-split -> two labeled half images. Labels stay exact because we know
which rendered half maps to the rectified top (§5.3 top/left-first rule).
"""
import numpy as np
import cv2

from .compose import _dest_quad, _paste, _photometric, _fallback_background
from .render import render_tile
from .rectify import rectify, split_halves, RECT_H

CORNER_NOISE_FRAC = 0.015   # sigma of keypoint error, fraction of long side


def make_half_pair(rng, py_rng, first, second, background=None):
    """Returns (top_img, top_count, bottom_img, bottom_count, tier)."""
    tile = render_tile(py_rng, first, second, long_px=384)
    sprite = cv2.cvtColor(np.array(tile["image"]), cv2.COLOR_RGBA2BGRA)
    sh, sw = sprite.shape[:2]

    cw, ch = 560, 560
    canvas = (_fallback_background(rng, cw, ch) if background is None
              else cv2.resize(background, (cw, ch)).copy())
    scale = rng.uniform(0.45, 0.68) * ch / sh
    # centred placement so the tile always fits fully inside the canvas
    for _ in range(50):
        centre = (cw / 2 + rng.uniform(-25, 25), ch / 2 + rng.uniform(-25, 25))
        quad = _dest_quad(rng, sw, sh, scale, cw, ch, center=centre)
        if quad[:, 0].min() >= 0 and quad[:, 1].min() >= 0 and \
           quad[:, 0].max() < cw and quad[:, 1].max() < ch:
            break
    else:
        return None
    _paste(canvas, sprite, tile["corners"], quad)
    canvas = _photometric(rng, canvas)

    noise = rng.normal(0, CORNER_NOISE_FRAC * sh * scale, (4, 2))
    corners = np.clip(quad + noise, [0, 0], [cw - 1, ch - 1])

    crop, layout = rectify(canvas, [tuple(p) for p in corners])
    # which rendered half is at the rectified top? (§5.3 top/left-first)
    top_mid = (quad[0] + quad[1]) / 2        # sprite 'first' end
    bot_mid = (quad[2] + quad[3]) / 2        # sprite 'second' end
    key = 1 if layout == "vertical" else 0
    top_is_first = top_mid[key] <= bot_mid[key]

    if rng.random() < 0.3:  # sometimes simulate bar-localization error
        split = int(RECT_H * (0.5 + rng.uniform(-0.04, 0.04)))
        top, bot, tier = *split_halves(crop, split)[:2], "forced"
    else:
        top, bot, tier = split_halves(crop)

    tc, bc = (first, second) if top_is_first else (second, first)
    return _aug(rng, top), tc, _aug(rng, bot), bc, tier


def _aug(rng, half):
    """Symmetry augs only — every pip layout stays a valid layout."""
    if rng.random() < 0.5:
        half = cv2.rotate(half, cv2.ROTATE_180)
    if rng.random() < 0.5:
        half = cv2.flip(half, 1)
    return half
