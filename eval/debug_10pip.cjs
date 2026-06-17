// Debug 10-pip half of photo 470 to understand why big-blob estimation overcounts
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

  const raw = jpeg.decode(fs.readFileSync(path.join(DIR, "photos", "470.jpg")), { useTArray: true });
  D._test.stretchGray(raw.data);
  const src = cv.matFromImageData({ data: new Uint8ClampedArray(raw.data), width: raw.width, height: raw.height });
  const tiles = D._test.findTiles(src, 0.02, 0.70, 0.03);
  console.log(`470: found ${tiles.length} tiles`);

  for (let ti = 0; ti < tiles.length; ti++) {
    const t = tiles[ti];
    const pts = t.pts;
    const cx = (pts[0].x+pts[1].x+pts[2].x+pts[3].x)/4;
    const cy = (pts[0].y+pts[1].y+pts[2].y+pts[3].y)/4;
    const d01=Math.hypot(pts[1].x-pts[0].x,pts[1].y-pts[0].y);
    const d03=Math.hypot(pts[3].x-pts[0].x,pts[3].y-pts[0].y);
    let angle=d01>=d03?Math.atan2(pts[1].y-pts[0].y,pts[1].x-pts[0].x)*180/Math.PI:Math.atan2(pts[3].y-pts[0].y,pts[3].x-pts[0].x)*180/Math.PI;
    const tileW=Math.max(d01,d03),tileH=Math.min(d01,d03);
    while(angle>90)angle-=180; while(angle<=-90)angle+=180;
    const pad=0.08,outW=Math.round(tileW*(1+2*pad)),outH=Math.round(tileH*(1+2*pad));
    const M=cv.getRotationMatrix2D(new cv.Point(cx,cy),angle,1.0);
    const rotated=new cv.Mat();
    cv.warpAffine(src,rotated,M,new cv.Size(src.cols,src.rows),cv.INTER_LINEAR,cv.BORDER_REPLICATE);
    const x=Math.max(0,Math.round(cx-outW/2)),y=Math.max(0,Math.round(cy-outH/2));
    const w=Math.min(src.cols-x,outW),h=Math.min(src.rows-y,outH);
    const cropped=rotated.roi(new cv.Rect(x,y,w,h));
    const mid=Math.floor(cropped.cols/2);

    for (const [halfLabel, halfRoi] of [["LEFT", cropped.roi(new cv.Rect(0,0,mid,cropped.rows))],["RIGHT", cropped.roi(new cv.Rect(mid,0,cropped.cols-mid,cropped.rows))]]) {
      const padP=Math.max(2,Math.floor(Math.min(halfRoi.rows,halfRoi.cols)*0.05));
      const rw=halfRoi.cols-2*padP,rh=halfRoi.rows-2*padP;
      const inner=halfRoi.roi(new cv.Rect(padP,padP,rw,rh));
      const regionArea=rw*rh,minPip=regionArea*0.002,maxPip=regionArea*0.10;
      const gray=new cv.Mat(),thresh=new cv.Mat(),conts=new cv.MatVector(),hier=new cv.Mat();
      cv.cvtColor(inner,gray,cv.COLOR_RGBA2GRAY);
      cv.threshold(gray,thresh,0,255,cv.THRESH_BINARY_INV+cv.THRESH_OTSU);
      cv.findContours(thresh,conts,hier,cv.RETR_EXTERNAL,cv.CHAIN_APPROX_SIMPLE);
      const pipAreas=[],bigBlobs=[];
      let accepted=0;
      console.log(`\nTile ${ti} ${halfLabel} (${rw}×${rh}=regionArea ${regionArea}, minPip=${minPip.toFixed(0)} maxPip=${maxPip.toFixed(0)})`);
      for (let i=0;i<conts.size();i++) {
        const c=conts.get(i);
        const area=cv.contourArea(c);
        const peri=cv.arcLength(c,true);
        c.delete();
        const circ=peri>0?(4*Math.PI*area)/(peri*peri):0;
        if(area>=minPip&&area<=maxPip&&circ>=0.45){pipAreas.push(area);accepted++;}
        else if(area>=minPip&&area<=maxPip*8&&circ<0.45){bigBlobs.push(area);}
        if(area>=minPip*0.5)console.log(`  area=${area.toFixed(0)} circ=${circ.toFixed(2)} ${area<minPip?"SMALL":area>maxPip*8?"HUGE":circ>=0.45?"✓":"bigblob"}`);
      }
      const pipArea=pipAreas.length?pipAreas.reduce((a,b)=>a+b,0)/pipAreas.length:maxPip*0.25;
      let count=pipAreas.length;
      if(pipAreas.length>=8)for(const ba of bigBlobs)if(ba>=pipArea*2.5)count+=Math.round(ba/pipArea);
      console.log(`  → accepted=${accepted} bigBlobs=${bigBlobs.map(b=>b.toFixed(0)).join(',')||'none'} pipArea=${pipArea.toFixed(0)} count=${count}`);
      gray.delete();thresh.delete();conts.delete();hier.delete();inner.delete();halfRoi.delete();
    }
    cropped.delete();rotated.delete();M.delete();
  }
  src.delete();
  process.exit(0);
};
setTimeout(()=>{console.log("TIMEOUT");process.exit(1);},120000);
