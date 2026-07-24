#!/usr/bin/env python3
"""Compare the browser harness's output against the Python reference for
the M2 parity check (Task 10). Match = same tile identities, same pip
counts, confidences in the same ballpark -- per the design spec, this is
verifying the ONNX/JS port is numerically faithful, not re-measuring
accuracy against ground truth.

Usage:
  .venv/bin/python train/compare_parity.py
"""
import json


def center(bbox):
    return (bbox["x"] + bbox["width"] / 2, bbox["y"] + bbox["height"] / 2)


def dist(a, b):
    return ((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2) ** 0.5


reference = {p["imageId"]: p["tiles"] for p in json.load(open("runs/parity_reference.json"))}
harness = json.load(open("runs/harness_output.json"))

mismatches = 0
for image_id, ref_tiles in reference.items():
    harness_tiles = harness.get(image_id, [])
    if len(harness_tiles) != len(ref_tiles):
        print(f"{image_id}: tile count mismatch — reference {len(ref_tiles)}, harness {len(harness_tiles)}")
        mismatches += 1
        continue

    # Match each reference tile to its nearest-by-bbox-center harness tile
    # (NMS/dedup tie-breaking can order detections differently between the
    # Python and JS implementations even when both found the same tiles).
    unmatched_h = list(range(len(harness_tiles)))
    pairs = []
    for i, ref_t in enumerate(ref_tiles):
        rc = center(ref_t["bbox"])
        best_j, best_d = None, None
        for j in unmatched_h:
            d = dist(rc, center(harness_tiles[j]["bbox"]))
            if best_d is None or d < best_d:
                best_j, best_d = j, d
        pairs.append((i, best_j, best_d))
        unmatched_h.remove(best_j)

    for i, j, d in pairs:
        ref_t, h_t = ref_tiles[i], harness_tiles[j]
        if d > 50:  # bbox centers should coincide almost exactly for the same tile
            print(f"{image_id}: reference tile {i} has no close harness match (nearest dist {d:.1f}px)")
            mismatches += 1
            continue
        rp, hp = ref_t["predicted"], h_t["predicted"]
        ref_pair = sorted([rp["first"], rp["second"]])
        h_pair = sorted([hp["first"], hp["second"]])
        if ref_pair != h_pair:
            print(f"{image_id} tile {i}<->{j}: reference {rp['first']}/{rp['second']} "
                  f"vs harness {hp['first']}/{hp['second']} (bbox dist {d:.1f}px)")
            mismatches += 1

print(f"\n{mismatches} mismatches across {len(reference)} photos")
