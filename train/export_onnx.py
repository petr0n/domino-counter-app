#!/usr/bin/env python3
"""Export the detector to ONNX and verify output parity (build-plan-v2 §8/M2).

  .venv/bin/python train/export_onnx.py --weights runs/pose/<run>/weights/best.pt \
      [--images eval/corpus_photos] [--n 6]

Parity: run the .pt and the exported .onnx through the same Ultralytics
pipeline on real eval photos and compare detections (count, matched-box IoU,
confidence deltas). M2's gate is parity on eval crops + phone budgets; this
script covers the correctness half anywhere.
"""
import argparse
from pathlib import Path

import numpy as np
from ultralytics import YOLO


def detections(model, paths):
    out = []
    for p in paths:
        r = model.predict(str(p), conf=0.20, iou=0.75, verbose=False)[0]
        out.append((r.boxes.xyxy.cpu().numpy(), r.boxes.conf.cpu().numpy()))
    return out


def iou(a, b):
    ix0, iy0 = max(a[0], b[0]), max(a[1], b[1])
    ix1, iy1 = min(a[2], b[2]), min(a[3], b[3])
    if ix1 <= ix0 or iy1 <= iy0:
        return 0.0
    inter = (ix1 - ix0) * (iy1 - iy0)
    area = lambda r: (r[2] - r[0]) * (r[3] - r[1])  # noqa: E731
    return inter / (area(a) + area(b) - inter)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--weights", required=True)
    ap.add_argument("--images", default="eval/corpus_photos")
    ap.add_argument("--n", type=int, default=6)
    ap.add_argument("--opset", type=int, default=17,
                    help="17 = broadly supported incl. ONNX Runtime Web; "
                         "Ultralytics' default (22) breaks ORT <=1.19 and ORT-Web")
    # NOTE: fixed square letterboxing differs from the .pt predictor's
    # min-rectangle letterbox, so borderline detections legitimately differ —
    # measured parity is exact (IoU 1.0, conf delta 0.0) with dynamic shapes.
    # If M2 ships fixed-shape, mirror square letterbox in the JS preprocessing
    # and re-verify parity there.
    ap.add_argument("--fixed", action="store_true",
                    help="export fixed 640x640 input instead of dynamic shapes")
    args = ap.parse_args()

    pt = YOLO(args.weights)
    onnx_path = pt.export(format="onnx", imgsz=640, opset=args.opset,
                          dynamic=not args.fixed)
    print("exported:", onnx_path,
          f"({Path(onnx_path).stat().st_size / 1e6:.1f} MB)")

    paths = sorted(p for p in Path(args.images).iterdir()
                   if p.suffix.lower() in (".jpg", ".jpeg", ".png"))[:args.n]
    det_pt = detections(pt, paths)
    det_ox = detections(YOLO(onnx_path), paths)

    worst_iou, worst_conf, mismatched = 1.0, 0.0, 0
    for (boxes_a, conf_a), (boxes_b, conf_b) in zip(det_pt, det_ox):
        if len(boxes_a) != len(boxes_b):
            mismatched += abs(len(boxes_a) - len(boxes_b))
        for i, ba in enumerate(boxes_a):
            if not len(boxes_b):
                continue
            ious = [iou(ba, bb) for bb in boxes_b]
            j = int(np.argmax(ious))
            if ious[j] > 0.5:
                worst_iou = min(worst_iou, ious[j])
                worst_conf = max(worst_conf, abs(conf_a[i] - conf_b[j]))
    print(f"parity over {len(paths)} photos: "
          f"detection-count mismatches {mismatched}, "
          f"worst matched IoU {worst_iou:.4f}, "
          f"worst confidence delta {worst_conf:.4f}")
    ok = mismatched == 0 and worst_iou > 0.98 and worst_conf < 0.01
    print("PARITY", "OK" if ok else "DEGRADED — investigate before M2")


if __name__ == "__main__":
    main()
