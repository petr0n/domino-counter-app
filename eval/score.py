#!/usr/bin/env python3
"""Scoring harness — computes the build-plan-v2 §7 metrics.

Usage:
  python eval/score.py --truth eval/corpus_merged.json --pred preds.json
  python eval/score.py --self-test

Truth: list of §11 eval-image annotations
  [{imageId, tiles: [{identity: {first, second}, bbox: {x,y,width,height}}]}]
  (identity.first = the half whose centre is closer to the image top, §11.)
Predictions: list per image, §5.4-shaped
  [{imageId, tiles: [{bbox: {x,y,width,height},
                      predicted: {first, second, confidence}}]}]

Matching is greedy by confidence at IoU >= threshold. Per-half accuracy is
order-invariant (best alignment of the two halves) so a 180°-flipped read
isn't double-counted as two wrong halves; order correctness is reported
separately (§5.3: order never affects the hand total).
"""
import argparse
import json
import math
from collections import defaultdict


def iou(a, b):
    ax0, ay0, ax1, ay1 = a["x"], a["y"], a["x"] + a["width"], a["y"] + a["height"]
    bx0, by0, bx1, by1 = b["x"], b["y"], b["x"] + b["width"], b["y"] + b["height"]
    iw = min(ax1, bx1) - max(ax0, bx0)
    ih = min(ay1, by1) - max(ay0, by0)
    if iw <= 0 or ih <= 0:
        return 0.0
    inter = iw * ih
    union = (ax1 - ax0) * (ay1 - ay0) + (bx1 - bx0) * (by1 - by0) - inter
    return inter / union


def wilson_ci(k, n, z=1.96):
    """95% Wilson score interval for a proportion (§6 statistical power note)."""
    if n == 0:
        return (0.0, 0.0)
    p = k / n
    denom = 1 + z * z / n
    centre = (p + z * z / (2 * n)) / denom
    half = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / denom
    return (max(0.0, centre - half), min(1.0, centre + half))


def match_image(gt_tiles, pred_tiles, iou_thr):
    """Greedy match: predictions in confidence order take the best unmatched GT."""
    order = sorted(range(len(pred_tiles)),
                   key=lambda i: -pred_tiles[i]["predicted"].get("confidence", 0))
    taken, pairs, fps = set(), [], []
    for pi in order:
        best, best_iou = None, iou_thr
        for gi, gt in enumerate(gt_tiles):
            if gi in taken:
                continue
            v = iou(pred_tiles[pi]["bbox"], gt["bbox"])
            if v >= best_iou:
                best, best_iou = gi, v
        if best is None:
            fps.append(pi)
        else:
            taken.add(best)
            pairs.append((best, pi))
    return pairs, fps, [gi for gi in range(len(gt_tiles)) if gi not in taken]


def score(truth, preds, iou_thr=0.5, near=3):
    pred_by_img = {p["imageId"]: p["tiles"] for p in preds}
    n_gt = n_pred = n_matched = 0
    halves_ok = tiles_seen = identity_ok = order_ok = order_applicable = 0
    hand_rows, photo_exact = [], 0
    conf_correct = []  # (confidence, identity correct) incl. FPs — feeds ECE
    by_count = defaultdict(lambda: [0, 0])  # tiles-in-photo -> [exact hands, hands]

    for rec in truth:
        gt = rec["tiles"]
        pd = pred_by_img.get(rec["imageId"], [])
        n_gt += len(gt)
        n_pred += len(pd)
        pairs, fps, _ = match_image(gt, pd, iou_thr)
        n_matched += len(pairs)

        all_ident_ok = len(pairs) == len(gt) and not fps
        for gi, pi in pairs:
            g, p = gt[gi]["identity"], pd[pi]["predicted"]
            gpair, ppair = (g["first"], g["second"]), (p["first"], p["second"])
            strict = (gpair[0] == ppair[0]) + (gpair[1] == ppair[1])
            flipped = (gpair[0] == ppair[1]) + (gpair[1] == ppair[0])
            halves_ok += max(strict, flipped)  # order-invariant half accuracy
            tiles_seen += 1
            ident = sorted(gpair) == sorted(ppair)
            identity_ok += ident
            if ident and gpair[0] != gpair[1]:  # order only meaningful here
                order_applicable += 1
                order_ok += gpair == ppair
            if not ident:
                all_ident_ok = False
            conf_correct.append((p.get("confidence", 0.0), ident))
        for pi in fps:
            conf_correct.append((pd[pi]["predicted"].get("confidence", 0.0), False))

        gt_total = sum(t["identity"]["first"] + t["identity"]["second"] for t in gt)
        pd_total = sum(t["predicted"]["first"] + t["predicted"]["second"] for t in pd)
        hand_rows.append((gt_total, pd_total))
        exact = gt_total == pd_total
        photo_exact += all_ident_ok
        by_count[len(gt)][0] += exact
        by_count[len(gt)][1] += 1

    n_img = len(truth)
    errs = [abs(g - p) for g, p in hand_rows]
    hand_exact = sum(e == 0 for e in errs)
    ece, bins = _ece(conf_correct)

    def prop(k, n):
        lo, hi = wilson_ci(k, n)
        return {"value": k / n if n else 0.0, "n": n, "ci95": [round(lo, 4), round(hi, 4)]}

    return {
        "detection": {
            "recall": prop(n_matched, n_gt),
            "precision": prop(n_matched, n_pred),
            "missedTiles": n_gt - n_matched,
            "falsePositives": n_pred - n_matched,
            "iouThreshold": iou_thr,
        },
        "value": {
            "perHalfAccuracy": prop(halves_ok, 2 * tiles_seen),
            "exactTileIdentityAccuracy": prop(identity_ok, tiles_seen),
            "orderAccuracy": prop(order_ok, order_applicable),
            "fullPhotoExactHandRate": prop(photo_exact, n_img),
        },
        "handTotal": {
            "mae": sum(errs) / n_img if n_img else 0.0,
            "exactRate": prop(hand_exact, n_img),
            f"within{near}Rate": prop(sum(e <= near for e in errs), n_img),
            "byTileCount": {str(k): {"exact": v[0], "hands": v[1]}
                            for k, v in sorted(by_count.items())},
        },
        "calibration": {"ece": ece, "reliabilityBins": bins},
    }


