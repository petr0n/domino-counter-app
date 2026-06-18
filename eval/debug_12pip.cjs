// Debug 12-pip counting: print every contour's area+circ for the 12-pip half
const fs = require("fs");
const path = require("path");
const jpeg = require("jpeg-js");
const cv = require("@techstark/opencv-js");

const DIR = __dirname;

cv.onRuntimeInitialized = () => {
  global.cv = cv;
  global.window = {};
  global.document = { createElement: () => ({ getContext: () => ({}), toDataURL: () => "" }) };
  new Function(fs.readFileSync(path.join(DIR, "..", "detect.js"), "utf8"))();
  const D = global.window.DominoCV;

  // Process photo 469 tile0 — both halves should be [12,9]
  for (const [fname, label] of [["469.jpg","469 tile0"], ["467.jpg","467 tile0"]]) {
    const raw = jpeg.decode(fs.readFileSync(path.join(DIR, "photos", fname)), { useTArray: true });
    D._test.stretchGray(raw.data);
    const src = cv.matFromImageData({ data: new Uint8ClampedArray(raw.data), width: raw.width, height: raw.height });
    const tiles = D._test.findTiles(src, 0.02, 0.70, 0.03);
    if (!tiles.length) { console.log(label, "NO TILES FOUND"); src.delete(); continue; }

    // Get the first tile and its warped crop
    const t = tiles[0];
    const pts = t.pts;
    const cx = (pts[0].x+pts[1].x+pts[2].x+pts[3].x)/4;
    const cy = (pts[0].y+pts[1].y+pts[2].y+pts[3].y)/4;
    const d01 = Math.hypot(pts[1].x-pts[0].x, pts[1].y-pts[0].y);
    const d03 = Math.hypot(pts[3].x-pts[0].x, pts[3].y-pts[0].y);
    let angle = d01>=d03
      ? Math.atan2(pts[1].y-pts[0].y, pts[1].x-pts[0].x)*180/Math.PI
      : Math.atan2(pts[3].y-pts[0].y, pts[3].x-pts[0].x)*180/Math.PI;
    const tileW = Math.max(d01,d03), tileH = Math.min(d01,d03);
    while (angle > 90) angle -= 180;
    while (angle <= -90) angle += 180;
    const pad = 0.08;
    const outW = Math.round(tileW*(1+2*pad)), outH = Math.round(tileH*(1+2*pad));
    let M = null, rotated = null, cropped = null;
    M = cv.getRotationMatrix2D(new cv.Point(cx,cy), angle, 1.0);
    rotated = new cv.Mat();
    cv.warpAffine(src, rotated, M, new cv.Size(src.cols, src.rows), cv.INTER_LINEAR, cv.BORDER_REPLICATE);
    const x = Math.max(0, Math.round(cx-outW/2));
    const y = Math.max(0, Math.round(cy-outH/2));
    const w = Math.min(src.cols-x, outW), h = Math.min(src.rows-y, outH);
    cropped = rotated.roi(new cv.Rect(x,y,w,h));

    // Analyze just the LEFT half (should be 12 pips for 469, or 5 pips left for 467)
    const mid = Math.floor(cropped.cols/2);
    const half = cropped.roi(new cv.Rect(0, 0, mid, cropped.rows));  // left half

    const padP = Math.max(2, Math.floor(Math.min(half.rows, half.cols)*0.05));
    const rw = half.cols-2*padP, rh = half.rows-2*padP;
    const inner = half.roi(new cv.Rect(padP, padP, rw, rh));
    const regionArea = rw * rh;
    const minPip = regionArea * 0.002, maxPip = regionArea * 0.10;

    let gray = new cv.Mat(), thresh = new cv.Mat(), conts = new cv.MatVector(), hier = new cv.Mat();
    cv.cvtColor(inner, gray, cv.COLOR_RGBA2GRAY);
    cv.threshold(gray, thresh, 0, 255, cv.THRESH_BINARY_INV + cv.THRESH_OTSU);

    // Print Otsu threshold value by checking what values exist in thresh
    let whitePx = 0;
    for (let r = 0; r < thresh.rows; r++)
      for (let c2 = 0; c2 < thresh.cols; c2++)
        if (thresh.ucharAt(r,c2) > 0) whitePx++;

    console.log(`\n=== ${label} LEFT HALF (expected 12 for 469, 5 for 467) ===`);
    console.log(`Region: ${rw}×${rh} = ${regionArea}px², minPip=${minPip.toFixed(0)} maxPip=${maxPip.toFixed(0)}`);
    console.log(`White px after threshold: ${whitePx} (${(100*whitePx/regionArea).toFixed(1)}%)`);

    cv.findContours(thresh, conts, hier, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
    let accepted = 0;
    for (let i = 0; i < conts.size(); i++) {
      const c = conts.get(i);
      const area = cv.contourArea(c);
      const peri = cv.arcLength(c, true);
      c.delete();
      const circ = peri > 0 ? (4*Math.PI*area)/(peri*peri) : 0;
      const ok = area>=minPip && area<=maxPip && circ>=0.45;
      if (ok) accepted++;
      if (area >= minPip*0.5) {
        console.log(`  ${ok?"✓":"✗"} area=${area.toFixed(0)} circ=${circ.toFixed(2)} ${area<minPip?"TOO_SMALL":area>maxPip?"TOO_BIG":circ<0.45?"LOW_CIRC":""}`);
      }
    }
    console.log(`  → Accepted: ${accepted}`);

    gray.delete(); thresh.delete(); conts.delete(); hier.delete();
    inner.delete(); half.delete();
    cropped.delete(); rotated.delete(); M.delete(); src.delete();
  }
  process.exit(0);
};
setTimeout(() => { console.log("TIMEOUT"); process.exit(1); }, 120000);
