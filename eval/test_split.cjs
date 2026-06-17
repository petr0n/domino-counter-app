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
  let code = fs.readFileSync(path.join(DIR, "..", "detect.js"), "utf8");

  // Patch findTiles: accept 0.8-1.4 (n=2 side-by-side) and 1.5-3.0 (n=1 single), 3.5-5.0 (n=2 end-to-end)
  code = code.replace(
    "// Accept only single-tile shapes (~2:1). Erosion separates touching\n          // tiles into their own contours, so accepting ~1:1 or ~4:1 blobs only\n          // lets two merged tiles through as one and miscounts them.\n          if (ratio >= 1.5 && ratio <= 3.0) {",
    `// n=1 for single tiles, n=2 for merged pairs
          let tileN = 0;
          if (ratio >= 1.5 && ratio <= 3.0) tileN = 1;
          else if (ratio >= 0.8 && ratio < 1.5) tileN = 2; // side-by-side pair
          else if (ratio > 3.0 && ratio <= 5.5) tileN = 2; // end-to-end pair
          if (tileN > 0) {`
  );
  code = code.replace(
    "if (!dup) rects.push({ pts, cx, cy });",
    "if (!dup) rects.push({ pts, cx, cy, n: tileN });"
  );

  // Patch scanMat to call expandTiles
  code = code.replace(
    "const found = findTiles(src, 0.02, 0.70, 0.03);",
    "const found = expandTiles(findTiles(src, 0.02, 0.70, 0.03));"
  );

  new Function(code)();
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
    console.log(`${ok?"✓":"✗"} ${name}  got: ${fmt(got).padEnd(30)}exp: ${fmt(exp)}   ${c}/${exp.length}`);
  }
  console.log(`\nSPLIT TOTAL: ${totC}/${totE} tiles · ${perfect}/${Object.keys(FIX).length} photos perfect`);
  process.exit(0);
};
setTimeout(() => { process.exit(1); }, 120000);
