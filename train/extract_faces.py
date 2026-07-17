#!/usr/bin/env python3
"""Extract rectified tile-face crops from source-capture photos (§4.1 Tier 1).

  PYTHONPATH=train .venv/bin/python train/extract_faces.py \
      --weights runs/pose/realbg/weights/best.pt [--pip-weights runs/pips/best.pt]

Runs the detector on train/data/source_faces/, rectifies each tile at high
resolution, writes crops to train/data/face_crops/ plus contact sheets with
CNN-suggested values for human verification (suggestions are NOT labels —
verify before using them for Stage-2 training; detector training needs no
values). Labels live in train/data/face_crops/labels.json:
{crop filename: "first/second"} — top half of the crop = first.
"""
import argparse
import json
from pathlib import Path

import cv2
import numpy as np
from ultralytics import YOLO

from domino_synth.rectify import rectify
from predict import load_pip_reader

CROP_W, CROP_H = 256, 512


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--weights", required=True)
    ap.add_argument("--pip-weights", default=None)
    ap.add_argument("--images", default="train/data/source_faces")
    ap.add_argument("--out", default="train/data/face_crops")
    ap.add_argument("--conf", type=float, default=0.50)
    ap.add_argument("--device", default=None)
    args = ap.parse_args()

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    model = YOLO(args.weights)
    read_pips = (load_pip_reader(args.pip_weights, args.device or "cpu")
                 if args.pip_weights else None)

    paths = sorted(p for p in Path(args.images).iterdir()
                   if p.suffix.lower() in (".jpg", ".jpeg", ".png"))
    suggestions, sheets, total = {}, [], 0
    for p in paths:
        r = model.predict(str(p), conf=args.conf, iou=0.75,
                          device=args.device, verbose=False)[0]
        im = cv2.imread(str(p))
        kps = r.keypoints.xy.tolist() if r.keypoints is not None else []
        row = []
        for i, corners in enumerate(kps):
            if len(corners) != 4:
                continue
            big, layout = rectify(im, corners, out_w=CROP_W, out_h=CROP_H)
            name = f"{p.stem}_t{i:02d}.jpg"
            cv2.imwrite(str(out / name), big, [cv2.IMWRITE_JPEG_QUALITY, 95])
            total += 1
            tag = ""
            if read_pips:
                s = read_pips(im, corners)
                tag = f"{s['first']}/{s['second']}"
                suggestions[name] = tag
            thumb = cv2.resize(big, (96, 192))
            cv2.putText(thumb, tag, (2, 20), cv2.FONT_HERSHEY_SIMPLEX,
                        0.6, (0, 0, 255), 2)
            cv2.putText(thumb, f"t{i:02d}", (2, 186), cv2.FONT_HERSHEY_SIMPLEX,
                        0.5, (255, 0, 0), 1)
            row.append(thumb)
        for j in range(0, len(row), 13):
            sheets.append((p.stem, j, cv2.hconcat(row[j:j + 13])))
        print(f"{p.name}: {len(row)} tiles")

    for stem, j, sheet in sheets:
        cv2.imwrite(str(out / f"_sheet_{stem}_{j:02d}.jpg"), sheet,
                    [cv2.IMWRITE_JPEG_QUALITY, 90])
    with open(out / "suggestions.json", "w") as f:
        json.dump(suggestions, f, indent=1)
    print(f"{total} crops -> {out}; verify _sheet_*.jpg, then write labels.json")


if __name__ == "__main__":
    main()
