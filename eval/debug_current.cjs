const fs=require('fs'),path=require('path'),jpeg=require('jpeg-js'),cv=require('@techstark/opencv-js');
const DIR=__dirname;
cv.onRuntimeInitialized=()=>{
  global.cv=cv;global.window={};
  global.document={createElement:()=>({getContext:()=>({}),toDataURL:()=>''})};
  new Function(fs.readFileSync(path.join(DIR,'..','detect.js'),'utf8'))();
  const D=global.window.DominoCV;
  for(const name of ['467','468','469','470','471']){
    const raw=jpeg.decode(fs.readFileSync(path.join(DIR,'photos',name+'.jpg')),{useTArray:true});
    D._test.stretchGray(raw.data);
    const src=cv.matFromImageData({data:new Uint8ClampedArray(raw.data),width:raw.width,height:raw.height});
    const tiles=D._test.scanMat(src);
    console.log(`${name}: ${tiles.map(t=>t.left+'|'+t.right).join('  ')}`);
    src.delete();
  }
  process.exit(0);
};
setTimeout(()=>process.exit(1),120000);
