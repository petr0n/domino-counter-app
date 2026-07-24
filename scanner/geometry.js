// scanner/geometry.js
// Ported from train/domino_synth/rectify.py -- that file's own docstring
// calls for this port ("Ported to JS for on-device use at M2 -- keep it
// dependency-light"). RECT_W/RECT_H/PAD_FRAC match the Python constants
// exactly; changing either side without the other breaks Stage-2 pip
// counting (the model was trained on this exact aspect ratio/padding).
export const RECT_W = 128, RECT_H = 256;
const PAD_FRAC = 0.06;

function cross2d(o, a) { return o.x * a.y - o.y * a.x; }

function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }

// Gaussian elimination with partial pivoting -- used to solve the 8x8
// linear system behind a 3x3 perspective transform (same underlying math
// as cv2.getPerspectiveTransform).
function solveLinearSystem(A, b) {
  const n = A.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(M[r][col]) > Math.abs(M[pivot][col])) pivot = r;
    }
    [M[col], M[pivot]] = [M[pivot], M[col]];
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const factor = M[r][col] / M[col][col];
      for (let c = col; c <= n; c++) M[r][c] -= factor * M[col][c];
    }
  }
  return M.map((row, i) => row[n] / row[i]);
}

function getPerspectiveTransform(src, dst) {
  const A = [], b = [];
  for (let i = 0; i < 4; i++) {
    const { x: sx, y: sy } = src[i];
    const { x: dx, y: dy } = dst[i];
    A.push([sx, sy, 1, 0, 0, 0, -sx * dx, -sy * dx]); b.push(dx);
    A.push([0, 0, 0, sx, sy, 1, -sx * dy, -sy * dy]); b.push(dy);
  }
  const h = solveLinearSystem(A, b);
  return [...h, 1]; // h33 fixed at 1
}

export function applyHomography(H, x, y) {
  const [a, b, c, d, e, f, g, h] = H;
  const w = g * x + h * y + 1;
  return { x: (a * x + b * y + c) / w, y: (d * x + e * y + f) / w };
}

// corners: 4 {x,y} in source-image pixel coords, in the tile detector's
// §5.4 winding order (any starting point works -- this re-derives its own
// canonical winding internally, exactly like rectify.py does). Returns
// {H, layout} where H maps OUTPUT (RECT_W x RECT_H) pixel coords back into
// SOURCE image coords (verified 2026-07-23: this is the same direction
// cv2.warpPerspective samples in internally, i.e.
// inv(cv2.getPerspectiveTransform(src, dst)) == cv2.getPerspectiveTransform(dst, src),
// so computing it directly in this direction needs no separate inversion step).
export function computeRectifyTransform(corners) {
  const cx = corners.reduce((s, p) => s + p.x, 0) / 4;
  const cy = corners.reduce((s, p) => s + p.y, 0) / 4;
  const withAngle = corners.map(p => ({
    x: p.x, y: p.y,
    angle: (Math.atan2(p.y - cy, p.x - cx) + 2 * Math.PI) % (2 * Math.PI),
  }));
  const q = [...withAngle].sort((a, b) => a.angle - b.angle); // wound quad

  const e01 = dist(q[0], q[1]), e12 = dist(q[1], q[2]);
  let ends = e01 >= e12 ? [[q[1], q[2]], [q[3], q[0]]] : [[q[0], q[1]], [q[2], q[3]]];

  let m0 = { x: (ends[0][0].x + ends[0][1].x) / 2, y: (ends[0][0].y + ends[0][1].y) / 2 };
  let m1 = { x: (ends[1][0].x + ends[1][1].x) / 2, y: (ends[1][0].y + ends[1][1].y) / 2 };
  let axis = { x: m1.x - m0.x, y: m1.y - m0.y };
  const layout = Math.abs(axis.y) >= Math.abs(axis.x) ? 'vertical' : 'horizontal';
  const key = layout === 'vertical' ? 'y' : 'x';
  if (m0[key] > m1[key]) { ends = [ends[1], ends[0]]; }

  m0 = { x: (ends[0][0].x + ends[0][1].x) / 2, y: (ends[0][0].y + ends[0][1].y) / 2 };
  m1 = { x: (ends[1][0].x + ends[1][1].x) / 2, y: (ends[1][0].y + ends[1][1].y) / 2 };
  axis = { x: m1.x - m0.x, y: m1.y - m0.y };
  const [tl, tr] = cross2d(axis, { x: ends[0][0].x - m0.x, y: ends[0][0].y - m0.y }) > 0
    ? [ends[0][0], ends[0][1]] : [ends[0][1], ends[0][0]];
  const [bl, br] = cross2d(axis, { x: ends[1][0].x - m1.x, y: ends[1][0].y - m1.y }) > 0
    ? [ends[1][0], ends[1][1]] : [ends[1][1], ends[1][0]];

  const p = PAD_FRAC * RECT_W;
  const src = [tl, tr, br, bl];
  const dst = [{ x: p, y: p }, { x: RECT_W - p, y: p },
               { x: RECT_W - p, y: RECT_H - p }, { x: p, y: RECT_H - p }];
  const H = getPerspectiveTransform(dst, src);
  return { H, layout };
}

