const fs=require('fs'),path=require('path'),jpeg=require('jpeg-js'),cv=require('@techstark/opencv-js');
const DIR=__dirname;
cv.onRuntimeInitialized=()=>{
  global.cv=cv;global.window={};
  global.document={createElement:()=>({getContext:()=>({}),toDataURL:()=>''})};
  new Function(fs.readFileSync(path.join(DIR,'..','detect.js'),'utf8'))();
  const D=global.window.DominoCV;
  for(const name of ['464','465','466']){
    const raw=jpeg.decode(fs.readFileSync(path.join(DIR,'photos',name+'.jpg')),{useTArray:true});
    D._test.stretchGray(raw.data);
    const src=cv.matFromImageData({data:new Uint8ClampedArray(raw.data),width:raw.width,height:raw.height});
    let gray=new cv.Mat(),blurred=new cv.Mat(),binary=new cv.Mat(),eroded=new cv.Mat(),
        conts=new cv.MatVector(),hier=new cv.Mat();
    cv.cvtColor(src,gray,cv.COLOR_RGBA2GRAY);
    cv.GaussianBlur(gray,blurred,new cv.Size(5,5),0);
    cv.threshold(blurred,binary,0,255,cv.THRESH_BINARY+cv.THRESH_OTSU);
    const kSize=Math.max(3,Math.round(Math.min(src.cols,src.rows)*0.01));
    const kernel=cv.Mat.ones(kSize,kSize,cv.CV_8U);
    cv.erode(binary,eroded,kernel);
    cv.findContours(eroded,conts,hier,cv.RETR_EXTERNAL,cv.CHAIN_APPROX_SIMPLE);
    const frameArea=src.cols*src.rows,minArea=frameArea*0.016;
    console.log(`\n=== ${name}: frame=${src.cols}×${src.rows} minArea=${minArea.toFixed(0)} (0.016) ===`);
    const blobs=[];
    for(let i=0;i<conts.size();i++){const c=conts.get(i);const a=cv.contourArea(c);if(a>5000){const r=cv.minAreaRect(c);const rw=r.size.width,rh=r.size.height;const ratio=Math.max(rw,rh)/Math.min(rw,rh);blobs.push({a,rw:Math.round(rw),rh:Math.round(rh),ratio});} c.delete();}
    blobs.sort((a,b)=>b.a-a.a);
    for(const b of blobs) console.log(`  area=${b.a.toFixed(0)} ratio=${b.ratio.toFixed(2)} (${b.rw}×${b.rh}) ${b.a>=minArea&&b.ratio>=1.5&&b.ratio<=3.0?'✓':b.a<minArea?'area_fail':b.ratio<1.5?'ratio_low':b.ratio>3.0?'ratio_high':''}`);
    gray.delete();blurred.delete();binary.delete();eroded.delete();kernel.delete();conts.delete();hier.delete();src.delete();
  }
  process.exit(0);
};
setTimeout(()=>process.exit(1),120000);
