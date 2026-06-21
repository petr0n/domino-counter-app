// Trace pixel values along the midline of each edgeScan candidate
const fs=require('fs'),path=require('path'),jpeg=require('jpeg-js'),cv=require('@techstark/opencv-js');
const FRAMES_DIR=path.join(__dirname,'sessions/current/photos');
const frames=fs.readdirSync(FRAMES_DIR).filter(f=>f.endsWith('.jpg')).sort();
cv.onRuntimeInitialized=()=>{
  global.cv=cv;global.window={};global.document={createElement:()=>({getContext:()=>({}),toDataURL:()=>''})};
  new Function(fs.readFileSync(path.join(__dirname,'..','detect.js'),'utf8'))();
  const D=global.window.DominoCV;
  // Only trace frame_771511 (the interesting teal one)
  const fname=frames.find(f=>f.includes('771511'));
  if(!fname){console.log('frame not found');process.exit(1);}
  const raw=jpeg.decode(fs.readFileSync(path.join(FRAMES_DIR,fname)),{useTArray:true});
  D._test.stretchGray(raw.data);
  const src=cv.matFromImageData({data:new Uint8ClampedArray(raw.data),width:raw.width,height:raw.height});
  let work=null,gray=null,blur=null,edges=null,dil=null,kern=null,conts=null,hier=null;
  try {
    work=src; // no scale needed (806 < 1200)
    gray=new cv.Mat();cv.cvtColor(work,gray,cv.COLOR_RGBA2GRAY);
    blur=new cv.Mat();cv.GaussianBlur(gray,blur,new cv.Size(5,5),0);
    edges=new cv.Mat();cv.Canny(blur,edges,30,90);
    const dk=(Math.max(5,Math.round(Math.min(work.cols,work.rows)*0.012))|1);
    kern=cv.getStructuringElement(cv.MORPH_RECT,new cv.Size(dk,dk));
    dil=new cv.Mat();cv.dilate(edges,dil,kern);
    conts=new cv.MatVector();hier=new cv.Mat();
    cv.findContours(dil,conts,hier,cv.RETR_EXTERNAL,cv.CHAIN_APPROX_SIMPLE);
    const fa=work.cols*work.rows,minArea=fa*0.015,maxArea=fa*0.70;
    for(let i=0;i<conts.size();i++){
      const c=conts.get(i);const area=cv.contourArea(c);
      if(area<minArea||area>maxArea){c.delete();continue;}
      const rect=cv.minAreaRect(c);c.delete();
      const rw=rect.size.width,rh=rect.size.height;
      const L=Math.max(rw,rh),S=Math.min(rw,rh);
      const ratio=L/Math.max(1,S);
      if(ratio<1.3||ratio>3.0)continue;
      if(area/(rw*rh)<0.5)continue;
      const angLong=(rw>=rh?rect.angle:rect.angle+90)*Math.PI/180;
      const lx=Math.cos(angLong),ly=Math.sin(angLong);
      const sx=-ly,sy=lx;
      const cx=rect.center.x,cy=rect.center.y;
      const hl=L/2,hs=S/2;
      console.log(`\nCandidate L=${Math.round(L)} S=${Math.round(S)} cx=${Math.round(cx)} cy=${Math.round(cy)} angle=${rect.angle.toFixed(1)} rw=${Math.round(rw)} rh=${Math.round(rh)}`);
      console.log(`  longAxis=(${lx.toFixed(2)},${ly.toFixed(2)}) shortAxis=(${sx.toFixed(2)},${sy.toFixed(2)}) hl=${hl.toFixed(0)} hs=${hs.toFixed(0)}`);
      // Dense midline scan: a=0, b varies
      const bStep=Math.max(2,Math.round(S/20));
      const midVals=[];
      for(let b=-hs*0.8;b<=hs*0.8;b+=bStep){
        const xx=Math.round(cx+b*sx),yy=Math.round(cy+b*sy);
        if(xx<0||xx>=work.cols||yy<0||yy>=work.rows)continue;
        midVals.push(gray.ucharPtr(yy,xx)[0]);
      }
      console.log(`  midline a=0 (${midVals.length} samples): min=${Math.min(...midVals)} max=${Math.max(...midVals)} mean=${(midVals.reduce((a,b)=>a+b,0)/midVals.length).toFixed(0)}`);
      console.log(`  values: [${midVals.slice(0,20).join(',')}]`);
      // Also scan at a=hl/2 (quarter of long axis) for comparison
      const quarterVals=[];
      for(let b=-hs*0.8;b<=hs*0.8;b+=bStep){
        const xx=Math.round(cx+(hl/2)*lx+b*sx),yy=Math.round(cy+(hl/2)*ly+b*sy);
        if(xx<0||xx>=work.cols||yy<0||yy>=work.rows)continue;
        quarterVals.push(gray.ucharPtr(yy,xx)[0]);
      }
      console.log(`  quarter a=hl/2: min=${Math.min(...quarterVals)} mean=${(quarterVals.reduce((a,b)=>a+b,0)/quarterVals.length).toFixed(0)} values: [${quarterVals.slice(0,20).join(',')}]`);
    }
  } finally {
    if(gray)gray.delete();if(blur)blur.delete();if(edges)edges.delete();if(dil)dil.delete();if(kern)kern.delete();if(conts)conts.delete();if(hier)hier.delete();
    src.delete();
  }
  process.exit(0);
};
setTimeout(()=>process.exit(1),120000);
