const fs = require("fs"), path = require("path"), jpeg = require("jpeg-js"), cv = require("@techstark/opencv-js");
const DIR = __dirname;
cv.onRuntimeInitialized = () => {
  global.cv = cv; global.window = {};
  global.document = { createElement: () => ({ getContext: () => ({}), toDataURL: () => "" }) };
  new Function(fs.readFileSync(path.join(DIR, "..", "detect.js"), "utf8"))();
  const D = global.window.DominoCV;
  
  const raw = jpeg.decode(fs.readFileSync(path.join(DIR, "photos", "467.jpg")), { useTArray: true });
  D._test.stretchGray(raw.data);
  const src = cv.matFromImageData({ data: new Uint8ClampedArray(raw.data), width: raw.width, height: raw.height });
  
  // Get the found tiles then save each crop
  const found = D._test.findTiles(src, 0.02, 0.70, 0.03);
  console.log(`Found ${found.length} tiles`);
  found.forEach((t, i) => {
    // Do cropRotate but save the full crop before splitting
    const pts = t.pts;
    const cx = (pts[0].x+pts[1].x+pts[2].x+pts[3].x)/4;
    const cy = (pts[0].y+pts[1].y+pts[2].y+pts[3].y)/4;
    const d01 = Math.hypot(pts[1].x-pts[0].x, pts[1].y-pts[0].y);
    const d03 = Math.hypot(pts[3].x-pts[0].x, pts[3].y-pts[0].y);
    let angle, tileW, tileH;
    if (d01 >= d03) {
      angle = Math.atan2(pts[1].y-pts[0].y, pts[1].x-pts[0].x)*180/Math.PI;
      tileW = d01; tileH = d03;
    } else {
      angle = Math.atan2(pts[3].y-pts[0].y, pts[3].x-pts[0].x)*180/Math.PI;
      tileW = d03; tileH = d01;
    }
    while (angle > 90) angle -= 180;
    while (angle <= -90) angle += 180;
    const pad = 0.08;
    const outW = Math.round(tileW*(1+2*pad)), outH = Math.round(tileH*(1+2*pad));
    const M = cv.getRotationMatrix2D(new cv.Point(cx,cy), angle, 1.0);
    const rotated = new cv.Mat();
    cv.warpAffine(src, rotated, M, new cv.Size(src.cols, src.rows), cv.INTER_LINEAR, cv.BORDER_REPLICATE);
    const x = Math.max(0, Math.round(cx-outW/2));
    const y = Math.max(0, Math.round(cy-outH/2));
    const w = Math.min(src.cols-x, outW), h = Math.min(src.rows-y, outH);
    const cropped = rotated.roi(new cv.Rect(x,y,w,h));
    
    console.log(`Tile ${i}: size=${w}x${h} ratio=${(Math.max(w,h)/Math.min(w,h)).toFixed(2)} angle=${angle.toFixed(1)}`);
    
    // Save as JPEG
    const vec = new cv.MatVector(); vec.push_back(cropped);
    const buf = new Uint8Array(cv.imencode('.jpg', cropped).data);
    fs.writeFileSync(path.join(DIR, `crop_467_${i}.jpg`), Buffer.from(buf));
    
    M.delete(); cropped.delete(); rotated.delete(); vec.delete();
  });
  src.delete();
  console.log("Saved crops to eval/crop_467_*.jpg");
  process.exit(0);
};
setTimeout(() => { process.exit(1); }, 120000);
