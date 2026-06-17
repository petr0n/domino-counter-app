const fs = require("fs"), path = require("path"), jpeg = require("jpeg-js"), cv = require("@techstark/opencv-js");
const DIR = __dirname;
const FIX = { "464":1, "465":1, "466":1, "467":1, "468":1, "469":1, "470":1, "471":1 };
cv.onRuntimeInitialized = () => {
  global.cv = cv; global.window = {};
  global.document = { createElement: () => ({ getContext: () => ({}), toDataURL: () => "" }) };
  new Function(fs.readFileSync(path.join(DIR, "..", "detect.js"), "utf8"))();
  const D = global.window.DominoCV;

  const saveJpeg = (mat, p) => {
    const m = new cv.Mat(); mat.copyTo(m);
    const d = new Uint8Array(m.data.buffer, m.data.byteOffset, m.rows*m.cols*4);
    const buf = jpeg.encode({data:Buffer.from(d),width:m.cols,height:m.rows},75);
    fs.writeFileSync(p, buf.data); m.delete();
  };

  for (const name of Object.keys(FIX)) {
    const raw = jpeg.decode(fs.readFileSync(path.join(DIR, "photos", `${name}.jpg`)), { useTArray: true });
    D._test.stretchGray(raw.data);
    const src = cv.matFromImageData({ data: new Uint8ClampedArray(raw.data), width: raw.width, height: raw.height });
    let found = D._test.findTiles(src, 0.02, 0.70, 0.03);
    found.sort((a,b)=>Math.abs(a.cy-b.cy)>60?a.cy-b.cy:a.cx-b.cx);
    
    found.forEach((t, i) => {
      const pts=t.pts;
      const cx=(pts[0].x+pts[1].x+pts[2].x+pts[3].x)/4, cy=(pts[0].y+pts[1].y+pts[2].y+pts[3].y)/4;
      const d01=Math.hypot(pts[1].x-pts[0].x,pts[1].y-pts[0].y), d03=Math.hypot(pts[3].x-pts[0].x,pts[3].y-pts[0].y);
      let angle, tileW, tileH;
      if(d01>=d03){angle=Math.atan2(pts[1].y-pts[0].y,pts[1].x-pts[0].x)*180/Math.PI;tileW=d01;tileH=d03;}
      else{angle=Math.atan2(pts[3].y-pts[0].y,pts[3].x-pts[0].x)*180/Math.PI;tileW=d03;tileH=d01;}
      while(angle>90)angle-=180;while(angle<=-90)angle+=180;
      const p=0.04,oW=Math.round(tileW*(1+2*p)),oH=Math.round(tileH*(1+2*p));
      const M=cv.getRotationMatrix2D(new cv.Point(cx,cy),angle,1.0);
      const rot=new cv.Mat();
      cv.warpAffine(src,rot,M,new cv.Size(src.cols,src.rows),cv.INTER_LINEAR,cv.BORDER_REPLICATE);
      const x=Math.max(0,Math.round(cx-oW/2)),y=Math.max(0,Math.round(cy-oH/2));
      const w=Math.min(src.cols-x,oW),h=Math.min(src.rows-y,oH);
      if(w>20&&h>20) {
        const roi=rot.roi(new cv.Rect(x,y,w,h));
        saveJpeg(roi, path.join(DIR, `ref_${name}_tile${i}.jpg`));
        roi.delete();
      }
      M.delete(); rot.delete();
    });
    src.delete();
    console.log(`${name}: ${found.length} tiles`);
  }
  process.exit(0);
};
setTimeout(()=>{process.exit(1);},120000);
