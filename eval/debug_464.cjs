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

  for (const name of ["464","465","466"]) {
    const raw = jpeg.decode(fs.readFileSync(path.join(DIR, "photos", `${name}.jpg`)), { useTArray: true });
    D._test.stretchGray(raw.data);
    const src = cv.matFromImageData({ data: new Uint8ClampedArray(raw.data), width: raw.width, height: raw.height });
    let gray=new cv.Mat(),blurred=new cv.Mat(),binary=new cv.Mat(),eroded=new cv.Mat(),kernel=null,conts=new cv.MatVector(),hier=new cv.Mat();
    cv.cvtColor(src,gray,cv.COLOR_RGBA2GRAY);
    cv.GaussianBlur(gray,blurred,new cv.Size(5,5),0);
    cv.threshold(blurred,binary,0,255,cv.THRESH_BINARY+cv.THRESH_OTSU);
    const kSize=Math.max(3,Math.round(Math.min(src.cols,src.rows)*0.01));
    kernel=cv.Mat.ones(kSize,kSize,cv.CV_8U); cv.erode(binary,eroded,kernel);
    cv.findContours(eroded,conts,hier,cv.RETR_EXTERNAL,cv.CHAIN_APPROX_SIMPLE);
    const frameArea=src.cols*src.rows, minArea=frameArea*0.02, maxArea=frameArea*0.70;
    console.log(`\n=== ${name}: frame=${src.cols}×${src.rows} minArea=${minArea.toFixed(0)} ===`);
    const blobs=[];
    for (let i=0;i<conts.size();i++) {
      const c=conts.get(i); const area=cv.contourArea(c);
      if (area>80000) { const rect=cv.minAreaRect(c); const rw=rect.size.width,rh=rect.size.height; const ratio=Math.max(rw,rh)/Math.min(rw,rh); blobs.push({area,rw,rh,ratio}); }
      c.delete();
    }
    blobs.sort((a,b)=>b.area-a.area);
    for (const v of blobs) {
      const areaOk=v.area>=minArea&&v.area<=maxArea;
      const ratioOk=v.ratio>=1.5&&v.ratio<=3.0;
      console.log(`  ${areaOk&&ratioOk?"✓":areaOk?"RATIO_FAIL":ratioOk?"AREA_FAIL":"BOTH_FAIL"} area=${v.area.toFixed(0)} ratio=${v.ratio.toFixed(2)} (${v.rw.toFixed(0)}×${v.rh.toFixed(0)})`);
    }
    gray.delete();blurred.delete();binary.delete();eroded.delete();kernel.delete();conts.delete();hier.delete();src.delete();
  }
  process.exit(0);
};
setTimeout(()=>{console.log("TIMEOUT");process.exit(1);},120000);
