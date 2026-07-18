"""Scene compositor (build-plan-v2 §4.1): paste rendered tiles onto backgrounds,
emit YOLO-Pose labels (bbox + 4 corner keypoints, deterministic winding §5.4).

Hard domain rule: tiles may touch edge-to-edge but NEVER overlap (§1).
Paste boundaries are alpha-blurred (Cut-Paste-Learn implementation must).
"""
import math

import cv2
import numpy as np
from PIL import Image

from .winding import wind_corners

MIN_VISIBLE_AREA_FRAC = 0.4  # drop tiles more cut off than this at frame edge


def _fallback_background(rng, w, h):
    """Procedural texture for pipeline smoke tests ONLY — real M0 training
    needs a curated real-background pool (§4.1)."""
    small = rng.integers(0, 255, (rng.integers(2, 12), rng.integers(2, 12), 3),
                         dtype=np.uint8)
    bg = cv2.resize(small, (w, h), interpolation=cv2.INTER_CUBIC)
    noise = rng.normal(0, rng.uniform(2, 12), (h, w, 3))
    return np.clip(bg.astype(np.float64) + noise, 0, 255).astype(np.uint8)


def _quad_area(q):
    x, y = q[:, 0], q[:, 1]
    return 0.5 * abs(np.dot(x, np.roll(y, 1)) - np.dot(y, np.roll(x, 1)))


def _overlaps(quad, placed):
    """True if quad materially overlaps any placed quad (touching is OK:
    quads are shrunk 2% toward their centroid before the test)."""
    def shrink(q):
        c = q.mean(axis=0)
        return ((q - c) * 0.98 + c).astype(np.float32)

    a = shrink(quad)
    for p in placed:
        area, _ = cv2.intersectConvexConvex(a, shrink(p))
        if area > 1e-6:
            return True
    return False


def _dest_quad(rng, sw, sh, scale, canvas_w, canvas_h, center=None):
    """Random destination quad: scale + rotation + mild perspective jitter."""
    w, h = sw * scale, sh * scale
    theta = rng.uniform(0, 2 * math.pi)
    cos, sin = math.cos(theta), math.sin(theta)
    base = np.array([[-w / 2, -h / 2], [w / 2, -h / 2],
                     [w / 2, h / 2], [-w / 2, h / 2]])
    rot = base @ np.array([[cos, -sin], [sin, cos]]).T
    jitter = rng.uniform(-0.04, 0.04, (4, 2)) * [w, h]  # mild perspective
    quad = rot + jitter
    if center is None:
        margin = 0.1 * max(w, h)  # some tiles may hang off the frame edge (§4.4)
        center = (rng.uniform(-margin, canvas_w + margin),
                  rng.uniform(-margin, canvas_h + margin))
    return (quad + center).astype(np.float32)


def _touching_quad(rng, sw, sh, scale, prev_quad):
    """A destination quad placed edge-to-edge against a random edge of
    prev_quad (build-plan §1: tiles may touch but never overlap).

    Measured 2026-07-18: touching only ever happened by accident under
    uniform random placement (rare given typical canvas/tile size ratios),
    so the tile-detector's corner keypoints were never specifically trained
    on touching seams — the observed failure (corner bleed into a touching
    neighbor) traces directly to that training-data gap.
    """
    w, h = sw * scale, sh * scale
    edge = rng.integers(4)
    p0, p1 = prev_quad[edge], prev_quad[(edge + 1) % 4]
    edge_vec = p1 - p0
    edge_len = float(np.linalg.norm(edge_vec))
    if edge_len < 1e-3:
        return None
    edge_dir = edge_vec / edge_len
    normal = np.array([-edge_dir[1], edge_dir[0]])
    centroid = prev_quad.mean(axis=0)
    # outward normal: point away from the tile's own centroid
    if np.dot(normal, (p0 + p1) / 2 - centroid) < 0:
        normal = -normal
    delta_theta = math.radians(rng.uniform(-15, 15))  # slight angle variety
    # theta: new tile's rotation so its local bottom edge (0,+h/2), which R
    # maps to (-sin theta, cos theta), points along `normal` — i.e. the new
    # tile's near edge faces back toward the seed tile, touching it.
    theta = math.atan2(-normal[0], normal[1]) + delta_theta
    cos_t, sin_t = math.cos(theta), math.sin(theta)
    R = np.array([[cos_t, -sin_t], [sin_t, cos_t]])
    base = np.array([[-w / 2, -h / 2], [w / 2, -h / 2],
                     [w / 2, h / 2], [-w / 2, h / 2]])
    quad = base @ R.T
    mid = (p0 + p1) / 2
    center = mid + normal * (h / 2 * 0.999)  # 0.999: touch, avoid true overlap
    return (quad + center).astype(np.float32)


