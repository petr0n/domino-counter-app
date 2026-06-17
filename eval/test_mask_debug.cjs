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
  const found = D._test.findTiles(src, 0.02, 0.70, 0.03);
  
  // Get tile 0 crop
  const pts = found[0].pts;
  const cx = (pts[0].x+pts[1].x+pts[2].x+pts[3].x)/4, cy = (pts[0].y+pts[1].y+pts[2].y+pts[3].y)/4;
  const d01 = Math.hypot(pts[1].x-pts[0].x,pts[1].y-pts[0].y), d03 = Math.hypot(pts[3].x-pts[0].x,pts[3].y-pts[0].y);
  let angle, tileW, tileH;
  if (d01>=d03) { angle=Math.atan2(pts[1].y-pts[0].y,pts[1].x-pts[0].x)*180/Math.PI; tileW=d01;tileH=d03; }
  else { angle=Math.atan2(pts[3].y-pts[0].y,pts[3].x-pts[0].x)*180/Math.PI; tileW=d03;tileH=d01; }
  while(angle>90)angle-=180; while(angle<=-90)angle+=180;
  const pad=0.08, outW=Math.round(tileW*(1+2*pad)), outH=Math.round(tileH*(1+2*pad));
  const M=cv.getRotationMatrix2D(new cv.Point(cx,cy),angle,1.0);
  const rotated=new cv.Mat();
  cv.warpAffine(src,rotated,M,new cv.Size(src.cols,src.rows),cv.INTER_LINEAR,cv.BORDER_REPLICATE);
  const x=Math.max(0,Math.round(cx-outW/2)), y=Math.max(0,Math.round(cy-outH/2));
  const w=Math.min(src.cols-x,outW), h=Math.min(src.rows-y,outH);
  const croppedRoi=rotated.roi(new cv.Rect(x,y,w,h));
  const cropped=new cv.Mat(); croppedRoi.copyTo(cropped); croppedRoi.delete();
  const mid=Math.floor(cropped.cols/2);
  
  // Analyze right half (1-pip side, reads 9)
  const halfBRoi=cropped.roi(new cv.Rect(mid,0,cropped.cols-mid,cropped.rows));
  const halfB=new cv.Mat(); halfBRoi.copyTo(halfB); halfBRoi.delete();
  
  const ppPad = Math.max(2, Math.floor(Math.min(halfB.rows,halfB.cols)*0.05));
  const rw=halfB.cols-2*ppPad, rh=halfB.rows-2*ppPad;
  const innerRoi=halfB.roi(new cv.Rect(ppPad,ppPad,rw,rh));
  const inner=new cv.Mat(); innerRoi.copyTo(inner); innerRoi.delete();
  
  const gray=new cv.Mat(); cv.cvtColor(inner,gray,cv.COLOR_RGBA2GRAY);
  
  // Check pixel statistics
  const mean=new cv.Mat(), stddev=new cv.Mat();
  cv.meanStdDev(gray, mean, stddev);
  console.log(`Right half ${halfB.cols}x${halfB.rows}, inner ${rw}x${rh}`);
  console.log(`  Gray mean=${mean.doubleAt(0,0).toFixed(1)} std=${stddev.doubleAt(0,0).toFixed(1)}`);
  
  // Try Otsu to see what threshold it picks
  const thresh=new cv.Mat();
  const otsuVal=cv.threshold(gray,thresh,0,255,cv.THRESH_BINARY_INV+cv.THRESH_OTSU);
  console.log(`  Otsu threshold value: ${otsuVal}`);
  
  // Count what's detected
  const conts=new cv.MatVector(), hierP=new cv.Mat();
  cv.findContours(thresh,conts,hierP,cv.RETR_EXTERNAL,cv.CHAIN_APPROX_SIMPLE);
  const regionArea=rw*rh, minPip=regionArea*0.002, maxPip=regionArea*0.10;
  let count=0;
  for(let i=0;i<conts.size();i++) {
    const c=conts.get(i); const area=cv.contourArea(c);
    const peri=cv.arcLength(c,true); c.delete();
    const circ=peri>0?(4*Math.PI*area)/(peri*peri):0;
    const ok=area>=minPip&&area<=maxPip&&circ>=0.45;
    if(ok) count++;
    console.log(`  contour a=${area.toFixed(0)} circ=${circ.toFixed(2)} ${ok?'✓':'✗'}`);
  }
  console.log(`  Total valid: ${count}`);
  
  // Also check what the tile mask looks like
  const tileMask=new cv.Mat();
  cv.threshold(gray,tileMask,60,255,cv.THRESH_BINARY);
  const maskedPixels=cv.countNonZero(tileMask);
  const bgPixels=rw*rh-maskedPixels;
  console.log(`  Tile mask at 60: ${maskedPixels} tile, ${bgPixels} background`);
  
  src.delete();M.delete();rotated.delete();cropped.delete();halfB.delete();inner.delete();
  gray.delete();mean.delete();stddev.delete();thresh.delete();conts.delete();hierP.delete();tileMask.delete();
  process.exit(0);
};
setTimeout(()=>{process.exit(1);},120000);
