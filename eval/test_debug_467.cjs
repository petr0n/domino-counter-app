const fs = require("fs"), path = require("path"), jpeg = require("jpeg-js"), cv = require("@techstark/opencv-js");
const DIR = __dirname;
cv.onRuntimeInitialized = () => {
  global.cv = cv; global.window = {};
  global.document = { createElement: () => ({ getContext: () => ({}), toDataURL: () => "" }) };
  
  let code = fs.readFileSync(path.join(DIR, "..", "detect.js"), "utf8");
  
  // Patch countPipsContour to print intermediate values
  code = code.replace(
    "return Math.min(count, 12);",
    `console.log(\`  half \${rw}x\${rh}: \${conts.size()} contours, \${count} valid pips (min=\${minPip.toFixed(0)}, max=\${maxPip.toFixed(0)})\`);
      return Math.min(count, 12);`
  );
  // Add per-contour debug
  code = code.replace(
    "if (area >= minPip && area <= maxPip && circ >= 0.45) count++;",
    `const ok = area >= minPip && area <= maxPip && circ >= 0.45;
         if (!ok) console.log(\`    skip a=\${area.toFixed(0)} circ=\${circ.toFixed(2)} \${area<minPip?'<min':area>maxPip?'>max':'low-circ'}\`);
         if (ok) count++;`
  );
  
  new Function(code)();
  const D = global.window.DominoCV;
  
  const raw = jpeg.decode(fs.readFileSync(path.join(DIR, "photos", "467.jpg")), { useTArray: true });
  D._test.stretchGray(raw.data);
  const src = cv.matFromImageData({ data: new Uint8ClampedArray(raw.data), width: raw.width, height: raw.height });
  console.log(`Image: ${raw.width}x${raw.height}`);
  const tiles = D._test.scanMat(src); src.delete();
  console.log("Results:", tiles.map(t => `${t.left}|${t.right}`).join(" "));
  console.log("Expected: 9|1 9|9");
  process.exit(0);
};
setTimeout(() => { process.exit(1); }, 120000);
