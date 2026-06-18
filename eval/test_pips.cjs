const fs = require("fs"), path = require("path"), jpeg = require("jpeg-js"), cv = require("@techstark/opencv-js");
const DIR = __dirname;
const FIX = {
  "467": [[9,1],[9,9]],
  "468": [[2,4],[9,1],[9,3]],
  "469": [[9,9],[9,9]],
  "470": [[0,10],[10,4]],
  "471": [[3,3],[0,1]],
};
cv.onRuntimeInitialized = () => {
  global.cv = cv;
  global.window = {};
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

  // Test different minPip and erosion combinations
  for (const minFrac of [0.001, 0.002, 0.003]) {
    for (const erosionK of [0, 2, 3, 5]) {
      // Patch countPipsContour
      let code = srcCode.replace(
        "const regionArea = rw * rh, minPip = regionArea * 0.002, maxPip = regionArea * 0.10;",
        `const regionArea = rw * rh, minPip = regionArea * ${minFrac}, maxPip = regionArea * 0.10;`
      );
      if (erosionK > 0) {
        code = code.replace(
          "cv.findContours(thresh, conts, hierP, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);",
          `const ek${erosionK} = cv.Mat.ones(${erosionK},${erosionK},cv.CV_8U); const ethresh${erosionK}=new cv.Mat(); cv.erode(thresh,ethresh${erosionK},ek${erosionK}); ek${erosionK}.delete(); if(thresh)thresh.delete(); thresh=ethresh${erosionK};\n      cv.findContours(thresh, conts, hierP, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);`
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
      console.log(`minFrac=${minFrac} erosionK=${erosionK}: ${scoreAll(results)}`);
    }
  }
  process.exit(0);
};
setTimeout(() => { process.exit(1); }, 120000);
