#!/usr/bin/env python3
"""Run the tile detector on eval photos, emit scorer-format predictions.

  .venv/bin/python train/predict.py --weights runs/pose/m0/weights/best.pt \
      --images eval/corpus_photos --out preds.json

Output matches eval/score.py's prediction schema. Stage 2 (pip counting)
doesn't exist yet, so predicted.first/second are 0 placeholders — only the
"detection" block of score.py output is meaningful for M0 (recall gate).

Detection is recall-biased (§5.1): low confidence threshold, permissive NMS
(high IoU threshold) so touching tiles' overlapping axis-aligned boxes don't
suppress each other.
"""
import argparse
import json
from pathlib import Path

from ultralytics import YOLO


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--weights", required=True)
    ap.add_argument("--images", default="eval/corpus_photos")
    ap.add_argument("--out", default="preds.json")
    ap.add_argument("--conf", type=float, default=0.20)
    ap.add_argument("--nms-iou", type=float, default=0.75)
    ap.add_argument("--imgsz", type=int, default=640)
    ap.add_argument("--device", default=None)
    args = ap.parse_args()

    paths = sorted(p for p in Path(args.images).iterdir()
                   if p.suffix.lower() in (".jpg", ".jpeg", ".png", ".webp"))
    model = YOLO(args.weights)
    preds = []
    for p in paths:
        r = model.predict(str(p), conf=args.conf, iou=args.nms_iou,
                          imgsz=args.imgsz, device=args.device, verbose=False)[0]
        tiles = []
        kps = r.keypoints.xy.tolist() if r.keypoints is not None else []
        for i, (xyxy, conf) in enumerate(zip(r.boxes.xyxy.tolist(),
                                             r.boxes.conf.tolist())):
            x0, y0, x1, y1 = xyxy
            tiles.append({
                "bbox": {"x": x0, "y": y0, "width": x1 - x0, "height": y1 - y0},
                "corners": [{"x": round(x, 1), "y": round(y, 1)}
                            for x, y in (kps[i] if i < len(kps) else [])],
                "predicted": {"first": 0, "second": 0,  # Stage 2 TBD
                              "confidence": round(conf, 4)},
            })
        preds.append({"imageId": p.stem, "tiles": tiles})
        print(f"{p.name}: {len(tiles)} detections")

    with open(args.out, "w") as f:
        json.dump(preds, f, indent=1)
    print(f"wrote {args.out}: {len(preds)} images, "
          f"{sum(len(p['tiles']) for p in preds)} detections")


if __name__ == "__main__":
    main()
