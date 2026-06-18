// Per-half pip-counting eval against visually-verified ground truth.
// Feeds each ref_*_tile*.jpg crop (already grayscale-stretched) straight into
// splitAndCount, scoring left/right halves independently so countPips errors
// are pinpointed. No full-frame photos or findTiles involved.
//   node grid_eval.cjs
const fs = require("fs");
const path = require("path");
const jpeg = require("jpeg-js");
const cv = require("@techstark/opencv-js");

const DIR = __dirname;
const TRUTH = JSON.parse(fs.readFileSync(path.join(DIR, "grid_truth.json"), "utf8"));

cv.onRuntimeInitialized = () => {
  global.cv = cv;
  global.window = {};
  global.document = { createElement: () => ({ getContext: () => ({}), toDataURL: () => "" }) };
  new Function(fs.readFileSync(path.join(DIR, "..", "detect.js"), "utf8"))();
  const D = global.window.DominoCV;

  let halfOK = 0, halfTot = 0, tileOK = 0, tileTot = 0;
  for (const [name, exp] of Object.entries(TRUTH)) {
    if (name.startsWith("_")) continue;
    const raw = jpeg.decode(fs.readFileSync(path.join(DIR, `${name}.jpg`)), { useTArray: true });
    const src = cv.matFromImageData({ data: new Uint8ClampedArray(raw.data), width: raw.width, height: raw.height });
    const got = D._test.splitAndCount(src, 0.9);
    src.delete();
    const gL = got.left, gR = got.right, eL = exp[0], eR = exp[1];
    const okL = gL === eL, okR = gR === eR;
    halfOK += (okL ? 1 : 0) + (okR ? 1 : 0); halfTot += 2;
    const tOK = okL && okR; if (tOK) tileOK++; tileTot++;
    console.log(`${tOK ? "✓" : "✗"} ${name.padEnd(16)} got ${gL}|${gR}  exp ${eL}|${eR}  ${okL ? " " : "L"}${okR ? " " : "R"}`);
  }
  console.log(`\nHALVES: ${halfOK}/${halfTot}   TILES: ${tileOK}/${tileTot}`);
  process.exit(0);
};
setTimeout(() => { console.log("TIMEOUT waiting for OpenCV.js"); process.exit(1); }, 120000);
