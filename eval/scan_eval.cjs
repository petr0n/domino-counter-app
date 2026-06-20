// End-to-end SCAN eval (free, local). Runs the REAL pipeline on committed
// multi-tile photos — preprocess (stretchGray) -> findTiles -> crop -> countPips
// via scanMat — and scores the detected tiles against ground truth as an
// unordered multiset of normalized [min,max] pairs (detection order and tile
// left/right orientation vary, so neither is scored). This exercises the
// crop+count interaction that grid_eval (hand-cropped single tiles) does not.
//   node scan_eval.cjs
const fs = require("fs");
const path = require("path");
const jpeg = require("jpeg-js");
const cv = require("@techstark/opencv-js");

// All three photos contain the SAME three physical dominoes (user-confirmed).
const SET = [[6, 6], [1, 8], [1, 10]];
const TRUTH = {
  "detect_towel3.jpg": SET,
  "detect_grass3.jpg": SET,
  "detect_glare3.jpg": SET,
};

const key = ([a, b]) => `${Math.min(a, b)}-${Math.max(a, b)}`;

cv.onRuntimeInitialized = () => {
  global.cv = cv; global.window = {};
  global.document = { createElement: () => ({ getContext: () => ({}), toDataURL: () => "" }) };
  new Function(fs.readFileSync(path.join(__dirname, "..", "detect.js"), "utf8"))();
  const D = global.window.DominoCV;

  let tileOK = 0, tileTot = 0, photoOK = 0, photoTot = 0;
  for (const [name, exp] of Object.entries(TRUTH)) {
    const raw = jpeg.decode(fs.readFileSync(path.join(__dirname, name)), { useTArray: true });
    D._test.stretchGray(raw.data);
    const src = cv.matFromImageData({ data: new Uint8ClampedArray(raw.data), width: raw.width, height: raw.height });
    const got = D._test.scanMat(src).map(t => [t.left, t.right]);
    src.delete();

    // Multiset match on normalized keys.
    const pool = exp.map(key);
    let matched = 0;
    for (const g of got.map(key)) {
      const i = pool.indexOf(g);
      if (i >= 0) { matched++; pool.splice(i, 1); }
    }
    tileOK += matched; tileTot += exp.length;
    const ok = matched === exp.length && got.length === exp.length;
    if (ok) photoOK++; photoTot++;
    console.log(`${ok ? "✓" : "✗"} ${name.padEnd(18)} got [${got.map(g => g.join("|")).join("  ")}]  matched ${matched}/${exp.length}`);
  }
  console.log(`\nSCAN: ${tileOK}/${tileTot} tiles, ${photoOK}/${photoTot} photos`);
  process.exit(0);
};
setTimeout(() => { console.log("TIMEOUT waiting for OpenCV.js"); process.exit(1); }, 120000);
