const fs=require('fs'),path=require('path'),jpeg=require('jpeg-js'),cv=require('@techstark/opencv-js');
const FRAMES_DIR=path.join(__dirname,'sessions/current/photos');
const frames=fs.readdirSync(FRAMES_DIR).filter(f=>f.endsWith('.jpg')).sort();
cv.onRuntimeInitialized=()=>{
  global.cv=cv;global.window={};global.document={createElement:()=>({getContext:()=>({}),toDataURL:()=>''})};
  new Function(fs.readFileSync(path.join(__dirname,'..','detect.js'),'utf8'))();
  for (const fname of frames) {
    const raw=jpeg.decode(fs.readFileSync(path.join(FRAMES_DIR,fname)),{useTArray:true});
    const D=global.window.DominoCV;
    D._test.stretchGray(raw.data);
    const src=cv.matFromImageData({data:new Uint8ClampedArray(raw.data),width:raw.width,height:raw.height});
    const scale=Math.min(1,1200/Math.max(src.cols,src.rows));
    let work=null,gray=null,blur=null,edges=null,dil=null,kern=null,conts=null,hier=null;
    const out=[];
    try {
      if(scale<1){work=new cv.Mat();cv.resize(src,work,new cv.Size(Math.round(src.cols*scale),Math.round(src.rows*scale)));}else work=src;
      gray=new cv.Mat();cv.cvtColor(work,gray,cv.COLOR_RGBA2GRAY);
      blur=new cv.Mat();cv.GaussianBlur(gray,blur,new cv.Size(5,5),0);
      edges=new cv.Mat();cv.Canny(blur,edges,30,90);
      const dk=(Math.max(5,Math.round(Math.min(work.cols,work.rows)*0.012))|1);
      kern=cv.getStructuringElement(cv.MORPH_RECT,new cv.Size(dk,dk));
      dil=new cv.Mat();cv.dilate(edges,dil,kern);
      conts=new cv.MatVector();hier=new cv.Mat();
      cv.findContours(dil,conts,hier,cv.RETR_EXTERNAL,cv.CHAIN_APPROX_SIMPLE);
      const fa=work.cols*work.rows,minArea=fa*0.015,maxArea=fa*0.70;
      console.log(`\n── ${fname} ${src.cols}x${src.rows} dk=${dk} canny_conts=${conts.size()}`);
      for(let i=0;i<conts.size();i++){
        const c=conts.get(i);const area=cv.contourArea(c);
        if(area<minArea||area>maxArea){c.delete();continue;}
        const rect=cv.minAreaRect(c);c.delete();
        const rw=rect.size.width,rh=rect.size.height;
        const L=Math.max(rw,rh),S=Math.min(rw,rh);
        const ratio=L/Math.max(1,S),fill=area/(rw*rh);
        const angLong=(rw>=rh?rect.angle:rect.angle+90)*Math.PI/180;
        const lx=Math.cos(angLong),ly=Math.sin(angLong),sx=-ly,sy=lx;
        const cx=rect.center.x,cy=rect.center.y,hl=L/2,hs=S/2;
        const step=Math.max(3,L/16);
        let tSum=0,tN=0,mSum=0,mN=0;
        for(let a=-hl*0.85;a<=hl*0.85;a+=step)for(let b=-hs*0.85;b<=hs*0.85;b+=step){
          const xx=Math.round(cx+a*lx+b*sx),yy=Math.round(cy+a*ly+b*sy);
          if(xx<0||xx>=work.cols||yy<0||yy>=work.rows)continue;
          const v=gray.ucharPtr(yy,xx)[0];tSum+=v;tN++;
          if(Math.abs(a)<=hl*0.1){mSum+=v;mN++;}
        }
        const tileMean=tN?tSum/tN:0,midMean=mN?mSum/mN:tileMean,diff=tileMean-midMean;
        const pR=ratio>=1.3&&ratio<=3.0,pF=fill>=0.5,pT=tileMean>=130,pD=diff>=15;
        const tag=pR&&pF&&pT&&pD?'✓PASS':'✗ r:'+(pR?'ok':'FAIL')+' f:'+(pF?'ok':'FAIL')+' t:'+(pT?'ok':'FAIL')+' d:'+(pD?'ok':'FAIL');
        console.log(`  L=${Math.round(L)} S=${Math.round(S)} r=${ratio.toFixed(1)} fill=${fill.toFixed(2)} cx=${Math.round(cx)} cy=${Math.round(cy)} tile=${tileMean.toFixed(0)} mid=${midMean.toFixed(0)} diff=${diff.toFixed(0)} ${tag}`);
      }
    } finally {
      if(work&&work!==src)work.delete();if(gray)gray.delete();if(blur)blur.delete();if(edges)edges.delete();if(dil)dil.delete();if(kern)kern.delete();if(conts)conts.delete();if(hier)hier.delete();
      src.delete();
    }
  }
  process.exit(0);
};
setTimeout(()=>process.exit(1),120000);
