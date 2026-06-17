// Show what tiles are found and their aspect ratios for photos 464-466,470
const fs = require("fs");
const path = require("path");
const jpeg = require("jpeg-js");
const cv = require("@techstark/opencv-js");
const DIR = __dirname;

cv.onRuntimeInitialized = () => {
  global.cv = cv; global.window = {};
  global.document = { createElement: () => ({ getContext: () => ({}), toDataURL: () => "" }) };
  new Function(fs.readFileSync(path.join(DIR, "..", "detect.js"), "utf8"))();
  const D = global.window.DominoCV;

  for (const [name, expCount] of [["464",3],["465",4],["466",3],["470",2]]) {
    const raw = jpeg.decode(fs.readFileSync(path.join(DIR, "photos", `${name}.jpg`)), { useTArray: true });
    D._test.stretchGray(raw.data);
    const src = cv.matFromImageData({ data: new Uint8ClampedArray(raw.data), width: raw.width, height: raw.height });

    // Replicate findTiles internals to print all contours
    let gray=null,blurred=null,binary=null,eroded=null,kernel=null,conts=null,hier=null;
    gray=new cv.Mat(); cv.cvtColor(src,gray,cv.COLOR_RGBA2GRAY);
    blurred=new cv.Mat(); cv.GaussianBlur(gray,blurred,new cv.Size(5,5),0);
    binary=new cv.Mat(); cv.threshold(blurred,binary,0,255,cv.THRESH_BINARY+cv.THRESH_OTSU);
    const kSize=Math.max(3,Math.round(Math.min(src.cols,src.rows)*0.01));
    kernel=cv.Mat.ones(kSize,kSize,cv.CV_8U); eroded=new cv.Mat();
    cv.erode(binary,eroded,kernel);
    conts=new cv.MatVector(); hier=new cv.Mat();
    cv.findContours(eroded,conts,hier,cv.RETR_EXTERNAL,cv.CHAIN_APPROX_SIMPLE);
    const frameArea=src.cols*src.rows;
    const minArea=frameArea*0.02, maxArea=frameArea*0.70;

    console.log(`\n=== Photo ${name} (expected ${expCount} tiles) ${src.cols}×${src.rows} ===`);
    console.log(`kSize=${kSize}, minArea=${minArea.toFixed(0)}, maxArea=${maxArea.toFixed(0)}`);
    console.log(`Found ${conts.size()} contours total`);
    const valid = [];
    for (let i=0;i<conts.size();i++) {
      const c=conts.get(i); const area=cv.contourArea(c);
      if (area>=minArea && area<=maxArea) {
        const rect=cv.minAreaRect(c); const rw=rect.size.width,rh=rect.size.height;
        const ratio=Math.max(rw,rh)/Math.min(rw,rh);
        valid.push({area,rw,rh,ratio});
      }
      c.delete();
    }
    valid.sort((a,b)=>b.area-a.area);
    for (const v of valid) {
      const pass=v.ratio>=1.5&&v.ratio<=3.0;
      console.log(`  ${pass?"✓":"✗"} area=${v.area.toFixed(0)} ratio=${v.ratio.toFixed(2)} (${v.rw.toFixed(0)}×${v.rh.toFixed(0)})`);
    }

    gray.delete();blurred.delete();binary.delete();eroded.delete();kernel.delete();conts.delete();hier.delete();src.delete();
  }
  process.exit(0);
};
setTimeout(()=>{console.log("TIMEOUT");process.exit(1);},120000);
