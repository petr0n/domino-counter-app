#!/usr/bin/env python3
"""Export the production tile/pip detectors to int8 ONNX for on-device use
(M2). Exact API verified against the installed ultralytics==8.4.96 --
`quantize=8` + `data=<calibration dataset.yaml>`, NOT the commonly-documented
`int8=True` (that flag doesn't exist in this version).

Usage:
  .venv/bin/python train/export_onnx.py
"""
from ultralytics import YOLO


def main():
    tile = YOLO("runs/pose/touch/weights/best.pt")
    tile_path = tile.export(format="onnx", quantize=8,
                            data="train/data/calib_tiles/dataset.yaml",
                            imgsz=640, simplify=True)
    print("tile detector exported:", tile_path)

    pip = YOLO("runs/detect/pipdet_hn/weights/best.pt")
    pip_path = pip.export(format="onnx", quantize=8,
                          data="train/data/calib_pips/dataset.yaml",
                          imgsz=384, simplify=True)
    print("pip detector exported:", pip_path)


if __name__ == "__main__":
    main()
