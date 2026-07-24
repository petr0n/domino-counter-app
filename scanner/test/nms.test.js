// scanner/test/nms.test.js
import assert from 'node:assert';
import { boxIou, nms, dedupConfidentDuplicates } from '../nms.js';

// Fixture verified 2026-07-23 directly against train/predict.py's
// dedup_confident_duplicates on the same 3 boxes: A and B are genuinely
// touching (IoU 0.0 for this axis-aligned pair), C is a near-duplicate of
// A (IoU 0.9702, above the 0.65 threshold) with lower confidence -> dropped.
const boxes = [
  { box: [100, 100, 200, 300], score: 0.9, keypoints: [] },  // A
  { box: [205, 100, 305, 300], score: 0.85, keypoints: [] }, // B
  { box: [100, 100, 198, 298], score: 0.7, keypoints: [] },  // C
];

{
  const iouAB = boxIou(boxes[0].box, boxes[1].box);
  const iouAC = boxIou(boxes[0].box, boxes[2].box);
  assert.strictEqual(iouAB, 0, `iouAB: ${iouAB}`);
  assert.ok(Math.abs(iouAC - 0.9702) < 0.001, `iouAC: ${iouAC}`);
  console.log('boxIou: PASS');
}

{
  const kept = dedupConfidentDuplicates(boxes, 0.65);
  assert.strictEqual(kept.length, 2, `expected 2 kept, got ${kept.length}`);
  assert.deepStrictEqual(kept[0].box, [100, 100, 200, 300]);
  assert.deepStrictEqual(kept[1].box, [205, 100, 305, 300]);
  console.log('dedupConfidentDuplicates: PASS');
}

// Standard NMS at a much lower threshold should also collapse A+C (they
// overlap far more than a typical 0.5 NMS threshold too), independent of
// the dedup pass.
{
  const kept = nms(boxes, 0.5);
  assert.strictEqual(kept.length, 2, `expected 2 kept, got ${kept.length}`);
  console.log('nms: PASS');
}
