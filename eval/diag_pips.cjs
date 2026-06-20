// Diagnostic: across ALL grid_truth halves, report accepted PIPs and any
// "big" (circ 0.15-0.45) blob with its area ratio to mean pip area. Lets us see
// the blast radius of a "count ~1x big blob as one pip" rule before changing code.
//   node diag_pips.cjs
const fs = require("fs");
const path = require("path");
const jpeg = require("jpeg-js");
const cv = require("@techstark/opencv-js");

const TRUTH = JSON.parse(fs.readFileSync(path.join(__dirname, "grid_truth.json"), "utf8"));

function half(mat, side) {
  const landscape = mat.cols >= mat.rows;
  const mid = landscape ? Math.floor(mat.cols / 2) : Math.floor(mat.rows / 2);
  if (landscape) {
    return side === "left" ? mat.roi(new cv.Rect(0, 0, mid, mat.rows))
                           : mat.roi(new cv.Rect(mid, 0, mat.cols - mid, mat.rows));
  }
  return side === "left" ? mat.roi(new cv.Rect(0, 0, mat.cols, mid))
                         : mat.roi(new cv.Rect(0, mid, mat.cols, mat.rows - mid));
}

function analyze(h) {
  const pad = Math.max(2, Math.floor(Math.min(h.rows, h.cols) * 0.05));
  const rw = h.cols - 2 * pad, rh = h.rows - 2 * pad;
  const inner = h.roi(new cv.Rect(pad, pad, rw, rh));
  const gray = new cv.Mat();
  cv.cvtColor(inner, gray, cv.COLOR_RGBA2GRAY);
  const thresh = new cv.Mat();
  const pipR = Math.max(6, Math.round(Math.sqrt(rw * rh * 0.025 / Math.PI)));
  const blockSz = pipR * 3 | 1;
  cv.adaptiveThreshold(gray, thresh, 255, cv.ADAPTIVE_THRESH_GAUSSIAN_C, cv.THRESH_BINARY_INV, blockSz, 8);
  const conts = new cv.MatVector();
  const hierP = new cv.Mat();
  cv.findContours(thresh, conts, hierP, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
  const regionArea = rw * rh, minPip = regionArea * 0.002, maxPip = regionArea * 0.10;
  const pipAreas = [], bigs = [];
  for (let i = 0; i < conts.size(); i++) {
    const c = conts.get(i);
    const area = cv.contourArea(c);
    const peri = cv.arcLength(c, true);
    c.delete();
    const circ = peri > 0 ? (4 * Math.PI * area) / (peri * peri) : 0;
    if (area >= minPip && area <= maxPip && circ >= 0.45) pipAreas.push(area);
    else if (area >= minPip && area <= maxPip * 8 && circ >= 0.15 && circ < 0.45) bigs.push(area);
  }
  const pipArea = pipAreas.length ? pipAreas.reduce((a, b) => a + b, 0) / pipAreas.length : maxPip * 0.25;
  inner.delete(); gray.delete(); thresh.delete(); conts.delete(); hierP.delete();
  return { pips: pipAreas.length, bigRatios: bigs.map(b => +(b / pipArea).toFixed(2)) };
}

cv.onRuntimeInitialized = () => {
  for (const [name, exp] of Object.entries(TRUTH)) {
    if (name.startsWith("_")) continue;
    const raw = jpeg.decode(fs.readFileSync(path.join(__dirname, `${name}.jpg`)), { useTArray: true });
    const src = cv.matFromImageData({ data: new Uint8ClampedArray(raw.data), width: raw.width, height: raw.height });
    for (const side of ["left", "right"]) {
      const truth = side === "left" ? exp[0] : exp[1];
      const h = half(src, side);
      const { pips, bigRatios } = analyze(h);
      h.delete();
      // Flag halves where a ~1x big blob exists (the recovery candidate).
      const unit = bigRatios.filter(r => r >= 0.55 && r <= 1.6);
      const flag = (pips < truth && unit.length) ? "  <-- would FIX" :
                   (pips >= truth && unit.length) ? "  <-- RISK (already enough pips)" : "";
      console.log(`${name.padEnd(16)} ${side.padEnd(5)} truth=${String(truth).padStart(2)} pips=${String(pips).padStart(2)} big=[${bigRatios.join(", ")}]${flag}`);
    }
    src.delete();
  }
  process.exit(0);
};
setTimeout(() => { console.log("TIMEOUT"); process.exit(1); }, 120000);
