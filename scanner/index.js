// scanner/index.js
// Public scanner API (CLAUDE.md architecture note): init() loads/caches the
// ONNX models, scanImage() runs the full two-stage pipeline. No DOM, no
// storage -- both are the caller's responsibility.
import { unletterboxPoint, letterboxImage } from './preprocess.js';
import { decodeDetections } from './decode.js';
import { nms, dedupConfidentDuplicates } from './nms.js';
import { computeRectifyTransform, warpPerspective, barSplit, RECT_W, RECT_H } from './geometry.js';

// Exact production thresholds -- verified 2026-07-23 against train/predict.py.
const TILE_IMGSZ = 640, TILE_CONF = 0.50, TILE_NMS_IOU = 0.75;
const PIP_IMGSZ = 384, PIP_CONF = 0.85, PIP_NMS_IOU = 0.7;

let tileSession = null, pipSession = null;

export async function init({ tileModelUrl, pipModelUrl }) {
  // Explicitly force the WASM+SIMD, single-threaded path §8 requires (the
  // deliberate baseline: multithreaded WASM needs SharedArrayBuffer, which
  // needs COOP/COEP response headers GitHub Pages can't set). Without this,
  // ort.env.wasm.numThreads defaults to 0 (auto-detect), which tries to
  // multithread via SharedArrayBuffer and silently falls back when it's
  // unavailable -- a real measured 2026-07-23 perf finding (~110ms/inference
  // on a Galaxy S25+, ~2.5x the plan's ~40ms anchor) traced to this default
  // never having been overridden, not to the surrounding JS (which measured
  // at 15-25ms/step, not the bottleneck).
  ort.env.wasm.numThreads = 1;
  ort.env.wasm.simd = true;
  const opts = { executionProviders: ['wasm'] };
  tileSession = await ort.InferenceSession.create(tileModelUrl, opts);
  pipSession = await ort.InferenceSession.create(pipModelUrl, opts);
}

function imageDataToTensor(imageData) {
  const { data, width, height } = imageData;
  const chw = new Float32Array(3 * width * height);
  for (let i = 0; i < width * height; i++) {
    chw[i] = data[i * 4] / 255;                         // R
    chw[width * height + i] = data[i * 4 + 1] / 255;     // G
    chw[2 * width * height + i] = data[i * 4 + 2] / 255; // B
  }
  return new ort.Tensor('float32', chw, [1, 3, height, width]);
}

function unletterboxBox([x0, y0, x1, y1], params) {
  const p0 = unletterboxPoint(x0, y0, params);
  const p1 = unletterboxPoint(x1, y1, params);
  return { x: p0.x, y: p0.y, width: p1.x - p0.x, height: p1.y - p0.y };
}

async function detectTiles(imageData, canvasFactory) {
  const { imageData: letterboxed, params } = letterboxImage(imageData, TILE_IMGSZ, canvasFactory);
  const tensor = imageDataToTensor(letterboxed);
  const outputs = await tileSession.run({ images: tensor });
  const data = outputs.output0.data;
  const numAnchors = outputs.output0.dims[2];
  let dets = decodeDetections(data, 17, numAnchors, TILE_CONF, 4);
  dets = nms(dets, TILE_NMS_IOU);
  dets = dedupConfidentDuplicates(dets);
  // map box + keypoints from letterboxed space back to original image space
  return dets.map(d => ({
    bbox: unletterboxBox(d.box, params),
    corners: d.keypoints.map(k => unletterboxPoint(k.x, k.y, params)),
    confidence: d.score,
  }));
}

async function countPips(tileImageData, corners, canvasFactory) {
  const { H, layout } = computeRectifyTransform(corners);
  const rectified = warpPerspective(tileImageData, H);

  const grayRows = [];
  for (let y = 0; y < RECT_H; y++) {
    const row = new Array(RECT_W);
    for (let x = 0; x < RECT_W; x++) {
      const i = (y * RECT_W + x) * 4;
      row[x] = 0.299 * rectified.data[i] + 0.587 * rectified.data[i + 1] + 0.114 * rectified.data[i + 2];
    }
    grayRows.push(row);
  }
  const { splitRow } = barSplit(grayRows);

  const { imageData: letterboxed, params } = letterboxImage(rectified, PIP_IMGSZ, canvasFactory);
  const tensor = imageDataToTensor(letterboxed);
  const outputs = await pipSession.run({ images: tensor });
  const data = outputs.output0.data;
  const numAnchors = outputs.output0.dims[2];
  let dets = decodeDetections(data, 5, numAnchors, PIP_CONF, 0);
  dets = nms(dets, PIP_NMS_IOU);

  let first = 0, second = 0, firstConfSum = 0, secondConfSum = 0;
  for (const d of dets) {
    const cy = (d.box[1] + d.box[3]) / 2;
    const backY = unletterboxPoint(0, cy, params).y; // back into rectified-crop space
    if (backY < splitRow) { first++; firstConfSum += d.score; }
    else { second++; secondConfSum += d.score; }
  }
  const firstConfidence = first ? firstConfSum / first : 0.9;
  const secondConfidence = second ? secondConfSum / second : 0.9;
  return {
    first: Math.min(first, 12), second: Math.min(second, 12),
    firstConfidence, secondConfidence,
    confidence: Math.min(firstConfidence, secondConfidence),
    layout,
  };
}

// imageData: {data: Uint8ClampedArray (RGBA), width, height} for the full
// source photo. canvasFactory: (w,h) => {canvas, ctx}, injected (Task 9
// supplies an OffscreenCanvas-backed one).
export async function scanImage(imageData, canvasFactory) {
  const tiles = await detectTiles(imageData, canvasFactory);
  const results = [];
  for (const tile of tiles) {
    let predicted = { first: 0, second: 0, confidence: tile.confidence };
    if (tile.corners.length === 4) {
      const pip = await countPips(imageData, tile.corners, canvasFactory);
      predicted = {
        first: pip.first, second: pip.second,
        firstConfidence: pip.firstConfidence, secondConfidence: pip.secondConfidence,
        confidence: tile.confidence * pip.confidence,
      };
    }
    results.push({ bbox: tile.bbox, corners: tile.corners, predicted });
  }
  return results;
}
