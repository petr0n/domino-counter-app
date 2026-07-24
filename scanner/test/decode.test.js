// scanner/test/decode.test.js
import assert from 'node:assert';
import { decodeDetections } from '../decode.js';

// Plain-detection fixture (pip detector shape): channels=5, numAnchors=3.
// Hand-computed: anchor0 score=0.9 (kept), anchor1 score=0.3 (dropped,
// below 0.5 threshold), anchor2 score=0.6 (kept).
{
  const data = new Float32Array([
    10, 50, 100,   // cx
    10, 50, 100,   // cy
    4, 4, 4,       // w
    4, 4, 4,       // h
    0.9, 0.3, 0.6, // score
  ]);
  const dets = decodeDetections(data, 5, 3, 0.5);
  assert.strictEqual(dets.length, 2, `expected 2 detections, got ${dets.length}`);
  assert.deepStrictEqual(dets[0].box, [8, 8, 12, 12], `box0: ${dets[0].box}`);
  // Math.fround(): score is read straight out of a Float32Array, so its
  // exact double-precision value is the nearest float32 to 0.9, not the
  // literal double 0.9 -- comparing against the literal would fail
  // regardless of decode.js's logic (plan's fixture didn't account for
  // JS's Float32Array -> double promotion; verified 2026-07-23).
  assert.strictEqual(dets[0].score, Math.fround(0.9));
  assert.deepStrictEqual(dets[1].box, [98, 98, 102, 102], `box1: ${dets[1].box}`);
  assert.strictEqual(dets[1].score, Math.fround(0.6));
  console.log('decodeDetections (plain): PASS');
}

// Pose fixture (tile detector shape, 1 keypoint for brevity): channels=8
// (4 box + 1 class + 3 kpt), numAnchors=2. Both anchors above threshold.
{
  const data = new Float32Array([
    20, 60,    // cx
    20, 60,    // cy
    4, 4,      // w
    4, 4,      // h
    0.9, 0.9,  // score
    21, 61,    // kp1 x
    19, 59,    // kp1 y
    0.95, 0.5, // kp1 visibility
  ]);
  const dets = decodeDetections(data, 8, 2, 0.5, 1);
  assert.strictEqual(dets.length, 2);
  assert.deepStrictEqual(dets[0].box, [18, 18, 22, 22]);
  // Same Float32Array -> double precision note as above for visibility 0.95.
  assert.deepStrictEqual(dets[0].keypoints, [{ x: 21, y: 19, visibility: Math.fround(0.95) }]);
  assert.deepStrictEqual(dets[1].box, [58, 58, 62, 62]);
  assert.deepStrictEqual(dets[1].keypoints, [{ x: 61, y: 59, visibility: 0.5 }]);
  console.log('decodeDetections (pose): PASS');
}
