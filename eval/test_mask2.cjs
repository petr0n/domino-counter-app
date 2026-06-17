const fs = require("fs"), path = require("path"), jpeg = require("jpeg-js"), cv = require("@techstark/opencv-js");
const DIR = __dirname;
const FIX = {
  "467": [[9,1],[9,9]], "468": [[2,4],[9,1],[9,3]], "469": [[9,9],[9,9]],
  "470": [[0,10],[10,4]], "471": [[3,3],[0,1]],
};
cv.onRuntimeInitialized = () => {
  global.cv = cv; global.window = {};
  global.document = { createElement: () => ({ getContext: () => ({}), toDataURL: () => "" }) };
  const srcCode = fs.readFileSync(path.join(DIR, "..", "detect.js"), "utf8");
  const norm = (t) => (t[0] <= t[1] ? `${t[0]}-${t[1]}` : `${t[1]}-${t[0]}`);
  const scoreAll = (results) => {
    let totC = 0, totE = 0;
    for (const [name, exp] of Object.entries(FIX)) {
      const got = results[name] || [];
      const pool = exp.map(norm); let c = 0;
      for (const g of got.map(norm)) { const i = pool.indexOf(g); if (i >= 0) { c++; pool.splice(i,1); } }
      totC += c; totE += exp.length;
    }
    return `${totC}/${totE}`;
  };

  for (const tileThresh of [60, 80, 100, 120, 140]) {
    const maskedFn = `
    function countPipsMasked(halfMat) {
      const pad = Math.max(2, Math.floor(Math.min(halfMat.rows, halfMat.cols) * 0.08));
      const rw = halfMat.cols - 2*pad, rh = halfMat.rows - 2*pad;
      if (rw < 10 || rh < 10) return 0;
      const inner = halfMat.roi(new cv.Rect(pad, pad, rw, rh));
      let gray=null, tileMask=null, notMask=null, masked=null, thresh=null, conts=null, hierP=null;
      try {
        gray = new cv.Mat(); cv.cvtColor(inner, gray, cv.COLOR_RGBA2GRAY);
        tileMask = new cv.Mat();
        cv.threshold(gray, tileMask, ${tileThresh}, 255, cv.THRESH_BINARY);
        const k = cv.Mat.ones(21,21,cv.CV_8U);
        const tmp = new cv.Mat();
        cv.morphologyEx(tileMask, tmp, cv.MORPH_CLOSE, k);
        k.delete(); tileMask.delete(); tileMask = tmp;
        masked = new cv.Mat(); gray.copyTo(masked);
        notMask = new cv.Mat(); cv.bitwise_not(tileMask, notMask);
        masked.setTo(new cv.Scalar(255), notMask);
        thresh = new cv.Mat();
        cv.threshold(masked, thresh, 0, 255, cv.THRESH_BINARY_INV + cv.THRESH_OTSU);
        cv.bitwise_and(thresh, tileMask, thresh);
        conts = new cv.MatVector(); hierP = new cv.Mat();
        cv.findContours(thresh, conts, hierP, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
        const regionArea = rw*rh, minPip=regionArea*0.002, maxPip=regionArea*0.10;
        let count = 0;
        for (let i = 0; i < conts.size(); i++) {
          const c = conts.get(i); const area = cv.contourArea(c);
          const peri = cv.arcLength(c, true); c.delete();
          const circ = peri > 0 ? (4*Math.PI*area)/(peri*peri) : 0;
          if (area >= minPip && area <= maxPip && circ >= 0.45) count++;
        }
        return Math.min(count, 12);
      } finally {
        inner.delete(); if(gray)gray.delete(); if(tileMask)tileMask.delete();
        if(notMask)notMask.delete(); if(masked)masked.delete(); if(thresh)thresh.delete();
        if(conts)conts.delete(); if(hierP)hierP.delete();
      }
    }`;
    let code = srcCode.replace(
      "function countPips(halfMat) {\n    return countPipsContour(halfMat);\n  }",
      `${maskedFn}\n  function countPips(halfMat) {\n    return countPipsMasked(halfMat);\n  }`
    );
    global.window = {};
    new Function(code)();
    const D = global.window.DominoCV;
    const results = {};
    for (const [name] of Object.entries(FIX)) {
      const raw = jpeg.decode(fs.readFileSync(path.join(DIR, "photos", `${name}.jpg`)), { useTArray: true });
      D._test.stretchGray(raw.data);
      const src2 = cv.matFromImageData({ data: new Uint8ClampedArray(raw.data), width: raw.width, height: raw.height });
      results[name] = D._test.scanMat(src2).map(t=>[t.left,t.right]); src2.delete();
    }
    const fmt467 = results["467"].map(t=>t.join("|")).join(" ");
    const fmt469 = results["469"].map(t=>t.join("|")).join(" ");
    console.log(`tileThresh=${tileThresh}: ${scoreAll(results)} | 467:[${fmt467}] 469:[${fmt469}]`);
  }
  process.exit(0);
};
setTimeout(() => { process.exit(1); }, 120000);
