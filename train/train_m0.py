#!/usr/bin/env python3
"""M0 tile-detector training (build-plan-v2 §5.1/§5.5, gate §6-M0).

Runs anywhere with a GPU (Kaggle/Colab) or locally (Apple MPS / CPU):
  .venv/bin/python train/train_m0.py --data train/data/synth/dataset.yaml \
      --epochs 100 [--model yolo11n-pose.pt] [--name m0_run1]

CRITICAL — augmentations that rotate/mirror the image are pinned to 0.
The §5.4 corner winding (index 0 = smallest polar angle from box centre) is
an image-frame property: flip/rotate/shear augs move corners but keep index
assignments, so augmented labels would contradict the winding rule and
corrupt keypoint semantics. Rotation variety comes from the generator, which
re-winds every label after transforming (train/domino_synth/compose.py).
"""
import argparse

from ultralytics import YOLO


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", required=True, help="path to dataset.yaml")
    ap.add_argument("--model", default="yolo11n-pose.pt",
                    help="smallest pose variant first (§5.1)")
    ap.add_argument("--epochs", type=int, default=100)
    ap.add_argument("--imgsz", type=int, default=640)
    ap.add_argument("--batch", type=int, default=16)
    ap.add_argument("--device", default=None, help="e.g. 0, mps, cpu (default: auto)")
    ap.add_argument("--name", default="m0")
    args = ap.parse_args()

    model = YOLO(args.model)
    model.train(
        data=args.data, epochs=args.epochs, imgsz=args.imgsz, batch=args.batch,
        device=args.device, name=args.name,
        # winding-preserving augmentation policy — do not loosen (see docstring)
        fliplr=0.0, flipud=0.0, degrees=0.0, shear=0.0, perspective=0.0,
    )
    metrics = model.val(data=args.data)
    print("synthetic-val box mAP50:", round(metrics.box.map50, 4),
          "| pose mAP50:", round(metrics.pose.map50, 4))
    print("best weights:", model.trainer.best)


if __name__ == "__main__":
    main()
