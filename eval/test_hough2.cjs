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

  for (const [p1, p2, minD, minR, maxR] of [
    [30, 8, 20, 10, 30],
    [30, 10, 20, 10, 30],
    [30, 12, 20, 10, 30],
    [40, 8, 20, 10, 30],
    [40, 10, 20, 10, 30],
    [50, 8, 15, 8, 30],
    [50, 10, 15, 8, 30],
    [60, 8, 15, 8, 35],
    [60, 10, 15, 8, 35],
    [80, 8, 15, 8, 35],
  ]) {
    const houghFn = `
    function countPipsHough(halfMat) {
      const S = 200;
      let resized=null, gray=null, blurred=null, circles=null;
      try {
        resized = new cv.Mat(); cv.resize(halfMat, resized, new cv.Size(S, S));
        gray = new cv.Mat(); cv.cvtColor(resized, gray, cv.COLOR_RGBA2GRAY);
        blurred = new cv.Mat(); cv.GaussianBlur(gray, blurred, new cv.Size(5,5), 1.5);
        circles = new cv.Mat();
        cv.HoughCircles(blurred, circles, cv.HOUGH_GRADIENT, 1, ${minD}, ${p1}, ${p2}, ${minR}, ${maxR});
        return Math.min(circles.cols, 12);
      } finally {
        if (resized) resized.delete(); if (gray) gray.delete(); if (blurred) blurred.delete(); if (circles) circles.delete();
      }
    }`;
    let code = srcCode.replace(
      "function countPips(halfMat) {\n    return countPipsContour(halfMat);\n  }",
      `${houghFn}\n  function countPips(halfMat) {\n    return countPipsHough(halfMat);\n  }`
    );
    global.window = {};
    new Function(code)();
    const D = global.window.DominoCV;
    const results = {};
    for (const [name] of Object.entries(FIX)) {
      const raw = jpeg.decode(fs.readFileSync(path.join(DIR, "photos", `${name}.jpg`)), { useTArray: true });
      D._test.stretchGray(raw.data);
      const src2 = cv.matFromImageData({ data: new Uint8ClampedArray(raw.data), width: raw.width, height: raw.height });
      results[name] = D._test.scanMat(src2).map(t => [t.left, t.right]); src2.delete();
    }
    const fmt467 = results["467"].map(t=>t.join("|")).join(" ");
    const fmt470 = results["470"].map(t=>t.join("|")).join(" ");
    console.log(`p1=${p1} p2=${p2} minD=${minD} r=${minR}-${maxR}: ${scoreAll(results)} | 467:${fmt467} 470:${fmt470}`);
  }
  process.exit(0);
};
setTimeout(() => { process.exit(1); }, 120000);
