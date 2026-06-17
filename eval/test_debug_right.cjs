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
  let found = D._test.findTiles(src, 0.02, 0.70, 0.03);
  // Sort same as scanMat
  found.sort((a,b)=>Math.abs(a.cy-b.cy)>60?a.cy-b.cy:a.cx-b.cx);
  console.log(`Tiles: ${found.length}, sorted cy: ${found.map(t=>t.cy.toFixed(0)).join(", ")}`);
  
  // Analyze tile 0 (the one that reads 5|9)
  const pts = found[0].pts;
  const cx = (pts[0].x+pts[1].x+pts[2].x+pts[3].x)/4, cy = (pts[0].y+pts[1].y+pts[2].y+pts[3].y)/4;
  const d01=Math.hypot(pts[1].x-pts[0].x,pts[1].y-pts[0].y), d03=Math.hypot(pts[3].x-pts[0].x,pts[3].y-pts[0].y);
  let angle, tileW, tileH;
  if(d01>=d03){angle=Math.atan2(pts[1].y-pts[0].y,pts[1].x-pts[0].x)*180/Math.PI;tileW=d01;tileH=d03;}
  else{angle=Math.atan2(pts[3].y-pts[0].y,pts[3].x-pts[0].x)*180/Math.PI;tileW=d03;tileH=d01;}
  while(angle>90)angle-=180;while(angle<=-90)angle+=180;
  const pad=0.08,outW=Math.round(tileW*(1+2*pad)),outH=Math.round(tileH*(1+2*pad));
  const M=cv.getRotationMatrix2D(new cv.Point(cx,cy),angle,1.0);
  const rotated=new cv.Mat();
  cv.warpAffine(src,rotated,M,new cv.Size(src.cols,src.rows),cv.INTER_LINEAR,cv.BORDER_REPLICATE);
  const x=Math.max(0,Math.round(cx-outW/2)),y=Math.max(0,Math.round(cy-outH/2));
  const w=Math.min(src.cols-x,outW),h=Math.min(src.rows-y,outH);
  const croppedRoi=rotated.roi(new cv.Rect(x,y,w,h));
  const cropped=new cv.Mat();croppedRoi.copyTo(cropped);croppedRoi.delete();
  const mid=Math.floor(cropped.cols/2);
  console.log(`Tile0: ${w}x${h}, angle=${angle.toFixed(1)}, mid=${mid}`);
  
  // Save both halves
  const saveJpeg=(mat,name)=>{
    const d=new Uint8Array(mat.data.buffer,mat.data.byteOffset,mat.rows*mat.cols*4);
    const buf=jpeg.encode({data:Buffer.from(d),width:mat.cols,height:mat.rows},85);
    fs.writeFileSync(path.join(DIR,name),buf.data);
  };
  
  const halfARoi=cropped.roi(new cv.Rect(0,0,mid,cropped.rows));
  const halfBRoi=cropped.roi(new cv.Rect(mid,0,cropped.cols-mid,cropped.rows));
  const halfA=new cv.Mat();halfARoi.copyTo(halfA);halfARoi.delete();
  const halfB=new cv.Mat();halfBRoi.copyTo(halfB);halfBRoi.delete();
  
  saveJpeg(cropped,"tile0_467_full.jpg");
  saveJpeg(halfA,"tile0_467_left.jpg");
  saveJpeg(halfB,"tile0_467_right.jpg");
  console.log(`Saved tile0 halves: left=${halfA.cols}x${halfA.rows}, right=${halfB.cols}x${halfB.rows}`);
  
  src.delete();M.delete();rotated.delete();cropped.delete();halfA.delete();halfB.delete();
  process.exit(0);
};
setTimeout(()=>{process.exit(1);},120000);
