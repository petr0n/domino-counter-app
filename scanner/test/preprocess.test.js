// scanner/test/preprocess.test.js
import assert from 'node:assert';
import { computeLetterboxParams, unletterboxPoint } from '../preprocess.js';

// Fixture verified 2026-07-23 against Ultralytics' actual LetterBox.get_params
// for a 4000x2252 photo -> imgsz 640 (auto=False, the default .predict() uses):
// r = min(640/2252, 640/4000) = 0.16; new_unpad = (640, 360);
// dw,dh = (0, 280); centered -> padLeft=0, padTop=140.
{
  const p = computeLetterboxParams(4000, 2252, 640);
  assert.strictEqual(p.scale, 0.16, `scale: got ${p.scale}`);
  assert.strictEqual(p.newW, 640, `newW: got ${p.newW}`);
  assert.strictEqual(p.newH, 360, `newH: got ${p.newH}`);
  assert.strictEqual(p.padLeft, 0, `padLeft: got ${p.padLeft}`);
  assert.strictEqual(p.padTop, 140, `padTop: got ${p.padTop}`);
  console.log('computeLetterboxParams: PASS');
}

// A point at (320, 320) in letterboxed 640x640 space maps back to original
// space: x=(320-0)/0.16=2000, y=(320-140)/0.16=1125.
{
  const pt = unletterboxPoint(320, 320, { scale: 0.16, padLeft: 0, padTop: 140 });
  assert.strictEqual(pt.x, 2000, `x: got ${pt.x}`);
  assert.strictEqual(pt.y, 1125, `y: got ${pt.y}`);
  console.log('unletterboxPoint: PASS');
}
