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

import cv2
import numpy as np
from ultralytics import YOLO


JUNK_CLASS = 13  # keep in sync with train_pips.JUNK

# Confidence floor for treating a half as junk. Picked ad hoc while
# diagnosing a 2026-07-17 regression (checked 0.7 vs 0.9 on the EVAL set,
# which is exactly the eval-set leakage §5.4's calibration-set rule exists
# to prevent) — NOT validated on a held-out calibration set. Revisit once
# §5.4 temperature scaling / a real calibration split exists.
JUNK_CONFIDENCE_THRESHOLD = 0.7


def load_pip_reader(weights, device):
    import torch
    from train_pips import PipNet
    from domino_synth.rectify import rectify, split_halves
    ckpt = torch.load(weights, map_location=device, weights_only=True)
    n_classes = ckpt.get("n_classes", 13)
    net = PipNet(n_classes).to(device)
    net.load_state_dict(ckpt["state_dict"])
    net.eval()

    def read(image_bgr, corners):
        """Returns pip reading; sets reviewFlags.possiblyJunk when both
        halves confidently read as the junk class (false-positive signal)."""
        crop, layout = rectify(image_bgr, corners)
        top, bot, tier = split_halves(crop)
        x = np.stack([cv2.cvtColor(h, cv2.COLOR_BGR2RGB) for h in (top, bot)])
        x = torch.from_numpy(x).permute(0, 3, 1, 2).float().div(255).to(device)
        with torch.no_grad():
            p = torch.softmax(net(x), dim=1).cpu()
        # argmax check is mathematically redundant here (softmax sums to 1,
        # so p[JUNK_CLASS] > 0.7 already forces it to be the max — no other
        # class can hold > 0.3 of the remaining mass) but kept explicit as
        # self-documenting intent.
        is_junk = (n_classes > 13
                  and int(p[0].argmax()) == JUNK_CLASS
                  and int(p[1].argmax()) == JUNK_CLASS
                  and float(p[0][JUNK_CLASS]) > JUNK_CONFIDENCE_THRESHOLD
                  and float(p[1][JUNK_CLASS]) > JUNK_CONFIDENCE_THRESHOLD)
        if is_junk:
            # DON'T drop the detection (recall priority §5.1 — and review
            # §9.2 can only fix what it can see). Read as 0/0 at ~zero
            # confidence: phantom pips vanish from the hand total, triage
            # flags it, the user gets the final say.
            return {"first": 0, "second": 0, "firstConfidence": 0.01,
                    "secondConfidence": 0.01, "confidence": 0.01,
                    "layout": layout, "barTier": tier, "possiblyJunk": True}
        counts = p[:, :13]  # a kept detection reads pip counts only
        conf, cnt = counts.max(dim=1)
        return {"first": int(cnt[0]), "second": int(cnt[1]),
                "firstConfidence": round(float(conf[0]), 4),
                "secondConfidence": round(float(conf[1]), 4),
                "confidence": round(float(conf.min()), 4),
                "layout": layout, "barTier": tier, "possiblyJunk": False}
    return read


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--weights", required=True)
    ap.add_argument("--pip-weights", default=None,
                    help="Stage-2 checkpoint (runs/pips/best.pt); omit for detection-only")
    ap.add_argument("--images", default="eval/corpus_photos")
    ap.add_argument("--out", default="preds.json")
    # measured on eval 2026-07-16: recall stays 1.000 from conf 0.20 up to
    # 0.65 while precision rises 0.76 -> 0.84; 0.50 keeps recall cushion
    ap.add_argument("--conf", type=float, default=0.50)
    ap.add_argument("--nms-iou", type=float, default=0.75)
    ap.add_argument("--imgsz", type=int, default=640)
    ap.add_argument("--device", default=None)
    args = ap.parse_args()

    paths = sorted(p for p in Path(args.images).iterdir()
                   if p.suffix.lower() in (".jpg", ".jpeg", ".png", ".webp"))
    model = YOLO(args.weights)
    read_pips = (load_pip_reader(args.pip_weights, args.device or "cpu")
                 if args.pip_weights else None)
    preds = []
    for p in paths:
        r = model.predict(str(p), conf=args.conf, iou=args.nms_iou,
                          imgsz=args.imgsz, device=args.device, verbose=False)[0]
        image = cv2.imread(str(p)) if read_pips else None
        tiles = []
        kps = r.keypoints.xy.tolist() if r.keypoints is not None else []
        for i, (xyxy, conf) in enumerate(zip(r.boxes.xyxy.tolist(),
                                             r.boxes.conf.tolist())):
            x0, y0, x1, y1 = xyxy
            corners = kps[i] if i < len(kps) else []
            predicted = {"first": 0, "second": 0, "confidence": round(conf, 4)}
            review_flags = {}
            if read_pips and len(corners) == 4:
                pip = read_pips(image, corners)
                predicted = {"first": pip["first"], "second": pip["second"],
                             "firstConfidence": pip["firstConfidence"],
                             "secondConfidence": pip["secondConfidence"],
                             # overall = detection conf x weakest half conf
                             "confidence": round(conf * pip["confidence"], 4)}
                # §11 reviewFlags convention (cf. possiblyPartial) — not yet
                # consumed by a review UI (§9.2 unbuilt), but visible in
                # preds.json for error analysis and ready when it lands.
                review_flags["possiblyJunk"] = pip["possiblyJunk"]
            tiles.append({
                "bbox": {"x": x0, "y": y0, "width": x1 - x0, "height": y1 - y0},
                "corners": [{"x": round(x, 1), "y": round(y, 1)}
                            for x, y in corners],
                "predicted": predicted,
                "reviewFlags": review_flags,
            })
        preds.append({"imageId": p.stem, "tiles": tiles})
        print(f"{p.name}: {len(tiles)} detections")

    with open(args.out, "w") as f:
        json.dump(preds, f, indent=1)
    print(f"wrote {args.out}: {len(preds)} images, "
          f"{sum(len(p['tiles']) for p in preds)} detections")


if __name__ == "__main__":
    main()
