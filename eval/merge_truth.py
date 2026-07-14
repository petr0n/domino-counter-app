#!/usr/bin/env python3
"""Merge the recovered pip-value truth with box/keypoint annotations (§M-1).

Inputs:
  --truth  eval/corpus_truth.json  (per photo: {"truth": [[a, b], ...]} —
           hand-verified pip pairs; "mine" is old first-pass data, ignored)
  --coco   COCO-keypoints export from the annotation tool (Roboflow/CVAT):
           each tile = one annotation with bbox [x, y, w, h], 4 keypoints
           (the tile corners) and a category named "<first>_<second>"
           (also accepts "first-second" / "first/second"), where FIRST is the
           half whose centre is closer to the image top (§11 convention).
  --out    merged §11 eval-annotation JSON for eval/score.py.

Validates that each photo's unordered pip-pair multiset matches the recovered
truth; mismatches are reported and block writing (fix labels, or --force).
Corner keypoints are re-sorted into the canonical §5.4 winding regardless of
the order the tool exported them in.
"""
import argparse
import json
import math
import re
import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "train"))
from domino_synth.winding import wind_corners  # noqa: E402


def parse_pair(name):
    m = re.fullmatch(r"(\d{1,2})[_\-/](\d{1,2})", name.strip())
    if not m:
        raise ValueError(f"category name {name!r} is not '<first>_<second>'")
    a, b = int(m.group(1)), int(m.group(2))
    if not (0 <= a <= 12 and 0 <= b <= 12):
        raise ValueError(f"pip values out of 0-12 in category {name!r}")
    return a, b


def orientation_from_corners(corners):
    """Layout + long-axis angle from the wound corner quad (§5.3)."""
    e01 = math.dist(corners[0], corners[1])
    e12 = math.dist(corners[1], corners[2])
    if e01 >= e12:  # edge 0-1 (and 2-3) is the long edge
        vx = corners[1][0] - corners[0][0]
        vy = corners[1][1] - corners[0][1]
    else:
        vx = corners[2][0] - corners[1][0]
        vy = corners[2][1] - corners[1][1]
    ang = math.degrees(math.atan2(vy, vx)) % 180
    layout = "vertical" if 45 <= ang < 135 else "horizontal"
    return layout, round(ang, 1)


def merge(truth, coco):
    imgs = {i["id"]: i for i in coco["images"]}
    cats = {c["id"]: c["name"] for c in coco["categories"]}
    by_img = {}
    for ann in coco["annotations"]:
        by_img.setdefault(ann["image_id"], []).append(ann)

    records, problems = [], []
    seen_files = set()
    for img_id, anns in sorted(by_img.items()):
        info = imgs[img_id]
        fname = Path(info["file_name"]).name
        seen_files.add(fname)
        if fname not in truth:
            problems.append(f"{fname}: not in corpus truth")
            continue
        expected = Counter(tuple(sorted(p)) for p in truth[fname]["truth"])
        got = Counter()
        tiles = []
        for k, ann in enumerate(anns):
            first, second = parse_pair(cats[ann["category_id"]])
            got[tuple(sorted((first, second)))] += 1
            kps = ann["keypoints"]
            if len(kps) != 12:
                problems.append(f"{fname}: annotation {k} has {len(kps)//3} keypoints, need 4")
                continue
            corners = wind_corners([(kps[i], kps[i + 1]) for i in range(0, 12, 3)])
            x, y, w, h = ann["bbox"]
            layout, ang = orientation_from_corners(corners)
            lo, hi = sorted((first, second))
            tiles.append({
                "tileId": f"t{k:02d}",
                "identity": {"first": first, "second": second,
                             "display": f"{first}/{second}",
                             "unorderedKey": f"{lo}-{hi}"},
                "observedOrder": {
                    "firstMeaning": "top" if layout == "vertical" else "left",
                    "secondMeaning": "bottom" if layout == "vertical" else "right"},
                "bbox": {"x": x, "y": y, "width": w, "height": h},
                "corners": [{"x": round(cx, 1), "y": round(cy, 1)}
                            for cx, cy in corners],
                "orientation": {"layout": layout, "rotationDegrees": ang},
            })
        if got != expected:
            missing = expected - got
            extra = got - expected
            problems.append(f"{fname}: pip-pair mismatch vs corpus truth "
                            f"(missing {dict(missing)}, extra {dict(extra)})")
        records.append({"imageId": Path(fname).stem,
                        "imagePath": f"eval/corpus_photos/{fname}",
                        "imageWidth": info["width"], "imageHeight": info["height"],
                        "tiles": tiles})

    for fname in sorted(set(truth) - seen_files):
        problems.append(f"{fname}: in corpus truth but has no annotations")
    return records, problems


def _self_test():
    truth = {"p1.jpg": {"truth": [[2, 12], [5, 0]], "mine": []}}
    coco = {
        "images": [{"id": 1, "file_name": "p1.jpg", "width": 800, "height": 600}],
        "categories": [{"id": 1, "name": "12_2"}, {"id": 2, "name": "0_5"}],
        "annotations": [
            # vertical tile, corners given in a scrambled order on purpose
            {"image_id": 1, "category_id": 1, "bbox": [100, 100, 100, 200],
             "keypoints": [100, 300, 2, 100, 100, 2, 200, 300, 2, 200, 100, 2]},
            {"image_id": 1, "category_id": 2, "bbox": [400, 100, 200, 100],
             "keypoints": [400, 100, 2, 600, 100, 2, 600, 200, 2, 400, 200, 2]},
        ],
    }
    recs, problems = merge(truth, coco)
    assert problems == [], problems
    t0, t1 = recs[0]["tiles"]
    assert t0["identity"]["unorderedKey"] == "2-12"
    assert t0["orientation"]["layout"] == "vertical"
    assert t0["observedOrder"]["firstMeaning"] == "top"
    # winding: index 0 = smallest polar angle from centre (bottom-right quadrant)
    assert t0["corners"][0] == {"x": 200, "y": 300}, t0["corners"]
    assert t1["orientation"]["layout"] == "horizontal"
    assert t1["observedOrder"]["firstMeaning"] == "left"
    # mismatch detection
    truth_bad = {"p1.jpg": {"truth": [[2, 12], [6, 0]], "mine": []}}
    _, problems = merge(truth_bad, coco)
    assert any("mismatch" in p for p in problems), problems
    print("self-test OK")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--truth", default="eval/corpus_truth.json")
    ap.add_argument("--coco")
    ap.add_argument("--out", default="eval/corpus_merged.json")
    ap.add_argument("--force", action="store_true",
                    help="write output even with validation problems")
    ap.add_argument("--self-test", action="store_true")
    args = ap.parse_args()
    if args.self_test:
        _self_test()
        return
    if not args.coco:
        ap.error("--coco is required (or --self-test)")
    with open(args.truth) as f:
        truth = json.load(f)
    with open(args.coco) as f:
        coco = json.load(f)
    records, problems = merge(truth, coco)
    for p in problems:
        print(f"PROBLEM: {p}", file=sys.stderr)
    if problems and not args.force:
        sys.exit(f"{len(problems)} problem(s) — fix annotations or use --force")
    with open(args.out, "w") as f:
        json.dump(records, f, indent=1)
    n_tiles = sum(len(r["tiles"]) for r in records)
    print(f"wrote {args.out}: {len(records)} images, {n_tiles} tiles")


if __name__ == "__main__":
    main()
