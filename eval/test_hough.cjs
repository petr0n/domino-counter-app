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

  // Replace countPipsContour with HoughCircles-based approach
  const houghFn = `
  function countPipsHough(halfMat) {
    const S = 200; // normalize to fixed size for consistent circle params
    let resized=null, gray=null, blurred=null, circles=null;
    try {
      resized = new cv.Mat();
      cv.resize(halfMat, resized, new cv.Size(S, S));
      gray = new cv.Mat();
      cv.cvtColor(resized, gray, cv.COLOR_RGBA2GRAY);
      blurred = new cv.Mat();
      cv.GaussianBlur(gray, blurred, new cv.Size(7,7), 2);
      circles = new cv.Mat();
      // dp=1, minDist=20, param1=50 (Canny high threshold), param2=15 (accumulator threshold),
      // minRadius=8, maxRadius=40 (tuned for 200px wide half with 0-12 pips)
      cv.HoughCircles(blurred, circles, cv.HOUGH_GRADIENT, 1, 20, 50, 15, 8, 40);
      return Math.min(circles.cols, 12);
    } finally {
      if (resized) resized.delete();
      if (gray) gray.delete();
      if (blurred) blurred.delete();
      if (circles) circles.delete();
    }
  }`;

  let code = srcCode.replace(
    "function countPips(halfMat) {\n    return countPipsContour(halfMat);\n  }",
    `${houghFn}\n  function countPips(halfMat) {\n    return countPipsHough(halfMat);\n  }`
  );

  global.window = {};
  new Function(code)();
  const D = global.window.DominoCV;
  let totC = 0, totE = 0, perfect = 0;
  for (const [name, exp] of Object.entries(FIX)) {
    const raw = jpeg.decode(fs.readFileSync(path.join(DIR, "photos", `${name}.jpg`)), { useTArray: true });
    D._test.stretchGray(raw.data);
    const src2 = cv.matFromImageData({ data: new Uint8ClampedArray(raw.data), width: raw.width, height: raw.height });
    const tiles = D._test.scanMat(src2); src2.delete();
    const got = tiles.map(t => [t.left, t.right]);
    const pool = exp.map(norm); let c = 0;
    for (const g of got.map(norm)) { const i = pool.indexOf(g); if (i >= 0) { c++; pool.splice(i,1); } }
    totC += c; totE += exp.length;
    const ok = c===exp.length&&got.length===exp.length; if(ok) perfect++;
    const fmt = a => a.map(t=>`${t[0]}|${t[1]}`).join(" ")||"—";
    console.log(`${ok?"✓":"✗"} ${name}  got: ${fmt(got).padEnd(28)}exp: ${fmt(exp)}   ${c}/${exp.length}`);
  }
  console.log(`\nHOUGH TOTAL: ${totC}/${totE} tiles · ${perfect}/${Object.keys(FIX).length} photos perfect`);
  process.exit(0);
};
setTimeout(() => { process.exit(1); }, 120000);
