const fs = require("fs"), path = require("path"), jpeg = require("jpeg-js"), cv = require("@techstark/opencv-js");
const DIR = __dirname;
cv.onRuntimeInitialized = () => {
  for (const name of ["464","465","466","467","468","469"]) {
    const raw = jpeg.decode(fs.readFileSync(path.join(DIR, "photos", `${name}.jpg`)), { useTArray: true });
    // Scale to 800px wide
    const scale = 800 / raw.width;
    const W = 800, H = Math.round(raw.height * scale);
    const src = cv.matFromImageData({ data: new Uint8ClampedArray(raw.data), width: raw.width, height: raw.height });
    const small = new cv.Mat(); cv.resize(src, small, new cv.Size(W, H));
    const d = new Uint8Array(small.data.buffer, small.data.byteOffset, H*W*4);
    const buf = jpeg.encode({data:Buffer.from(d),width:W,height:H}, 80);
    fs.writeFileSync(path.join(DIR, `orig_${name}.jpg`), buf.data);
    src.delete(); small.delete();
    console.log(`Saved orig_${name}.jpg`);
  }
  process.exit(0);
};
cv.onRuntimeInitialized();
setTimeout(()=>process.exit(1),30000);
