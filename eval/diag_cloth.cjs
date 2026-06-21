// Quick diagnostic for detect_cloth_4.jpg dividerScan bars
const fs=require('fs'),path=require('path'),jpeg=require('jpeg-js'),cv=require('@techstark/opencv-js');
cv.onRuntimeInitialized=()=>{
  global.cv=cv;global.window={};global.document={createElement:()=>({getContext:()=>({}),toDataURL:()=>''})};
  new Function(fs.readFileSync(path.join(__dirname,'..','detect.js'),'utf8'))();
  const D=global.window.DominoCV;
  const raw=jpeg.decode(fs.readFileSync(path.join(__dirname,'detect_cloth_4.jpg')),{useTArray:true});
  D._test.stretchGray(raw.data);
  const src=cv.matFromImageData({data:new Uint8ClampedArray(raw.data),width:raw.width,height:raw.height});
  const scale=Math.min(1,1200/Math.max(src.cols,src.rows));
  const work=scale<1?(()=>{const w=new cv.Mat();cv.resize(src,w,new cv.Size(Math.round(src.cols*scale),Math.round(src.rows*scale)));return w;})():src;
  const g=new cv.Mat();cv.cvtColor(work,g,cv.COLOR_RGBA2GRAY);
  const ks=(Math.round(Math.min(work.cols,work.rows)*0.045)|1);
  const k=cv.getStructuringElement(cv.MORPH_ELLIPSE,new cv.Size(ks,ks));
  const bh=new cv.Mat();cv.morphologyEx(g,bh,cv.MORPH_BLACKHAT,k);
  const bin=new cv.Mat();cv.threshold(bh,bin,0,255,cv.THRESH_BINARY+cv.THRESH_OTSU);
  const co=new cv.MatVector(),h=new cv.Mat();
  cv.findContours(bin,co,h,cv.RETR_EXTERNAL,cv.CHAIN_APPROX_SIMPLE);
  const fa=work.cols*work.rows,mn=fa*0.015,mx=fa*0.70;
  console.log('frame:',src.cols,'x',src.rows,'  work:',work.cols,'x',work.rows);
  for(let i=0;i<co.size();i++){
    const d=co.get(i);const r=cv.minAreaRect(d);d.delete();
    const W=r.size.width,H=r.size.height,L=Math.max(W,H),S=Math.min(W,H);
    if(L/Math.max(1,S)<3.5)continue;
    if(2*L*L<mn||2*L*L>mx)continue;
    const ang=(W>=H?r.angle:r.angle+90)*Math.PI/180;
    const ux=Math.cos(ang),uy=Math.sin(ang),px=-uy,py=ux;
    const cx=r.center.x,cy=r.center.y,hs=L/2,hl=L;
    const pts=[[-hs,-hl],[hs,-hl],[hs,hl],[-hs,hl]].map(([s,l])=>({x:cx+s*ux+l*px,y:cy+s*uy+l*py}));
    const strict=pts.every(p=>p.x>=0&&p.x<=work.cols&&p.y>=0&&p.y<=work.rows);
    const ptsMin=pts.map(p=>`(${p.x.toFixed(0)},${p.y.toFixed(0)})`).join(' ');
    // center-based check: tile extends ±L from center
    const centerFits=(cx-L>=0&&cx+L<=work.cols&&cy-L>=0&&cy+L<=work.rows);
    const step=Math.max(3,L/14);let sum=0,n=0,inf=0;
    for(let s=-hs;s<=hs;s+=step)for(let l=-hl;l<=hl;l+=step){
      const xx=Math.round(cx+s*ux+l*px),yy=Math.round(cy+s*uy+l*py);
      n++;if(xx>=0&&yy>=0&&xx<work.cols&&yy<work.rows){inf++;sum+=g.ucharPtr(yy,xx)[0];}
    }
    const meanB=inf?sum/inf:0;
    console.log(`L=${Math.round(L)} cx=${Math.round(cx)} cy=${Math.round(cy)} meanB=${meanB.toFixed(0)} strict=${strict} centerFits=${centerFits} corners:${ptsMin}`);
  }
  const found=D._test.findTiles(src,0.015,0.70,0.03);
  console.log('findTiles result:',found.length,'tiles');
  process.exit(0);
};
setTimeout(()=>process.exit(1),60000);
