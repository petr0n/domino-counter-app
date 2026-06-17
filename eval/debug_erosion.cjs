const fs=require('fs'),path=require('path'),jpeg=require('jpeg-js'),cv=require('@techstark/opencv-js');
const DIR=__dirname;
cv.onRuntimeInitialized=()=>{
  global.cv=cv;global.window={};
  global.document={createElement:()=>({getContext:()=>({}),toDataURL:()=>''})};
  new Function(fs.readFileSync(path.join(DIR,'..','detect.js'),'utf8'))();
  const D=global.window.DominoCV;

  for(const kPct of [1,2,3]){
    let tilesByPhoto={};
    for(const name of ['464','465','466','467','468','469','470','471']){
      const raw=jpeg.decode(fs.readFileSync(path.join(DIR,'photos',name+'.jpg')),{useTArray:true});
      D._test.stretchGray(raw.data);
      const src=cv.matFromImageData({data:new Uint8ClampedArray(raw.data),width:raw.width,height:raw.height});
      const gray=new cv.Mat(),blurred=new cv.Mat(),binary=new cv.Mat(),eroded=new cv.Mat();
      cv.cvtColor(src,gray,cv.COLOR_RGBA2GRAY);
      cv.GaussianBlur(gray,blurred,new cv.Size(5,5),0);
      cv.threshold(blurred,binary,0,255,cv.THRESH_BINARY+cv.THRESH_OTSU);
      const kSize=Math.max(3,Math.round(Math.min(src.cols,src.rows)*kPct/100));
      const kernel=cv.Mat.ones(kSize,kSize,cv.CV_8U);
      cv.erode(binary,eroded,kernel);
      const conts=new cv.MatVector(),hier=new cv.Mat();
      cv.findContours(eroded,conts,hier,cv.RETR_EXTERNAL,cv.CHAIN_APPROX_SIMPLE);
      const imgArea=src.cols*src.rows;
      let goodCount=0,details=[];
      for(let i=0;i<conts.size();i++){
        const c=conts.get(i);const area=cv.contourArea(c);c.delete();
        if(area<imgArea*0.010)continue;
        const pct=area/imgArea*100;
        details.push(pct.toFixed(1)+'%');
        if(area>=imgArea*0.015&&area<=imgArea*0.70){
          // check ratio from minAreaRect
          const ct=conts.get(i); // deleted already, need to redo - skip ratio check
          goodCount++;
        }
      }
      tilesByPhoto[name]={details};
      gray.delete();blurred.delete();binary.delete();eroded.delete();kernel.delete();conts.delete();hier.delete();src.delete();
    }
    console.log(`\n=== kSize=${kPct}% ===`);
    for(const [n,v] of Object.entries(tilesByPhoto)) console.log(`  ${n}: blobs=[${v.details.join(',')}]`);
  }
  process.exit(0);
};
setTimeout(()=>process.exit(1),120000);
