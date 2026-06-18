const fs=require('fs'),path=require('path'),jpeg=require('jpeg-js'),cv=require('@techstark/opencv-js');
const DIR=__dirname;
cv.onRuntimeInitialized=()=>{
  global.cv=cv;global.window={};
  global.document={createElement:()=>({getContext:()=>({}),toDataURL:()=>''})};
  new Function(fs.readFileSync(path.join(DIR,'..','detect.js'),'utf8'))();
  const D=global.window.DominoCV;

  // Test different minAreaFrac values on all photos
  const photos=['464','465','466','467','468','469','470','471'];
  for(const frac of [0.015, 0.018, 0.020]){
    let pass=0,total=0;
    const results=[];
    for(const name of photos){
      const raw=jpeg.decode(fs.readFileSync(path.join(DIR,'photos',name+'.jpg')),{useTArray:true});
      D._test.stretchGray(raw.data);
      const src=cv.matFromImageData({data:new Uint8ClampedArray(raw.data),width:raw.width,height:raw.height});
      const tiles=D._test.findTiles(src,frac,0.70,0.03);
      results.push(`${name}:${tiles.length}tiles fills=[${tiles.map(t=>t.fill.toFixed(2)).join(',')}]`);
      src.delete();
    }
    console.log(`\nminAreaFrac=${frac}:`);
    results.forEach(r=>console.log('  '+r));
  }
  process.exit(0);
};
setTimeout(()=>process.exit(1),120000);
