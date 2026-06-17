const fs = require("fs"), path = require("path"), jpeg = require("jpeg-js"), cv = require("@techstark/opencv-js");
const DIR = __dirname;
cv.onRuntimeInitialized = () => {
  global.cv = cv; global.window = {};
  global.document = { createElement: () => ({ getContext: () => ({}), toDataURL: () => "" }) };
  new Function(fs.readFileSync(path.join(DIR, "..", "detect.js"), "utf8"))();
  const D = global.window.DominoCV;

  for (const name of ["464","465","466","467","468","469","470","471"]) {
    const raw = jpeg.decode(fs.readFileSync(path.join(DIR, "photos", `${name}.jpg`)), { useTArray: true });
    D._test.stretchGray(raw.data);
    const src = cv.matFromImageData({ data: new Uint8ClampedArray(raw.data), width: raw.width, height: raw.height });
    
    // Run findTiles with wide ratio to see all blobs
    let gray=null, blurred=null, binary=null, eroded=null, kernel=null, contours=null, hier=null;
    const blobs = [];
    try {
      gray = new cv.Mat(); cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
      blurred = new cv.Mat(); cv.GaussianBlur(gray, blurred, new cv.Size(5,5), 0);
      binary = new cv.Mat(); cv.threshold(blurred, binary, 0, 255, cv.THRESH_BINARY + cv.THRESH_OTSU);
      const kSize = Math.max(3, Math.round(Math.min(src.cols, src.rows) * 0.01));
      kernel = cv.Mat.ones(kSize, kSize, cv.CV_8U);
      eroded = new cv.Mat(); cv.erode(binary, eroded, kernel);
      contours = new cv.MatVector(); hier = new cv.Mat();
      cv.findContours(eroded, contours, hier, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
      const frameArea = src.cols * src.rows;
      const minArea = frameArea * 0.02, maxArea = frameArea * 0.70;
      for (let i = 0; i < contours.size(); i++) {
        const c = contours.get(i); const area = cv.contourArea(c);
        if (area >= minArea && area <= maxArea) {
          const rect = cv.minAreaRect(c); const rw = rect.size.width, rh = rect.size.height;
          const ratio = Math.max(rw,rh)/Math.min(rw,rh);
          blobs.push({ ratio: ratio.toFixed(2), areaPct: (area/frameArea*100).toFixed(1) });
        }
        c.delete();
      }
    } finally {
      src.delete(); if(gray)gray.delete(); if(blurred)blurred.delete(); if(binary)binary.delete();
      if(eroded)eroded.delete(); if(kernel)kernel.delete(); if(contours)contours.delete(); if(hier)hier.delete();
    }
    console.log(`${name}: ${blobs.map(b=>`ratio=${b.ratio}(${b.areaPct}%)`).join('  ')}`);
  }
  process.exit(0);
};
setTimeout(() => { process.exit(1); }, 120000);
