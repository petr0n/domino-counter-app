"""Crop rectification + divider-bar split (build-plan-v2 §5.2/§5.3).

Shared by Stage-2 training (synthetic crops) and inference (predict.py).
Ported to JS for on-device use at M2 — keep it dependency-light.
"""
import math

import cv2
import numpy as np

RECT_W, RECT_H = 128, 256   # canonical upright tile crop (2:1)
PAD_FRAC = 0.06             # §5.2: pad so tight corners don't clip edge pips
HALF_SIZE = 96              # CNN input: one half, square


def rectify(image, corners):
    """Perspective-rectify a tile to upright RECT_W x RECT_H.

    corners: 4 (x, y) in source-image coords (any order). The end of the tile
    nearer the image top (or left, for horizontal tiles) is mapped to the TOP
    of the output — so top half == 'first' under the §11 convention.
    Returns (crop_bgr, layout) with layout 'vertical'|'horizontal'.
    """
    pts = np.array(corners, np.float32)
    c = pts.mean(axis=0)
    ang = np.arctan2(pts[:, 1] - c[1], pts[:, 0] - c[0]) % (2 * np.pi)
    q = pts[np.argsort(ang)]  # wound quad, consecutive = edges

    e01 = np.linalg.norm(q[0] - q[1])
    e12 = np.linalg.norm(q[1] - q[2])
    # pair the two short edges = the tile's two ends
    if e01 >= e12:  # edges (1,2) and (3,0) are short
        ends = [(q[1], q[2]), (q[3], q[0])]
    else:           # edges (0,1) and (2,3) are short
        ends = [(q[0], q[1]), (q[2], q[3])]
    m0 = (ends[0][0] + ends[0][1]) / 2
    m1 = (ends[1][0] + ends[1][1]) / 2
    axis = m1 - m0
    layout = "vertical" if abs(axis[1]) >= abs(axis[0]) else "horizontal"
    key = 1 if layout == "vertical" else 0
    if m0[key] > m1[key]:               # make ends[0] the top/left end
        ends = [ends[1], ends[0]]

    # order corners as [tl, tr, br, bl] of the upright output: looking along
    # the axis (top end -> bottom end), 'left' has positive 2D cross product
    m0, m1 = (ends[0][0] + ends[0][1]) / 2, (ends[1][0] + ends[1][1]) / 2
    axis = m1 - m0
    tl, tr = ((ends[0][0], ends[0][1])
              if float(np.cross(axis, ends[0][0] - m0)) > 0 else
              (ends[0][1], ends[0][0]))
    bl, br = ((ends[1][0], ends[1][1])
              if float(np.cross(axis, ends[1][0] - m1)) > 0 else
              (ends[1][1], ends[1][0]))
    src = np.array([tl, tr, br, bl], np.float32)
    p = PAD_FRAC * RECT_W
    dst = np.array([[p, p], [RECT_W - p, p],
                    [RECT_W - p, RECT_H - p], [p, RECT_H - p]], np.float32)
    H = cv2.getPerspectiveTransform(src, dst)
    return cv2.warpPerspective(image, H, (RECT_W, RECT_H)), layout


def bar_split(crop_gray):
    """Find the divider bar in an upright rectified crop (§5.3, layered).

    Primary: Sobel edge magnitude perpendicular to the long axis, strongest
    light->dark->light transition pair near the geometric centre. Fallback:
    geometric midpoint. Returns (split_row, tier) with tier 'sobel'|'midpoint'.
    """
    g = cv2.Sobel(crop_gray, cv2.CV_32F, 0, 1, ksize=3)
    profile = np.abs(g).mean(axis=1)
    h = len(profile)
    lo, hi = int(h * 0.38), int(h * 0.62)   # bar is manufactured at the midpoint
    window = profile[lo:hi]
    peak = int(np.argmax(window)) + lo
    # confident = the peak clearly beats the crop's typical edge response
    if profile[peak] > 2.5 * float(np.median(profile) + 1e-6):
        return peak, "sobel"
    return h // 2, "midpoint"


def split_halves(crop, split_row=None):
    """Split a rectified crop into two square half images (top, bottom)."""
    gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY) if crop.ndim == 3 else crop
    tier = None
    if split_row is None:
        split_row, tier = bar_split(gray)
    bar_half = int(RECT_H * 0.025)          # exclude the bar itself
    top = crop[:max(1, split_row - bar_half)]
    bot = crop[min(RECT_H - 1, split_row + bar_half):]
    top = cv2.resize(top, (HALF_SIZE, HALF_SIZE))
    bot = cv2.resize(bot, (HALF_SIZE, HALF_SIZE))
    return top, bot, tier


def pip_angle(corners):
    """Long-axis angle in degrees for §11 orientation reporting."""
    pts = np.array(corners, np.float32)
    c = pts.mean(axis=0)
    ang = np.arctan2(pts[:, 1] - c[1], pts[:, 0] - c[0]) % (2 * np.pi)
    q = pts[np.argsort(ang)]
    v = (q[2] + q[1]) / 2 - (q[0] + q[3]) / 2 \
        if np.linalg.norm(q[0] - q[1]) < np.linalg.norm(q[1] - q[2]) \
        else (q[2] + q[3]) / 2 - (q[0] + q[1]) / 2
    return round(math.degrees(math.atan2(v[1], v[0])) % 180, 1)
