// scanner/decode.js
// Decode a raw YOLO11 ONNX output tensor. Box coords, class score, and (for
// pose models) keypoint x/y/visibility are ALL already fully decoded by the
// exported graph -- verified empirically 2026-07-23 against the real
// pipdet_hn and touch int8 exports via onnxruntime: raw output columns are
// plain pixel-space values (box coords in [0, imgsz] range, scores/visibility
// in [0,1]), not distributional logits needing DFL/anchor decode. This
// function only transposes, thresholds, and converts cx/cy/w/h -> corners.
// NMS is NOT applied here -- see scanner/nms.js.

// data: Float32Array, length = channels * numAnchors, row-major
// [channel][anchor] (the ONNX output shape (1, channels, numAnchors) with
// the batch dim stripped, as returned directly by onnxruntime-web).
export function decodeDetections(data, channels, numAnchors, confThreshold, numKeypoints = 0) {
  const results = [];
  for (let a = 0; a < numAnchors; a++) {
    const score = data[4 * numAnchors + a]; // channel 4 = class score
    if (score < confThreshold) continue;
    const cx = data[0 * numAnchors + a];
    const cy = data[1 * numAnchors + a];
    const w = data[2 * numAnchors + a];
    const h = data[3 * numAnchors + a];
    const box = [cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2];
    const keypoints = [];
    for (let k = 0; k < numKeypoints; k++) {
      const base = (5 + k * 3) * numAnchors;
      keypoints.push({
        x: data[base + a],
        y: data[base + numAnchors + a],
        visibility: data[base + 2 * numAnchors + a],
      });
    }
    results.push({ box, score, keypoints });
  }
  return results;
}
