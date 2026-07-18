#!/usr/bin/env python3
"""Generate a synthetic YOLO-Pose dataset of domino scenes (build-plan-v2 §4).

Usage:
  python train/generate.py --num 200 --out train/data/synth \
      [--backgrounds DIR] [--seed 0] [--preview 8]

Emits images/{train,val}, labels/{train,val}, dataset.yaml. Without
--backgrounds it uses procedural textures — good enough to smoke-test the
pipeline, NOT for the M0 training run (curate real backgrounds, §4.1).
"""
import argparse
import random
from pathlib import Path

import cv2
import numpy as np

from domino_synth import ALL_TILES, compose_scene, render_tile, to_yolo_pose_line

DATASET_YAML = """\
# Synthetic domino tiles — YOLO-Pose (bbox + 4 corner keypoints, §5.1/§5.4)
#
# IMPORTANT: train with fliplr=0, flipud=0, degrees=0, shear=0, perspective=0
# (train/train_m0.py pins these). The corner winding rule (polar-angle sort,
# §5.4) is an image-frame property: any aug that mirrors OR rotates the image
# moves corners without re-sorting indices, corrupting keypoint semantics.
# Rotation variety comes from this generator, which winds labels after
# transforming. Scale/translate/mosaic/HSV augs are fine.
path: {root}  # absolute path — Ultralytics resolves relative paths against its
              # global datasets_dir, not this file; regenerated per machine
train: images/train
val: images/val
kpt_shape: [4, 3]
flip_idx: [0, 1, 2, 3]
names:
  0: domino_tile
"""


def load_backgrounds(dir_path):
    if not dir_path:
        return []
    paths = [p for p in Path(dir_path).iterdir()
             if p.suffix.lower() in (".jpg", ".jpeg", ".png", ".webp")]
    return [cv2.imread(str(p)) for p in sorted(paths)]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--num", type=int, default=200)
    ap.add_argument("--out", default="train/data/synth")
    ap.add_argument("--backgrounds", default=None)
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--val-frac", type=float, default=0.1)
    ap.add_argument("--max-tiles", type=int, default=10)
    ap.add_argument("--bg-frac", type=float, default=0.05,
                    help="fraction of images with no tiles (cuts false positives)")
    ap.add_argument("--faces", default=None,
                    help="face-crop dir (Tier 1); tiles are drawn from real "
                         "crops with this probability, rendered otherwise")
    ap.add_argument("--face-frac", type=float, default=0.5)
    ap.add_argument("--touch-frac", type=float, default=0.0,
                    help="probability each non-first tile is placed touching "
                         "a random already-placed tile (§1: may touch, never "
                         "overlap) — trains corner-keypoint precision at "
                         "touching seams, rare under pure random placement")
    ap.add_argument("--preview", type=int, default=0,
                    help="also write N label-overlay previews for sanity checks")
    args = ap.parse_args()

    rng = np.random.default_rng(args.seed)
    py_rng = random.Random(args.seed)
    faces = []
    if args.faces:
        from domino_synth.faces import load_face_sprites
        faces = load_face_sprites(args.faces)
        print(f"{len(faces)} Tier-1 face sprites")
    bgs = load_backgrounds(args.backgrounds)
    if not bgs:
        print("WARNING: no backgrounds given — using procedural fallback "
              "textures (smoke-test only, not for M0 training)")

    out = Path(args.out)
    for split in ("train", "val"):
        (out / "images" / split).mkdir(parents=True, exist_ok=True)
        (out / "labels" / split).mkdir(parents=True, exist_ok=True)
    (out / "dataset.yaml").write_text(DATASET_YAML.format(root=out.resolve()))

    n_val = max(1, int(args.num * args.val_frac))
    tile_total = 0
    for i in range(args.num):
        if rng.random() < args.bg_frac:
            tiles = []
        else:
            n_tiles = int(rng.integers(1, args.max_tiles + 1))
            tiles = []
            for _ in range(n_tiles):
                if faces and rng.random() < args.face_frac:
                    tiles.append(py_rng.choice(faces))
                else:
                    a, b = py_rng.choice(ALL_TILES)
                    tiles.append(render_tile(py_rng, *py_rng.choice([(a, b), (b, a)])))
        bg = bgs[int(rng.integers(len(bgs)))] if bgs else None
        w = int(rng.integers(640, 1281))
        h = int(rng.integers(480, 1025))
        img, labels = compose_scene(rng, tiles, bg, canvas_w=w, canvas_h=h,
                                    touch_frac=args.touch_frac)
        tile_total += len(labels)

        split = "val" if i < n_val else "train"
        name = f"synth_{i:06d}"
        cv2.imwrite(str(out / "images" / split / f"{name}.jpg"), img)
        lines = [to_yolo_pose_line(lb, w, h) for lb in labels]
        (out / "labels" / split / f"{name}.txt").write_text("\n".join(lines))

        if i < args.preview:
            vis = img.copy()
            for lb in labels:
                x0, y0, x1, y1 = map(int, lb["bbox"])
                cv2.rectangle(vis, (x0, y0), (x1, y1), (0, 255, 0), 2)
                for k, (x, y) in enumerate(lb["corners"]):
                    cv2.circle(vis, (int(x), int(y)), 5, (0, 0, 255), -1)
                    cv2.putText(vis, str(k), (int(x) + 6, int(y)),
                                cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 0, 255), 2)
                cv2.putText(vis, f'{lb["first"]}/{lb["second"]}', (x0, y0 - 6),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 255, 0), 2)
            (out / "previews").mkdir(exist_ok=True)
            cv2.imwrite(str(out / "previews" / f"{name}.jpg"), vis)

    print(f"wrote {args.num} images ({n_val} val), {tile_total} tile labels "
          f"-> {out}")


if __name__ == "__main__":
    main()
