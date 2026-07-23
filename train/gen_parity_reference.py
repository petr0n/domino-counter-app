#!/usr/bin/env python3
"""Select ~12 representative eval photos and generate the Python reference
output for the M2 ONNX parity check (Task 10). Reuses the EXISTING,
unmodified predict.py pipeline -- this is the "ground truth" the JS harness
gets compared against.

Usage:
  .venv/bin/python train/gen_parity_reference.py
"""
import json
import subprocess
from collections import Counter
from pathlib import Path

truth = json.load(open("eval/corpus_merged.json"))

# Pick photos covering a range of tile counts (1, few, many) and a spread of
# pip values (not all-low, not all-high), deterministic (sorted, not random).
by_count = sorted(truth, key=lambda r: len(r["tiles"]))
chosen = set()
for rec in by_count[:3]:       # smallest photos (1-2 tiles)
    chosen.add(rec["imageId"])
for rec in by_count[len(by_count) // 2 - 1: len(by_count) // 2 + 2]:  # mid-size
    chosen.add(rec["imageId"])
for rec in by_count[-3:]:      # largest photos (most tiles)
    chosen.add(rec["imageId"])
# a few more spread through the middle for pip-value variety
step = len(by_count) // 6
for i in range(0, len(by_count), step):
    chosen.add(by_count[i]["imageId"])
    if len(chosen) >= 12:
        break

chosen = sorted(chosen)[:15]
print(f"selected {len(chosen)} photos: {chosen}")
Path("train/data/parity_photos.json").write_text(json.dumps(chosen, indent=1))

# Copy just these photos into a temp dir so predict.py only processes them.
import shutil
tmp = Path("runs/parity_photos")
tmp.mkdir(parents=True, exist_ok=True)
for rec in truth:
    if rec["imageId"] in chosen:
        src = Path(rec["imagePath"])
        shutil.copy(src, tmp / src.name)

subprocess.run([
    ".venv/bin/python", "train/predict.py",
    "--weights", "runs/pose/touch/weights/best.pt",
    "--pip-detector-weights", "runs/detect/pipdet_hn/weights/best.pt",
    "--pip-detector-conf", "0.85",
    "--images", str(tmp),
    "--out", "runs/parity_reference.json",
], check=True)
