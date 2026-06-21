// Tile-DETECTION eval (free, local). grid_eval.cjs feeds pre-cropped single
// tiles to the counter and so never exercises findTiles; this does. It runs the
// real pipeline (preprocess + findTiles) on committed multi-tile photos and
// checks how many tiles are detected against ground truth.
//   node detect_eval.cjs
const fs = require("fs");
const path = require("path");
const jpeg = require("jpeg-js");
const cv = require("@techstark/opencv-js");

// committed multi-tile fixtures: file -> expected tile count
const TRUTH = {
  "detect_4tiles.jpg": 4, // 4 dominoes, top two touching at an angle
  "detect_towel3.jpg": 3, // 3 tiles on a white towel (tiles fuse with bright bg)
  "detect_glare3.jpg": 3, // 3 tiles on glossy table with sun glare + grass
  "detect_grass3.jpg": 3, // 3 tiles touching in a column, wood table + grass
  "detect_stack4.jpg": 4, // 4 tiles, top 3 fused into one blob (3-stack split via dividers)
  "detect_cloth4.jpg": 4, // 4 tiles on a white cloth (white-on-white, recovered via pipClusterScan)
};

cv.onRuntimeInitialized = () => {
  global.cv = cv;
  global.window = {};
  global.document = { createElement: () => ({ getContext: () => ({}), toDataURL: () => "" }) };
  new Function(fs.readFileSync(path.join(__dirname, "..", "detect.js"), "utf8"))();
  const D = global.window.DominoCV;

  let ok = 0, tot = 0;
  for (const [name, exp] of Object.entries(TRUTH)) {
    const raw = jpeg.decode(fs.readFileSync(path.join(__dirname, name)), { useTArray: true });
    D._test.stretchGray(raw.data); // replicate DominoCV.preprocess
    const src = cv.matFromImageData({ data: new Uint8ClampedArray(raw.data), width: raw.width, height: raw.height });
    const found = D._test.findTiles(src, 0.015, 0.70, 0.03);
    src.delete();
    const good = found.length === exp; if (good) ok++; tot++;
    console.log(`${good ? "✓" : "✗"} ${name.padEnd(20)} found ${found.length}  exp ${exp}`);
  }
  console.log(`\nDETECTION: ${ok}/${tot} photos correct`);
  process.exit(ok === tot ? 0 : 1);
};
setTimeout(() => { console.log("TIMEOUT waiting for OpenCV.js"); process.exit(1); }, 120000);
