#!/usr/bin/env python3
"""Propose tile boxes/corners + pip reads for candidate eval-corpus photos,
rendered as overlays for human (Claude-assisted) review before the boxes are
trusted as eval ground truth (§M-1 corpus growth).

NOTE on methodology: corners come from the trained tile detector, not an
independent method — reviewed here by eye per photo specifically to catch
misses (detector recall gaps would otherwise silently vanish from ground
truth rather than count against it) and bad corners. Pip VALUES are always
supplied independently by the reviewer, never taken from the model's own
read, so per-half/identity accuracy stays a fair measurement.

Usage:
  .venv/bin/python train/review_new_eval_photos.py --images DIR --out DIR/proposals.json \
      --preview DIR/previews \
      --tile-weights runs/pose/touch/weights/best.pt \
      --pip-detector-weights runs/detect/pipdet_hn/weights/best.pt
"""
import argparse
import json
from pathlib import Path

import cv2
import numpy as np
from ultralytics import YOLO

from predict import load_pip_detector_reader


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--images", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--preview", required=True)
    ap.add_argument("--tile-weights", default="runs/pose/touch/weights/best.pt")
    ap.add_argument("--pip-detector-weights", default="runs/detect/pipdet_hn/weights/best.pt")
    ap.add_argument("--conf", type=float, default=0.50)
    args = ap.parse_args()

    Path(args.preview).mkdir(parents=True, exist_ok=True)
    model = YOLO(args.tile_weights)
    read_pips = load_pip_detector_reader(args.pip_detector_weights, "cpu")

    paths = sorted(p for p in Path(args.images).iterdir()
                   if p.suffix.lower() in (".jpg", ".jpeg", ".png"))
    result = {}
    for p in paths:
        image = cv2.imread(str(p))
        r = model.predict(str(p), conf=args.conf, iou=0.75, verbose=False)[0]
        kps = r.keypoints.xy.tolist() if r.keypoints is not None else []
        tiles = []
        vis = image.copy()
        for i, (xyxy, conf) in enumerate(zip(r.boxes.xyxy.tolist(), r.boxes.conf.tolist())):
            corners = kps[i] if i < len(kps) else []
            if len(corners) != 4:
                continue
            pip = read_pips(image, corners)
            tiles.append({"tileId": f"t{i:02d}", "corners": corners,
                         "modelFirst": pip["first"], "modelSecond": pip["second"]})
            pts = np.array(corners, np.int32)
            cv2.polylines(vis, [pts], True, (0, 0, 255), 5)
            cx, cy = pts.mean(axis=0).astype(int)
            cv2.putText(vis, f"t{i:02d}:{pip['first']}/{pip['second']}",
                        (cx - 60, cy), cv2.FONT_HERSHEY_SIMPLEX, 1.3, (0, 255, 0), 3)
        result[p.name] = tiles
        small = cv2.resize(vis, (vis.shape[1] // 3, vis.shape[0] // 3))
        cv2.imwrite(str(Path(args.preview) / p.name), small)
        print(f"{p.name}: {len(tiles)} tiles")

    with open(args.out, "w") as f:
        json.dump(result, f, indent=1)
    print(f"wrote {args.out}")


if __name__ == "__main__":
    main()
