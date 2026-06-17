const fs=require('fs'),path=require('path'),jpeg=require('jpeg-js'),cv=require('@techstark/opencv-js');
const DIR=__dirname;
cv.onRuntimeInitialized=()=>{
  global.cv=cv;global.window={};
  global.document={createElement:()=>({getContext:()=>({}),toDataURL:()=>''})};
  new Function(fs.readFileSync(path.join(DIR,'..','detect.js'),'utf8'))();
  const D=global.window.DominoCV;

  for(const name of ['465','466']){
    const raw=jpeg.decode(fs.readFileSync(path.join(DIR,'photos',name+'.jpg')),{useTArray:true});
    D._test.stretchGray(raw.data);
    const src=cv.matFromImageData({data:new Uint8ClampedArray(raw.data),width:raw.width,height:raw.height});
    const gray=new cv.Mat(),blurred=new cv.Mat(),binary=new cv.Mat(),eroded=new cv.Mat();
    cv.cvtColor(src,gray,cv.COLOR_RGBA2GRAY);
    cv.GaussianBlur(gray,blurred,new cv.Size(5,5),0);
    cv.threshold(blurred,binary,0,255,cv.THRESH_BINARY+cv.THRESH_OTSU);
    const kSize=Math.max(3,Math.round(Math.min(src.cols,src.rows)*0.01));
    const kernel=cv.Mat.ones(kSize,kSize,cv.CV_8U);
    cv.erode(binary,eroded,kernel);
    const conts=new cv.MatVector(),hier=new cv.Mat();
    cv.findContours(eroded,conts,hier,cv.RETR_EXTERNAL,cv.CHAIN_APPROX_SIMPLE);
    const imgArea=src.cols*src.rows;
    const minArea=imgArea*0.015;
    console.log(`\n=== Photo ${name} ===`);
    for(let i=0;i<conts.size();i++){
      const c=conts.get(i);const area=cv.contourArea(c);
      if(area<imgArea*0.005){c.delete();continue;}
      const rect=cv.minAreaRect(c);
      const rw=rect.size.width,rh=rect.size.height;
      const ratio=Math.max(rw,rh)/Math.min(rw,rh);
      const fill=area/(rw*rh);
      if(fill>=0.40&&fill<0.72&&ratio>=2.0){
        const brect=cv.boundingRect(c);
        console.log(`  merged blob: area=${(area/imgArea*100).toFixed(1)}% ratio=${ratio.toFixed(2)} fill=${fill.toFixed(3)}`);
        console.log(`  brect: x=${brect.x} y=${brect.y} w=${brect.width} h=${brect.height}`);
        // Test different erosion kernels on the ROI
        for(const pct of [1,2,3,4,5]){
          const pad=Math.round(Math.max(brect.width,brect.height)*0.04);
          const rx=Math.max(0,brect.x-pad),ry=Math.max(0,brect.y-pad);
          const rw2=Math.min(binary.cols-rx,brect.width+2*pad);
          const rh2=Math.min(binary.rows-ry,brect.height+2*pad);
          let roi=null,cp=null,k2=null,er2=null,c2=null,h2=null;
          try{
            roi=binary.roi(new cv.Rect(rx,ry,rw2,rh2));
            cp=new cv.Mat();roi.copyTo(cp);
            const kSz=Math.max(5,Math.round(Math.min(rw2,rh2)*pct/100));
            k2=cv.Mat.ones(kSz,kSz,cv.CV_8U);
            er2=new cv.Mat();cv.erode(cp,er2,k2);
            c2=new cv.MatVector();h2=new cv.Mat();
            cv.findContours(er2,c2,h2,cv.RETR_EXTERNAL,cv.CHAIN_APPROX_SIMPLE);
            const blobs=[];
            for(let j=0;j<c2.size();j++){
              const cc=c2.get(j);const ba=cv.contourArea(cc);cc.delete();
              if(ba<minArea*0.3)continue;
              const cc2=c2.get(j);const rr=cv.minAreaRect(cc2);cc2.delete();
              const rw3=rr.size.width,rh3=rr.size.height;
              blobs.push(`area=${(ba/imgArea*100).toFixed(1)}% ratio=${(Math.max(rw3,rh3)/Math.min(rw3,rh3)).toFixed(2)} fill=${(ba/(rw3*rh3)).toFixed(2)}`);
            }
            console.log(`    pct=${pct}% kSz=${kSz} ROI=${rw2}x${rh2}: ${blobs.length} valid blobs: [${blobs.join('; ')}]`);
          }finally{
            if(roi)roi.delete();if(cp)cp.delete();if(k2)k2.delete();if(er2)er2.delete();if(c2)c2.delete();if(h2)h2.delete();
          }
        }
      }
      c.delete();
    }
    gray.delete();blurred.delete();binary.delete();eroded.delete();kernel.delete();conts.delete();hier.delete();src.delete();
  }
  process.exit(0);
};
setTimeout(()=>process.exit(1),120000);
