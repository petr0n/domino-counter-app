#!/usr/bin/env python3
"""Stage-2 baseline: 13-way per-half pip-count CNN (build-plan-v2 §5.2).

Generate + train in one go (crops are cheap to make, not worth persisting):
  PYTHONPATH=train .venv/bin/python train/train_pips.py \
      --tiles 8000 [--backgrounds DIR] [--epochs 15] [--out runs/pips]
"""
import argparse
import random
from pathlib import Path

import cv2
import numpy as np
import torch
import torch.nn as nn

from domino_synth.crops import make_half_pair, _aug


def real_halves(rng, faces_dir, reps):
    """Tier-1 halves: labeled real face crops -> jittered half images."""
    import json
    from domino_synth.rectify import split_halves, RECT_W, RECT_H
    d = Path(faces_dir)
    labels = json.loads((d / "labels.json").read_text())
    xs, ys = [], []
    for name, val in labels.items():
        crop = cv2.resize(cv2.imread(str(d / name)), (RECT_W, RECT_H))
        first, second = map(int, val.split("/"))
        for _ in range(reps):
            # jitter the split point like the synthetic path does
            split = int(RECT_H * (0.5 + rng.uniform(-0.03, 0.03)))
            top, bot, _ = split_halves(crop, split)
            for img, c in ((top, first), (bot, second)):
                img = _aug(rng, img)
                f = rng.uniform(0.75, 1.25)
                img = np.clip(img.astype(np.float64) * f, 0, 255).astype(np.uint8)
                xs.append(cv2.cvtColor(img, cv2.COLOR_BGR2RGB))
                ys.append(c)
    return xs, ys


class PipNet(nn.Module):
    """~220k params; input 3x96x96, output 13 logits."""

    def __init__(self):
        super().__init__()
        layers, cin = [], 3
        for cout in (24, 48, 96, 192):
            layers += [nn.Conv2d(cin, cout, 3, padding=1, bias=False),
                       nn.BatchNorm2d(cout), nn.ReLU(inplace=True),
                       nn.MaxPool2d(2)]
            cin = cout
        self.features = nn.Sequential(*layers)
        self.head = nn.Linear(192, 13)

    def forward(self, x):
        f = self.features(x).mean(dim=(2, 3))
        return self.head(f)


def gen_split(rng, py_rng, n_tiles, bgs, label):
    xs, ys, tiers = [], [], {"sobel": 0, "midpoint": 0, "forced": 0}
    count_cycle = 0
    while len(ys) < n_tiles * 2:
        first = count_cycle % 13          # balanced labels
        second = py_rng.randint(0, 12)
        count_cycle += 1
        bg = bgs[int(rng.integers(len(bgs)))] if bgs else None
        s = make_half_pair(rng, py_rng, first, second, bg)
        if s is None:
            continue
        top, tc, bot, bc, tier = s
        tiers[tier] += 1
        for img, c in ((top, tc), (bot, bc)):
            xs.append(cv2.cvtColor(img, cv2.COLOR_BGR2RGB))
            ys.append(c)
    total = sum(tiers.values())
    print(f"{label}: {len(ys)} halves | bar tiers: "
          f"sobel {tiers['sobel']/total:.0%}, midpoint {tiers['midpoint']/total:.0%}, "
          f"forced-jitter {tiers['forced']/total:.0%}")
    x = torch.from_numpy(np.stack(xs)).permute(0, 3, 1, 2).contiguous()  # uint8
    return x, torch.tensor(ys)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--tiles", type=int, default=8000)
    ap.add_argument("--val-tiles", type=int, default=800)
    ap.add_argument("--backgrounds", default=None)
    ap.add_argument("--faces", default=None,
                    help="labeled face-crop dir (Tier 1) mixed into training")
    ap.add_argument("--face-reps", type=int, default=20)
    ap.add_argument("--epochs", type=int, default=15)
    ap.add_argument("--batch", type=int, default=256)
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--out", default="runs/pips")
    args = ap.parse_args()

    rng = np.random.default_rng(args.seed)
    py_rng = random.Random(args.seed)
    bgs = []
    if args.backgrounds:
        bgs = [cv2.imread(str(p)) for p in sorted(Path(args.backgrounds).iterdir())
               if p.suffix.lower() in (".jpg", ".jpeg", ".png", ".webp")]
        print(f"{len(bgs)} real backgrounds")
    else:
        print("WARNING: procedural backgrounds (smoke-test only)")

    xtr, ytr = gen_split(rng, py_rng, args.tiles, bgs, "train")
    xva, yva = gen_split(rng, py_rng, args.val_tiles, bgs, "val")
    if args.faces:
        rx, ry = real_halves(rng, args.faces, args.face_reps)
        print(f"Tier-1 real halves: {len(rx)} ({len(rx)//(2*args.face_reps)} crops "
              f"x{args.face_reps} reps)")
        xtr = torch.cat([xtr, torch.from_numpy(np.stack(rx)).permute(0, 3, 1, 2)])
        ytr = torch.cat([ytr, torch.tensor(ry)])
    if args.faces:
        rx, ry = real_halves(rng, args.faces, args.face_reps)
        print(f"Tier-1 real halves: {len(ry)}")
        xtr = torch.cat([xtr, torch.from_numpy(np.stack(rx)).permute(0, 3, 1, 2)])
        ytr = torch.cat([ytr, torch.tensor(ry)])

    dev = ("mps" if torch.backends.mps.is_available()
           else "cuda" if torch.cuda.is_available() else "cpu")
    model = PipNet().to(dev)
    opt = torch.optim.Adam(model.parameters(), lr=1e-3)
    sched = torch.optim.lr_scheduler.CosineAnnealingLR(opt, args.epochs)
    loss_fn = nn.CrossEntropyLoss()
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    best = 0.0
    for ep in range(1, args.epochs + 1):
        model.train()
        perm = torch.randperm(len(ytr))
        tot = 0.0
        for i in range(0, len(perm), args.batch):
            idx = perm[i:i + args.batch]
            x = xtr[idx].to(dev).float().div(255)
            y = ytr[idx].to(dev)
            opt.zero_grad()
            loss = loss_fn(model(x), y)
            loss.backward()
            opt.step()
            tot += loss.item() * len(idx)
        sched.step()
        model.eval()
        correct = 0
        with torch.no_grad():
            for i in range(0, len(yva), args.batch):
                x = xva[i:i + args.batch].to(dev).float().div(255)
                correct += (model(x).argmax(1).cpu() == yva[i:i + args.batch]).sum().item()
        acc = correct / len(yva)
        print(f"epoch {ep}/{args.epochs} loss {tot/len(ytr):.4f} val-half-acc {acc:.4f}")
        if acc >= best:
            best = acc
            torch.save({"state_dict": model.state_dict(), "half_size": 96},
                       out / "best.pt")
    print(f"best synthetic val per-half accuracy: {best:.4f} -> {out/'best.pt'}")


if __name__ == "__main__":
    main()
