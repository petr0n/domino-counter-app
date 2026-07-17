# train/ — synthetic data + training (build-plan-v2 §4, §5.5)

## Setup (local)

```sh
python3 -m venv .venv
.venv/bin/pip install -r train/requirements.txt
```

## Generate a synthetic YOLO-Pose dataset (Tier 2, rendered)

```sh
PYTHONPATH=train .venv/bin/python train/generate.py \
  --num 2000 --out train/data/synth --backgrounds <real-background-dir> \
  --preview 10
```

- Without `--backgrounds` it falls back to procedural textures — fine for
  smoke-testing the pipeline, **not** for the M0 training run (§4.1 requires a
  curated pool of real surface photos).
- `--preview N` writes label-overlay images to `previews/` — eyeball them
  after any generator change.
- Labels are YOLO-Pose: 1 class (`domino_tile`), bbox + 4 corner keypoints in
  the deterministic §5.4 winding (polar-angle sort from box centre).

## Training notes (M0)

- Train the smallest Ultralytics YOLO-Pose variant on Kaggle/Colab free GPU
  (§5.5). **Set `fliplr=0` and `flipud=0`** — the corner winding is chiral and
  no `flip_idx` permutation can fix a mirrored label (see dataset.yaml).
- Tier 1 (copy-paste of real tile-face crops — the primary tier) is not built
  yet: it needs the user's capture session of all 91 faces (§4.3).

## Scoring

Model predictions vs the merged eval truth (once annotation is done):

```sh
.venv/bin/python eval/score.py --truth eval/corpus_merged.json --pred preds.json
```