def _paste(canvas, sprite_rgba, src_corners, dst_quad, shadow=None):
    """shadow: optional (dx, dy, strength) — soft drop shadow so pasted tiles
    don't float; missing shadows are a classic paste artifact (§4.5)."""
    h, w = canvas.shape[:2]
    H = cv2.getPerspectiveTransform(np.array(src_corners, np.float32), dst_quad)
    warped = cv2.warpPerspective(sprite_rgba, H, (w, h),
                                 flags=cv2.INTER_LINEAR,
                                 borderMode=cv2.BORDER_CONSTANT, borderValue=0)
    alpha = warped[:, :, 3].astype(np.float64) / 255.0
    alpha = cv2.GaussianBlur(alpha, (3, 3), 0)  # blend paste boundary
    if shadow is not None:
        dx, dy, strength = shadow
        side = float(np.sqrt(cv2.contourArea(dst_quad.astype(np.float32))) + 1)
        M = np.float32([[1, 0, dx * side], [0, 1, dy * side]])
        sh = cv2.warpAffine(alpha, M, (w, h))
        sh = cv2.GaussianBlur(sh, (0, 0), max(1.0, side * 0.03))
        canvas[:] = (canvas * (1 - strength * sh[:, :, None])).astype(np.uint8)
    alpha = alpha[:, :, None]
    canvas[:] = (warped[:, :, :3] * alpha + canvas * (1 - alpha)).astype(np.uint8)


def _photometric(rng, img):
    out = img.astype(np.float64)
    out *= rng.uniform(0.55, 1.35)                      # brightness
    out = (out - 128) * rng.uniform(0.75, 1.2) + 128    # contrast
    out *= rng.uniform(0.85, 1.15, 3)                   # color cast
    out = np.clip(out, 0, 255)
    out = 255 * (out / 255) ** rng.uniform(0.8, 1.25)   # gamma
    img = np.clip(out, 0, 255).astype(np.uint8)
    blur = rng.random()
    if blur < 0.25:
        img = cv2.GaussianBlur(img, (0, 0), rng.uniform(0.5, 2.0))
    elif blur < 0.4:  # motion blur
        k = rng.integers(3, 10)
        kern = np.zeros((k, k))
        kern[k // 2, :] = 1.0 / k
        M = cv2.getRotationMatrix2D((k / 2 - 0.5, k / 2 - 0.5),
                                    rng.uniform(0, 180), 1)
        kern = cv2.warpAffine(kern, M, (k, k))
        img = cv2.filter2D(img, -1, kern / max(kern.sum(), 1e-6))
    if rng.random() < 0.5:  # sensor noise
        img = np.clip(img + rng.normal(0, rng.uniform(1, 8), img.shape),
                      0, 255).astype(np.uint8)
    q = int(rng.integers(55, 96))  # JPEG artifacts
    ok, enc = cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, q])
    return cv2.imdecode(enc, cv2.IMREAD_COLOR) if ok else img