function sample(src, x, y, ch) {
  x = Math.max(0, Math.min(src.width - 1, x));
  y = Math.max(0, Math.min(src.height - 1, y));
  return src.data[(y * src.width + x) * 4 + ch];
}

function bilinear(src, x0, y0, fx, fy, ch) {
  const v00 = sample(src, x0, y0, ch), v10 = sample(src, x0 + 1, y0, ch);
  const v01 = sample(src, x0, y0 + 1, ch), v11 = sample(src, x0 + 1, y0 + 1, ch);
  return v00 * (1 - fx) * (1 - fy) + v10 * fx * (1 - fy) + v01 * (1 - fx) * fy + v11 * fx * fy;
}

// src: {data: Uint8ClampedArray (RGBA), width, height}. Returns a real
// browser ImageData (RECT_W x RECT_H RGBA) -- NOT a plain {data,width,height}
// lookalike. Downstream (letterboxImage -> ctx.putImageData) requires an
// actual ImageData instance; a duck-typed object throws
// "parameter 1 is not of type 'ImageData'" (found via manual browser
// testing 2026-07-23 -- this function has no Node unit test since it needs
// real pixel data, so this only surfaces when actually run in a browser).
export function warpPerspective(src, H) {
  const out = new Uint8ClampedArray(RECT_W * RECT_H * 4);
  for (let oy = 0; oy < RECT_H; oy++) {
    for (let ox = 0; ox < RECT_W; ox++) {
      const { x: sx, y: sy } = applyHomography(H, ox, oy);
      const x0 = Math.floor(sx), y0 = Math.floor(sy);
      const fx = sx - x0, fy = sy - y0;
      const oi = (oy * RECT_W + ox) * 4;
      for (let ch = 0; ch < 4; ch++) out[oi + ch] = bilinear(src, x0, y0, fx, fy, ch);
    }
  }
  return new ImageData(out, RECT_W, RECT_H);
}

// Direct port of bar_split(): Sobel-Y edge-magnitude profile, strongest
// peak within the middle 38%-62% band, geometric-midpoint fallback if no
// peak clearly beats the crop's typical edge response.
// grayRows: array of RECT_H rows, each an array/typed-array of RECT_W values.
export function barSplit(grayRows) {
  const h = grayRows.length, w = grayRows[0].length;
  const profile = new Array(h).fill(0);
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - 1), y1 = Math.min(h - 1, y + 1);
    let sum = 0;
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - 1), x1 = Math.min(w - 1, x + 1);
      const g = -grayRows[y0][x0] - 2 * grayRows[y0][x] - grayRows[y0][x1]
              + grayRows[y1][x0] + 2 * grayRows[y1][x] + grayRows[y1][x1];
      sum += Math.abs(g);
    }
    profile[y] = sum / w;
  }
  const lo = Math.floor(h * 0.38), hi = Math.floor(h * 0.62);
  let peak = lo, peakVal = -Infinity;
  for (let y = lo; y < hi; y++) if (profile[y] > peakVal) { peakVal = profile[y]; peak = y; }
  const sorted = [...profile].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  if (peakVal > 2.5 * (median + 1e-6)) return { splitRow: peak, tier: 'sobel' };
  return { splitRow: Math.floor(h / 2), tier: 'midpoint' };
}
