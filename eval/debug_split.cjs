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
    
    // Manually run the merge detection pipeline
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
    const minArea=imgArea*0.015,maxArea=imgArea*0.70;
    
    console.log(`\n=== Photo ${name} ===`);
    for(let i=0;i<conts.size();i++){
      const c=conts.get(i);const area=cv.contourArea(c);c.delete();
      if(area<imgArea*0.005)continue;
      const rect=cv.minAreaRect(conts.get(i));
      const rw=rect.size.width,rh=rect.size.height;
      const ratio=Math.max(rw,rh)/Math.min(rw,rh);
      const fill=area/(rw*rh);
      console.log(`  blob: area=${(area/imgArea*100).toFixed(1)}% ratio=${ratio.toFixed(2)} fill=${fill.toFixed(3)}`);
      
      if(fill>=0.40&&fill<0.72&&ratio>=2.0){
        console.log(`    → merged blob candidate, attempting split`);
        // Try the split manually
        const isL=rw>=rh;
        const longS=isL?rw:rh,shortS=isL?rh:rw;
        const angle=isL?rect.angle:rect.angle+90;
        const cx=rect.center.x,cy=rect.center.y;
        let M=null,rot=null,roi=null,cp=null;
        try{
          M=cv.getRotationMatrix2D(new cv.Point(cx,cy),angle,1.0);
          rot=new cv.Mat();
          cv.warpAffine(eroded,rot,M,new cv.Size(eroded.cols,eroded.rows),cv.INTER_NEAREST,cv.BORDER_CONSTANT);
          const pad=Math.max(3,Math.round(shortS*0.05));
          const rx=Math.max(0,Math.round(cx-longS/2)-pad);
          const ry=Math.max(0,Math.round(cy-shortS/2)-pad);
          const rw2=Math.min(rot.cols-rx,Math.round(longS)+2*pad);
          const rh2=Math.min(rot.rows-ry,Math.round(shortS)+2*pad);
          console.log(`    roiSize=${rw2}x${rh2}`);
          roi=rot.roi(new cv.Rect(rx,ry,rw2,rh2));
          cp=new cv.Mat();roi.copyTo(cp);
          const data=cp.data,cols=cp.cols,rows=cp.rows;
          // Check mat type
          console.log(`    matType=${cp.type()} channels=${cp.channels()} cols=${cols} rows=${rows}`);
          const proj=new Array(cols).fill(0);
          for(let r=0;r<rows;r++) for(let c=0;c<cols;c++) if(data[r*cols+c]>128) proj[c]++;
          const s=Math.floor(cols*0.30),e=Math.ceil(cols*0.70);
          let minV=Infinity,minC=Math.floor(cols/2);
          for(let c=s;c<=e;c++) if(proj[c]<minV){minV=proj[c];minC=c;}
          const avgV=proj.reduce((a,b)=>a+b,0)/cols;
          console.log(`    projection: minV=${minV.toFixed(0)} avgV=${avgV.toFixed(0)} minV/avgV=${(minV/avgV).toFixed(3)} minC=${minC} (${(minC/cols*100).toFixed(0)}% of width)`);
          console.log(`    projSample=[${proj.slice(Math.floor(cols*0.2),Math.floor(cols*0.8)).map(v=>v.toFixed(0)).join(',')}]`);
        }finally{
          if(M)M.delete();if(rot)rot.delete();if(roi)roi.delete();if(cp)cp.delete();
        }
      }
    }
    gray.delete();blurred.delete();binary.delete();eroded.delete();kernel.delete();conts.delete();hier.delete();src.delete();
  }
  process.exit(0);
};
setTimeout(()=>process.exit(1),120000);
