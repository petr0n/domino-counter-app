#!/usr/bin/env python3
"""Generate a synthetic YOLO-detection dataset for the pip-detector target
(build-plan-v2 §5.2 "target" architecture — replaces the 13-way per-half
classifier when it plateaus).

The classifier baseline plateaued at per-half ~0.90-0.92 (gate 0.97),
specifically on a true-11-read-as-7 confusion that four independent
training-side levers (class balance, crop resolution, real/synthetic data
weight, classical blob-count heuristic) all failed to move — see PR history
2026-07-17/18. Detecting individual pips as objects and counting them
sidesteps the "classify a dense pattern as one of 13 blobs" problem entirely.

Trains on RENDERED TILES DIRECTLY as stand-ins for Stage 1's rectified crop
output (no scene compositing needed — a pip's defining feature, "filled
circle on white", is a robust geometric primitive that should transfer
synthetic-to-real the same way tile-shape detection did; note Tier-1 real
sprites actually HURT the tile detector, so real data is intentionally
skipped here too, at least for this first pass).

Usage:
  PYTHONPATH=train .venv/bin/python train/generate_pip_detections.py \
      --num 6000 --out train/data/pips_yolo
"""
import argparse
import math
import random
from pathlib import Path

import cv2
import numpy as np

from domino_synth.compose import _photometric
from domino_synth.grids import ALL_TILES
from domino_synth.render import render_tile
from domino_synth.rectify import RECT_W, RECT_H

DATASET_YAML = """\
# Synthetic pip detector — single class, axis-aligned boxes (build-plan §5.2)
path: {root}
train: images/train
val: images/val
names:
  0: pip
"""


def jitter_crop(rng, img_bgr, pip_boxes, out_size):
    """Mild rotation + perspective jitter simulating imperfect rectification,
    then resize to out_size. pip_boxes: list of (x0,y0,x1,y1) in img_bgr px."""
    h, w = img_bgr.shape[:2]
    src = np.float32([[0, 0], [w, 0], [w, h], [0, h]])
    ang = math.radians(rng.uniform(-4, 4))
    cos, sin = math.cos(ang), math.sin(ang)
    cx, cy = w / 2, h / 2
    rot = np.array([[cos, -sin], [sin, cos]])
    dst = np.array([(np.array([x, y]) - [cx, cy]) @ rot.T + [cx, cy]
                    for x, y in src], np.float32)
    dst += rng.uniform(-0.03, 0.03, dst.shape) * [w, h]  # perspective wobble
    H = cv2.getPerspectiveTransform(src, dst.astype(np.float32))
    warped = cv2.warpPerspective(img_bgr, H, (w, h), borderMode=cv2.BORDER_REPLICATE)

    boxes = []
    for x0, y0, x1, y1 in pip_boxes:
        pts = np.float32([[x0, y0], [x1, y0], [x1, y1], [x0, y1]]).reshape(-1, 1, 2)
        wpts = cv2.perspectiveTransform(pts, H).reshape(-1, 2)
        boxes.append((wpts[:, 0].min(), wpts[:, 1].min(),
                     wpts[:, 0].max(), wpts[:, 1].max()))

    sx, sy = out_size[0] / w, out_size[1] / h
    warped = cv2.resize(warped, out_size)
    boxes = [(x0 * sx, y0 * sy, x1 * sx, y1 * sy) for x0, y0, x1, y1 in boxes]
    return warped, boxes


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--num", type=int, default=6000)
    ap.add_argument("--out", default="train/data/pips_yolo")
    ap.add_argument("--val-frac", type=float, default=0.1)
    ap.add_argument("--seed", type=int, default=0)
    # Defaults MUST match domino_synth.rectify.RECT_W/RECT_H: the detector
    # runs on the exact rectified tile crop (both halves + bar) at
    # inference, then pips are partitioned to halves using the existing
    # bar_split() row — no separate resize step, no running detection twice.
    ap.add_argument("--out-w", type=int, default=RECT_W)
    ap.add_argument("--out-h", type=int, default=RECT_H)
    ap.add_argument("--preview", type=int, default=0)
    args = ap.parse_args()

    rng = np.random.default_rng(args.seed)
    py_rng = random.Random(args.seed)

    out = Path(args.out)
    for split in ("train", "val"):
        (out / "images" / split).mkdir(parents=True, exist_ok=True)
        (out / "labels" / split).mkdir(parents=True, exist_ok=True)
    (out / "dataset.yaml").write_text(DATASET_YAML.format(root=out.resolve()))

    n_val = max(1, int(args.num * args.val_frac))
    for i in range(args.num):
        a, b = py_rng.choice(ALL_TILES)
        first, second = py_rng.choice([(a, b), (b, a)])
        long_px = int(rng.integers(384, 513))
        tile = render_tile(py_rng, first, second, long_px=long_px)
        img = cv2.cvtColor(np.array(tile["image"]), cv2.COLOR_RGBA2BGR)
        img, boxes = jitter_crop(rng, img, tile["pip_boxes"],
                                 (args.out_w, args.out_h))
        img = _photometric(rng, img)

        split = "val" if i < n_val else "train"
        name = f"pip_{i:06d}"
        cv2.imwrite(str(out / "images" / split / f"{name}.jpg"), img)
        H, W = img.shape[:2]
        lines = []
        for x0, y0, x1, y1 in boxes:
            x0, x1 = np.clip([x0, x1], 0, W)
            y0, y1 = np.clip([y0, y1], 0, H)
            if x1 - x0 < 2 or y1 - y0 < 2:
                continue  # rotated fully out of frame
            cx, cy = (x0 + x1) / 2 / W, (y0 + y1) / 2 / H
            bw, bh = (x1 - x0) / W, (y1 - y0) / H
            lines.append(f"0 {cx:.6f} {cy:.6f} {bw:.6f} {bh:.6f}")
        (out / "labels" / split / f"{name}.txt").write_text("\n".join(lines))

        if i < args.preview:
            vis = img.copy()
            for x0, y0, x1, y1 in boxes:
                cv2.rectangle(vis, (int(x0), int(y0)), (int(x1), int(y1)), (0, 0, 255), 1)
            (out / "previews").mkdir(exist_ok=True)
            cv2.imwrite(str(out / "previews" / f"{name}.jpg"), vis)

    print(f"wrote {args.num} images ({n_val} val) -> {out}")


if __name__ == "__main__":
    main()
