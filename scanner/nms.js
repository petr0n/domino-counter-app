// scanner/nms.js
// Standard greedy NMS + the post-NMS duplicate-detection cleanup, ported
// directly from train/predict.py's dedup_confident_duplicates (same file's
// module comment explains the 0.65 threshold choice: confirmed genuine
// touching-tile pairs sit at axis-aligned IoU ~0.05-0.09, confirmed
// same-tile duplicate pairs measured 0.65-0.73 on real eval photos).

export function boxIou(a, b) {
  const [ax0, ay0, ax1, ay1] = a;
  const [bx0, by0, bx1, by1] = b;
  const ix0 = Math.max(ax0, bx0), iy0 = Math.max(ay0, by0);
  const ix1 = Math.min(ax1, bx1), iy1 = Math.min(ay1, by1);
  const inter = Math.max(0, ix1 - ix0) * Math.max(0, iy1 - iy0);
  const union = (ax1 - ax0) * (ay1 - ay0) + (bx1 - bx0) * (by1 - by0) - inter;
  return union > 0 ? inter / union : 0;
}

function greedyKeep(detections, threshold) {
  const order = detections.map((_, i) => i).sort((a, b) => detections[b].score - detections[a].score);
  const keptIdx = [];
  for (const i of order) {
    if (keptIdx.some(j => boxIou(detections[i].box, detections[j].box) > threshold)) continue;
    keptIdx.push(i);
  }
  return keptIdx;
}

// Single-class greedy NMS -- both scanner models emit exactly one class
// each, so no per-class grouping is needed. Matches the semantics of
// ultralytics' `iou` threshold (tile detector 0.75, pip detector 0.7 --
// see train/predict.py; those exact values are wired in Task 7, not here).
export function nms(detections, iouThreshold) {
  return greedyKeep(detections, iouThreshold).map(i => detections[i]);
}

export const DUPLICATE_IOU_THRESHOLD = 0.65;

export function dedupConfidentDuplicates(detections, threshold = DUPLICATE_IOU_THRESHOLD) {
  const keptIdx = greedyKeep(detections, threshold).sort((a, b) => a - b);
  return keptIdx.map(i => detections[i]);
}
