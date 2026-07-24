// scanner/test/geometry.test.js
import assert from 'node:assert';
import { computeRectifyTransform, applyHomography, barSplit, RECT_W, RECT_H } from '../geometry.js';

// Fixture verified 2026-07-23 directly against cv2.getPerspectiveTransform
// for a simple axis-aligned 100x200 source rectangle (corners in any order,
// as the tile detector would emit them) mapped to the padded RECT_W x
// RECT_H canvas: output center (64,128) samples from source (50,100)
// (the source rectangle's own center); the two padding corners map exactly
// to the source's opposite corners.
{
  const corners = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 200 }, { x: 0, y: 200 }];
  const { H, layout } = computeRectifyTransform(corners);
  assert.strictEqual(layout, 'vertical', `layout: ${layout}`);

  const center = applyHomography(H, RECT_W / 2, RECT_H / 2);
  assert.ok(Math.abs(center.x - 50) < 0.01, `center.x: ${center.x}`);
  assert.ok(Math.abs(center.y - 100) < 0.01, `center.y: ${center.y}`);

  const p = 0.06 * RECT_W; // PAD_FRAC * RECT_W
  const topLeftPad = applyHomography(H, p, p);
  assert.ok(Math.abs(topLeftPad.x - 0) < 0.01, `topLeftPad.x: ${topLeftPad.x}`);
  assert.ok(Math.abs(topLeftPad.y - 0) < 0.01, `topLeftPad.y: ${topLeftPad.y}`);

  const botRightPad = applyHomography(H, RECT_W - p, RECT_H - p);
  assert.ok(Math.abs(botRightPad.x - 100) < 0.01, `botRightPad.x: ${botRightPad.x}`);
  assert.ok(Math.abs(botRightPad.y - 200) < 0.01, `botRightPad.y: ${botRightPad.y}`);
  console.log('computeRectifyTransform + applyHomography: PASS');
}

// barSplit: a clean synthetic RECT_W x RECT_H grayscale image, white
// everywhere except a solid black horizontal bar at rows 128-131. A
// perfectly symmetric solid bar produces two EQUAL-magnitude Sobel-Y edge
// responses (top and bottom edge of the bar); this is a real, verified
// property of the shipped algorithm's tie-breaking (first max wins), not a
// JS-port bug -- confirmed 2026-07-23 by running this exact fixture through
// the real train/domino_synth/rectify.py bar_split() (actual cv2.Sobel),
// which also returns row 127, not the bar's geometric center (129.5). Real
// photos essentially never hit an exact tie (lighting/JPEG/anti-aliasing
// break the symmetry), so this only matters for this idealized fixture.
{
  const rows = [];
  for (let y = 0; y < RECT_H; y++) {
    const isBar = y >= 128 && y < 132;
    rows.push(new Array(RECT_W).fill(isBar ? 0 : 255));
  }
  const { splitRow, tier } = barSplit(rows);
  assert.strictEqual(tier, 'sobel', `tier: ${tier}`);
  assert.strictEqual(splitRow, 127, `splitRow: ${splitRow}`);
  console.log('barSplit: PASS');
}
