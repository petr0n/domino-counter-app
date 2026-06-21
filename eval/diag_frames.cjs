// Diagnostic: trace findTiles blob filtering + dividerScan bars on captured frames.
//   node eval/diag_frames.cjs
const fs   = require("fs");
const path = require("path");
const jpeg = require("jpeg-js");
const cv   = require("@techstark/opencv-js");

const FRAMES_DIR = path.join(__dirname, "sessions/current/photos");
const frames = fs.readdirSync(FRAMES_DIR).filter(f => f.endsWith(".jpg")).sort();

cv.onRuntimeInitialized = () => {
  global.cv = cv;
  global.window = {};
  global.document = { createElement: () => ({ getContext: () => ({}), toDataURL: () => "" }) };
  new Function(fs.readFileSync(path.join(__dirname, "..", "detect.js"), "utf8"))();
  const D = global.window.DominoCV;

  for (const fname of frames) {
    const raw = jpeg.decode(fs.readFileSync(path.join(FRAMES_DIR, fname)), { useTArray: true });
    D._test.stretchGray(raw.data);
    const src = cv.matFromImageData({ data: new Uint8ClampedArray(raw.data), width: raw.width, height: raw.height });

    // ── Main-path blob analysis ─────────────────────────────────────────────
    const gray = new cv.Mat(), blurred = new cv.Mat(), binary = new cv.Mat(), eroded = new cv.Mat();
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
    cv.GaussianBlur(gray, blurred, new cv.Size(5, 5), 0);
    const otsuThresh = cv.threshold(blurred, binary, 0, 255, cv.THRESH_BINARY + cv.THRESH_OTSU);
    const kSize = Math.max(3, Math.round(Math.min(src.cols, src.rows) * 0.01));
    const kernel = cv.Mat.ones(kSize, kSize, cv.CV_8U);
    cv.erode(binary, eroded, kernel);
    const contours = new cv.MatVector(), hier = new cv.Mat();
    cv.findContours(eroded, contours, hier, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
    const frameArea = src.cols * src.rows;
    const minArea = frameArea * 0.015, maxArea = frameArea * 0.70;
    const edgeMargin = Math.min(src.cols, src.rows) * 0.03;
    const expected = parseInt((fname.match(/_d(\d+)\.jpg$/) || [])[1], 10);
    console.log(`\n── ${fname}  ${src.cols}x${src.rows}  Otsu=${otsuThresh.toFixed(0)}  contours=${contours.size()}  exp=${expected}`);
    let tooSmall = 0, tooBig = 0, passed = 0;
    for (let i = 0; i < contours.size(); i++) {
      const c = contours.get(i);
      const area = cv.contourArea(c);
      if (area < minArea) { tooSmall++; c.delete(); continue; }
      if (area > maxArea) { tooBig++;  c.delete(); continue; }
      const rect = cv.minAreaRect(c);
      const rw = rect.size.width, rh = rect.size.height;
      const ratio = Math.max(rw, rh) / Math.min(rw, rh);
      const fill  = area / (rw * rh);
      const pts   = cv.RotatedRect.points(rect);
      const cx    = (pts[0].x+pts[1].x+pts[2].x+pts[3].x)/4;
      const cy    = (pts[0].y+pts[1].y+pts[2].y+pts[3].y)/4;
      const atEdge = (cx < edgeMargin || cx > src.cols-edgeMargin || cy < edgeMargin || cy > src.rows-edgeMargin);
      let branch = "→ else/dividerSplit";
      if (ratio >= 1.3 && ratio <= 3.0 && fill >= 0.72) branch = "→ single-tile";
      else if ((ratio >= 0.85 && ratio < 1.3 && fill >= 0.60) || (ratio > 3.0 && ratio < 5.0 && fill >= 0.55)) branch = "→ two-tile-split";
      passed++;
      console.log(`  blob[${i}] ${Math.round(rw)}x${Math.round(rh)} ratio=${ratio.toFixed(2)} fill=${fill.toFixed(2)} cx=${Math.round(cx)} cy=${Math.round(cy)}${atEdge?" EDGE":""} ${branch}`);
      c.delete();
    }
    console.log(`  tooSmall=${tooSmall} tooBig=${tooBig} passed-area=${passed}`);

    // ── dividerScan bar tracing (all bars that pass shape + area filters) ───
    {
      const scale = Math.min(1, 1200 / Math.max(src.cols, src.rows));
      const work = scale < 1 ? (() => { const w = new cv.Mat(); cv.resize(src, w, new cv.Size(Math.round(src.cols*scale), Math.round(src.rows*scale))); return w; })() : src;
      const g2 = new cv.Mat(); cv.cvtColor(work, g2, cv.COLOR_RGBA2GRAY);
      const ks = (Math.round(Math.min(work.cols, work.rows) * 0.045) | 1);
      const kern2 = cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(ks, ks));
      const bh = new cv.Mat(); cv.morphologyEx(g2, bh, cv.MORPH_BLACKHAT, kern2);
      const bin2 = new cv.Mat(); cv.threshold(bh, bin2, 0, 255, cv.THRESH_BINARY + cv.THRESH_OTSU);
      const co2 = new cv.MatVector(), h2 = new cv.Mat();
      cv.findContours(bin2, co2, h2, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
      const fa2 = work.cols * work.rows;
      const mn2 = fa2 * 0.015, mx2 = fa2 * 0.70;
      let tooThin = 0, badSize = 0;
      for (let i = 0; i < co2.size(); i++) {
        const d = co2.get(i);
        const r = cv.minAreaRect(d); d.delete();
        const W = r.size.width, H = r.size.height;
        const L = Math.max(W,H), S = Math.min(W,H);
        if (L / Math.max(1,S) < 3.5) { tooThin++; continue; }
        const tileArea = 2*L*L;
        if (tileArea < mn2 || tileArea > mx2) { badSize++; continue; }
        const ang = (W >= H ? r.angle : r.angle + 90) * Math.PI / 180;
        const ux = Math.cos(ang), uy = Math.sin(ang), px = -uy, py = ux;
        const cx = r.center.x, cy = r.center.y;
        const hs = L/2, hl = L, step = Math.max(3, L/14);
        let sum = 0, n = 0, inFrame = 0;
        for (let s = -hs; s <= hs; s += step)
          for (let l = -hl; l <= hl; l += step) {
            const xx = Math.round(cx + s*ux + l*px), yy = Math.round(cy + s*uy + l*py);
            n++;
            if (xx>=0 && yy>=0 && xx<work.cols && yy<work.rows) { inFrame++; sum += g2.ucharPtr(yy,xx)[0]; }
          }
        const meanB = inFrame ? sum/inFrame : 0;
        const inf = n ? inFrame/n : 0;
        // proposed checks
        const centerFits = (cx - L >= 0 && cx + L <= work.cols && cy - L >= 0 && cy + L <= work.rows);
        const pass = meanB >= 150 && inf >= 0.9;
        const passRelaxed = meanB >= 140 && inf >= 0.85;
        const tag = pass ? "✓PASS" : (passRelaxed ? "~RELAXED" : "✗FAIL");
        console.log(`  bar L=${Math.round(L)} meanB=${meanB.toFixed(0)} inFrame=${(inf*100).toFixed(0)}% cx=${Math.round(cx)} cy=${Math.round(cy)} centerFits=${centerFits} ${tag}`);
      }
      console.log(`  dividerScan: tooThin=${tooThin} badSize=${badSize}`);
      if (work !== src) work.delete();
      g2.delete(); kern2.delete(); bh.delete(); bin2.delete(); co2.delete(); h2.delete();
    }

    const found = D._test.findTiles(src, 0.015, 0.70, 0.03);
    console.log(`  ► findTiles: ${found.length} tiles`);
    gray.delete(); blurred.delete(); binary.delete(); eroded.delete();
    kernel.delete(); contours.delete(); hier.delete(); src.delete();
  }
  process.exit(0);
};
setTimeout(() => { console.log("TIMEOUT"); process.exit(1); }, 120000);