def _ece(conf_correct, n_bins=10):
    """Expected Calibration Error over matched + false-positive predictions."""
    total = len(conf_correct)
    if total == 0:
        return 0.0, []
    bins = []
    ece = 0.0
    for b in range(n_bins):
        lo, hi = b / n_bins, (b + 1) / n_bins
        members = [(c, ok) for c, ok in conf_correct
                   if (lo <= c < hi) or (b == n_bins - 1 and c == 1.0)]
        if not members:
            continue
        avg_conf = sum(c for c, _ in members) / len(members)
        acc = sum(ok for _, ok in members) / len(members)
        ece += len(members) / total * abs(avg_conf - acc)
        bins.append({"range": [lo, hi], "n": len(members),
                     "avgConfidence": round(avg_conf, 4), "accuracy": round(acc, 4)})
    return round(ece, 4), bins


def _self_test():
    truth = [
        {"imageId": "a", "tiles": [
            {"identity": {"first": 2, "second": 12},
             "bbox": {"x": 0, "y": 0, "width": 100, "height": 200}},
            {"identity": {"first": 0, "second": 5},
             "bbox": {"x": 300, "y": 0, "width": 100, "height": 200}},
        ]},
        {"imageId": "b", "tiles": [
            {"identity": {"first": 6, "second": 6},
             "bbox": {"x": 0, "y": 0, "width": 200, "height": 100}},
        ]},
    ]
    preds = [
        {"imageId": "a", "tiles": [
            # matched, identity right, order flipped (12/2 vs 2/12)
            {"bbox": {"x": 2, "y": 2, "width": 100, "height": 200},
             "predicted": {"first": 12, "second": 2, "confidence": 0.9}},
            # matched, one half wrong (0/4 vs 0/5)
            {"bbox": {"x": 305, "y": 0, "width": 95, "height": 200},
             "predicted": {"first": 0, "second": 4, "confidence": 0.8}},
            # false positive
            {"bbox": {"x": 600, "y": 600, "width": 50, "height": 50},
             "predicted": {"first": 1, "second": 1, "confidence": 0.3}},
        ]},
        {"imageId": "b", "tiles": []},  # missed the 6/6
    ]
    r = score(truth, preds)
    d, v, h = r["detection"], r["value"], r["handTotal"]
    assert d["recall"]["value"] == 2 / 3, d
    assert d["precision"]["value"] == 2 / 3, d
    assert d["missedTiles"] == 1 and d["falsePositives"] == 1
    # halves: flipped 2/12 counts 2 ok (order-invariant); 0/4 vs 0/5 -> 1 ok
    assert v["perHalfAccuracy"]["value"] == 3 / 4, v
    assert v["exactTileIdentityAccuracy"]["value"] == 1 / 2, v
    assert v["orderAccuracy"]["value"] == 0.0, v  # the one applicable was flipped
    assert v["fullPhotoExactHandRate"]["value"] == 0.0, v
    # hand totals: a: gt 19, pred 16 (14+0+4... 12+2+0+4+1+1=20)  -> |19-20|=1
    # b: gt 12, pred 0 -> 12
    assert h["mae"] == (1 + 12) / 2, h
    assert h["exactRate"]["value"] == 0.0, h
    assert h["within3Rate"]["value"] == 1 / 2, h
    lo, hi = wilson_ci(95, 100)
    assert 0.88 < lo < 0.91 and 0.97 < hi < 0.99, (lo, hi)
    print("self-test OK")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--truth")
    ap.add_argument("--pred")
    ap.add_argument("--iou", type=float, default=0.5)
    ap.add_argument("--self-test", action="store_true")
    args = ap.parse_args()
    if args.self_test:
        _self_test()
        return
    if not args.truth or not args.pred:
        ap.error("--truth and --pred are required (or --self-test)")
    with open(args.truth) as f:
        truth = json.load(f)
    with open(args.pred) as f:
        preds = json.load(f)
    print(json.dumps(score(truth, preds, args.iou), indent=2))


if __name__ == "__main__":
    main()
