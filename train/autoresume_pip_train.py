#!/usr/bin/env python3
"""Auto-resuming supervisor for pip-detector training on MPS.

The PyTorch MPS backend has been observed (2026-07-21) to crash silently --
no traceback, no OOM/jetsam log entry -- roughly every 10-15 epochs during
long pip-detector training runs, while the identical workload runs the full
60 epochs on CPU without a single crash. This wraps `caffeinate -i` +
`YOLO(...).train(resume=True)` in a retry loop: on each crash it re-launches
training from the last checkpoint, but first health-checks that checkpoint
(predicts on a known val image, expects several boxes) so a corrupted
checkpoint is never blindly resumed.

Usage (weights-dir must already contain a `last.pt` to resume from -- start
training normally first, this is for taking over supervision mid-run or
restarting after a crash):
  .venv/bin/python train/autoresume_pip_train.py \\
      --weights-dir runs/detect/pipdet_greyfix2_narrow/weights \\
      --val-image train/data/pips_yolo_greyfix2/images/val/pip_000000.jpg \\
      --log-prefix /tmp/eval_candidates/train_greyfix2_narrow
"""
import argparse
import subprocess
import sys
import time
from pathlib import Path


def health_check(weights_dir, val_image):
    from ultralytics import YOLO
    model = YOLO(str(Path(weights_dir) / "last.pt"))
    r = model.predict(val_image, conf=0.3, verbose=False)[0]
    return len(r.boxes)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--weights-dir", required=True)
    ap.add_argument("--val-image", required=True)
    ap.add_argument("--log-prefix", required=True)
    ap.add_argument("--max-retries", type=int, default=20)
    ap.add_argument("--min-healthy-boxes", type=int, default=5)
    args = ap.parse_args()

    for attempt in range(1, args.max_retries + 1):
        log_path = f"{args.log_prefix}_auto{attempt}.log"
        print(f"[autoresume] attempt {attempt}: resuming, log -> {log_path}")
        code = (
            "from ultralytics import YOLO; "
            f"YOLO('{args.weights_dir}/last.pt').train(resume=True)"
        )
        with open(log_path, "w") as log_f:
            proc = subprocess.run(
                ["caffeinate", "-i", ".venv/bin/python3", "-c", code],
                stdout=log_f, stderr=subprocess.STDOUT,
            )

        text = Path(log_path).read_text(errors="replace")
        if "Results saved to" in text:
            print(f"[autoresume] training complete after {attempt} attempt(s)")
            return 0

        print(f"[autoresume] died (exit {proc.returncode}) on attempt {attempt} "
              "-- health-checking checkpoint before resuming")
        try:
            boxes = health_check(args.weights_dir, args.val_image)
        except Exception as e:
            print(f"[autoresume] health-check itself failed: {e} -- STOPPING")
            return 1
        print(f"[autoresume] checkpoint health-check: {boxes} boxes detected")
        if boxes < args.min_healthy_boxes:
            print("[autoresume] checkpoint looks unhealthy -- STOPPING, "
                  "needs manual investigation")
            return 1
        time.sleep(5)

    print(f"[autoresume] exceeded max retries ({args.max_retries}) without completion")
    return 1


if __name__ == "__main__":
    sys.exit(main())
