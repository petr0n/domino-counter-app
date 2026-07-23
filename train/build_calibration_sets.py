#!/usr/bin/env python3
"""Build minimal real-photo calibration datasets for int8 ONNX export
(M2 design doc: calibration must be real photos, not synthetic, so
quantization scale/precision reflects real capture conditions).

Usage:
  .venv/bin/python train/build_calibration_sets.py
"""
import shutil
from pathlib import Path

TILE_YAML = """\
path: {root}
train: images/val
val: images/val
kpt_shape: [4, 3]
flip_idx: [0, 1, 2, 3]
names:
  0: domino_tile
"""

PIP_YAML = """\
path: {root}
train: images/val
val: images/val
names:
  0: pip
"""


def build(out_dir, yaml_template, source_images):
    out = Path(out_dir)
    (out / "images" / "val").mkdir(parents=True, exist_ok=True)
    (out / "labels" / "val").mkdir(parents=True, exist_ok=True)
    for p in source_images:
        shutil.copy(p, out / "images" / "val" / p.name)
    (out / "dataset.yaml").write_text(yaml_template.format(root=out.resolve()))
    print(f"{len(source_images)} images -> {out}")


def main():
    tile_images = sorted(Path("eval/corpus_photos").glob("*.jpg"))[:40]
    build("train/data/calib_tiles", TILE_YAML, tile_images)

    pip_images = sorted(Path("train/data/face_crops").glob("*.jpg"))[:200]
    build("train/data/calib_pips", PIP_YAML, pip_images)


if __name__ == "__main__":
    main()
