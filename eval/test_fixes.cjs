const fs = require("fs"), path = require("path"), jpeg = require("jpeg-js"), cv = require("@techstark/opencv-js");
const DIR = __dirname;
const FIX = {
  "464": [[9,1],[9,1],[9,9]],
  "465": [[9,9],[9,9],[9,1],[9,9]],
  "466": [[6,9],[9,1],[2,2]],
  "467": [[9,1],[9,9]],
  "468": [[2,4],[9,1],[9,3]],
  "469": [[9,9],[9,9]],
  "470": [[0,10],[10,4]],
  "471": [[3,3],[0,1]],
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

  for (const [pipPad, erosionK] of [[0.05,0],[0.10,0],[0.12,0],[0.15,0],[0.10,3],[0.12,3],[0.12,5],[0.15,3]]) {
    let code = srcCode;
    // Change pip-counting inner padding
    code = code.replace(
      "const pad = Math.max(2, Math.floor(Math.min(halfMat.rows, halfMat.cols) * 0.05));",
      `const pad = Math.max(2, Math.floor(Math.min(halfMat.rows, halfMat.cols) * ${pipPad}));`
    );
    // Add erosion after Otsu threshold
    if (erosionK > 0) {
      code = code.replace(
        "cv.findContours(thresh, conts, hierP, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);",
        `const pipEK = cv.Mat.ones(${erosionK},${erosionK},cv.CV_8U); const pipET = new cv.Mat(); cv.erode(thresh,pipET,pipEK); pipEK.delete(); thresh.delete(); thresh = pipET;\n      cv.findContours(thresh, conts, hierP, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);`
      );
    }
    global.window = {};
    new Function(code)();
    const D = global.window.DominoCV;
    const results = {};
    for (const [name, exp] of Object.entries(FIX)) {
      const raw = jpeg.decode(fs.readFileSync(path.join(DIR, "photos", `${name}.jpg`)), { useTArray: true });
      D._test.stretchGray(raw.data);
      const src2 = cv.matFromImageData({ data: new Uint8ClampedArray(raw.data), width: raw.width, height: raw.height });
      const tiles = D._test.scanMat(src2); src2.delete();
      results[name] = tiles.map(t => [t.left, t.right]);
    }
    console.log(`pipPad=${pipPad} erosionK=${erosionK}: ${scoreAll(results)}`);
  }
  process.exit(0);
};
setTimeout(() => { process.exit(1); }, 120000);
