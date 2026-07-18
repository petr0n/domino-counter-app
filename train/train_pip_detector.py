#!/usr/bin/env python3
"""Pip-detector training (build-plan-v2 §5.2 target architecture).

  .venv/bin/python train/train_pip_detector.py \
      --data train/data/pips_yolo/dataset.yaml --epochs 60

Single class ("pip"), plain YOLO detection (not pose — no keypoints needed).
Unlike the tile detector, flips are safe here: a pip's own identity carries
no chirality (there's no winding-order convention to preserve), so no
augmentation policy needs pinning.
"""
import argparse

from ultralytics import YOLO


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", required=True)
    ap.add_argument("--model", default="yolo11n.pt", help="plain detection, not -pose")
    ap.add_argument("--epochs", type=int, default=60)
    ap.add_argument("--imgsz", type=int, default=384)
    ap.add_argument("--batch", type=int, default=16)
    ap.add_argument("--device", default=None)
    ap.add_argument("--name", default="pipdet")
    args = ap.parse_args()

    model = YOLO(args.model)
    model.train(data=args.data, epochs=args.epochs, imgsz=args.imgsz,
                batch=args.batch, device=args.device, name=args.name)
    metrics = model.val(data=args.data)
    print("synthetic-val box mAP50:", round(metrics.box.map50, 4))
    print("best weights:", model.trainer.best)


if __name__ == "__main__":
    main()
