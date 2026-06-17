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
  global.cv = cv;
  global.window = {};
  global.document = { createElement: () => ({ getContext: () => ({}), toDataURL: () => "" }) };
  // Patch countPips to use grid before loading
  let src = fs.readFileSync(path.join(DIR, "..", "detect.js"), "utf8");
  // Replace countPips dispatch to use grid
  src = src.replace(
    "function countPips(halfMat) {\n    return countPipsContour(halfMat);\n  }",
    "function countPips(halfMat) {\n    return countPipsGrid(halfMat);\n  }"
  );
  new Function(src)();
  const D = global.window.DominoCV;
  const norm = (t) => (t[0] <= t[1] ? `${t[0]}-${t[1]}` : `${t[1]}-${t[0]}`);
  const score = (got, exp) => {
    const pool = exp.map(norm); let c = 0;
    for (const g of got.map(norm)) { const i = pool.indexOf(g); if (i >= 0) { c++; pool.splice(i, 1); } }
    return c;
  };
  let totC = 0, totE = 0, perfect = 0;
  for (const [name, exp] of Object.entries(FIX)) {
    const raw = jpeg.decode(fs.readFileSync(path.join(DIR, "photos", `${name}.jpg`)), { useTArray: true });
    D._test.stretchGray(raw.data);
    const src2 = cv.matFromImageData({ data: new Uint8ClampedArray(raw.data), width: raw.width, height: raw.height });
    const tiles = D._test.scanMat(src2); src2.delete();
    const got = tiles.map(t => [t.left, t.right]);
    const c = score(got, exp); totC += c; totE += exp.length;
    const ok = c === exp.length && got.length === exp.length; if (ok) perfect++;
    const fmt = a => a.map(t=>`${t[0]}|${t[1]}`).join(" ") || "—";
    console.log(`${ok?"✓":"✗"} ${name}  got: ${fmt(got).padEnd(26)}exp: ${fmt(exp)}   ${c}/${exp.length}`);
  }
  console.log(`\nGRID TOTAL: ${totC}/${totE} tiles · ${perfect}/${Object.keys(FIX).length} photos perfect`);
  process.exit(0);
};
setTimeout(() => { process.exit(1); }, 120000);
