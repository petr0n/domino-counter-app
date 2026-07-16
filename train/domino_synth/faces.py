"""Tier-1 sprite source: real tile-face crops (build-plan-v2 §4.1, primary tier).

Loads rectified face crops (train/extract_faces.py output) + labels.json and
turns each into a paste-ready sprite dict interchangeable with render_tile()
output. Alpha is a rounded-rect mask; crops are already tight tile faces.
"""
import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

from .rectify import PAD_FRAC


def load_face_sprites(dir_path):
    """Returns list of {image RGBA, corners, first, second} sprite dicts."""
    d = Path(dir_path)
    labels = json.loads((d / "labels.json").read_text())
    sprites = []
    for name, val in labels.items():
        img = Image.open(d / name).convert("RGB")
        w, h = img.size
        # crops carry PAD_FRAC background margin from rectification — trim it
        p = int(PAD_FRAC * w * 0.9)
        img = img.crop((p, p, w - p, h - p))
        w, h = img.size
        rgba = img.convert("RGBA")
        mask = Image.new("L", (w, h), 0)
        ImageDraw.Draw(mask).rounded_rectangle(
            [0, 0, w - 1, h - 1], radius=w * 0.06, fill=255)
        rgba.putalpha(mask)
        first, second = map(int, val.split("/"))
        sprites.append({"image": rgba,
                        "corners": [(0.0, 0.0), (float(w), 0.0),
                                    (float(w), float(h)), (0.0, float(h))],
                        "first": first, "second": second})
    return sprites