def compose_scene(rng, tiles, background, canvas_w=1024, canvas_h=768,
                  max_attempts=40, touch_frac=0.0):
    """Composite tiles (render_tile dicts) onto a background.

    background: HxWx3 uint8 BGR or None (procedural fallback).
    Returns (image_bgr, labels) where each label is
    {corners: [(x,y)*4 wound], bbox: (x0,y0,x1,y1), first, second,
     clipped: bool}. Tiles that don't fit without overlap are skipped.
    """
    if background is None:
        canvas = _fallback_background(rng, canvas_w, canvas_h)
    else:
        canvas = cv2.resize(background, (canvas_w, canvas_h)).copy()

    # one light direction per scene: consistent soft shadows for every tile
    ang = rng.uniform(0, 2 * math.pi)
    mag = rng.uniform(0.005, 0.03)
    shadow = (mag * math.cos(ang), mag * math.sin(ang), rng.uniform(0.15, 0.45))

    placed, labels = [], []
    for tile in tiles:
        sprite = np.array(tile["image"])  # RGBA, RGB order
        sprite = cv2.cvtColor(sprite, cv2.COLOR_RGBA2BGRA)
        sh, sw = sprite.shape[:2]
        scale = rng.uniform(0.12, 0.35) * canvas_h / sh
        quad = None
        frame = np.array([[0, 0], [canvas_w, 0], [canvas_w, canvas_h],
                          [0, canvas_h]], np.float32)
        if placed and rng.random() < touch_frac:
            for _ in range(8):  # a few tries: different neighbour/edge/angle
                q = _touching_quad(rng, sw, sh, scale, placed[int(rng.integers(len(placed)))])
                if q is None:
                    continue
                vis, _ = cv2.intersectConvexConvex(q, frame)
                if (vis >= MIN_VISIBLE_AREA_FRAC * _quad_area(q)
                        and not _overlaps(q, placed)):
                    quad = q
                    break
        if quad is None:
            for _ in range(max_attempts):
                q = _dest_quad(rng, sw, sh, scale, canvas_w, canvas_h)
                vis, _ = cv2.intersectConvexConvex(q, frame)
                if vis < MIN_VISIBLE_AREA_FRAC * _quad_area(q):
                    continue
                if not _overlaps(q, placed):
                    quad = q
                    break
        if quad is None:
            continue
        placed.append(quad)
        _paste(canvas, sprite, tile["corners"], quad, shadow=shadow)

        wound = wind_corners([tuple(p) for p in quad])
        clipped = bool((quad[:, 0].min() < 0) or (quad[:, 1].min() < 0) or
                       (quad[:, 0].max() > canvas_w) or (quad[:, 1].max() > canvas_h))
        cx = np.clip(quad[:, 0], 0, canvas_w)
        cy = np.clip(quad[:, 1], 0, canvas_h)
        labels.append({"corners": wound,
                       "bbox": (float(cx.min()), float(cy.min()),
                                float(cx.max()), float(cy.max())),
                       "first": tile["first"], "second": tile["second"],
                       "clipped": clipped})

    return _photometric(rng, canvas), labels


def to_yolo_pose_line(label, img_w, img_h):
    """One YOLO-Pose label line: class cx cy w h + 4x (x y v), normalized.
    v=2 visible, v=1 for corners clamped at the frame edge."""
    x0, y0, x1, y1 = label["bbox"]
    cx, cy = (x0 + x1) / 2 / img_w, (y0 + y1) / 2 / img_h
    bw, bh = (x1 - x0) / img_w, (y1 - y0) / img_h
    parts = [f"0 {cx:.6f} {cy:.6f} {bw:.6f} {bh:.6f}"]
    for x, y in label["corners"]:
        inside = 0 <= x <= img_w and 0 <= y <= img_h
        xn = min(max(x / img_w, 0.0), 1.0)
        yn = min(max(y / img_h, 0.0), 1.0)
        parts.append(f"{xn:.6f} {yn:.6f} {2 if inside else 1}")
    return " ".join(parts)
