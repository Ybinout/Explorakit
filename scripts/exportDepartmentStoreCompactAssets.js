// Integrate generated furniture into exact existing collision footprints.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process'),{chromium}=require('playwright');
const root=path.resolve(__dirname,'..'),manifest=require('../docs/DEPARTMENT_STORE_COMPACT_FURNITURE.json');
const uri=b=>'data:image/png;base64,'+b.toString('base64');
(async()=>{const browser=await chromium.launch({headless:true,args:['--no-sandbox']});try{
 const page=await browser.newPage();
 for(const edit of manifest.edits){
  const collision=require('../server/game/world/mapRepository').loadCollisionData(edit.map);
  for(const object of edit.objects){const[x,y,w,h]=object.target;for(let yy=y;yy<y+h;yy++)for(let xx=x;xx<x+w;xx++)assert(collision[Math.floor(yy/16)][Math.floor(xx/16)],edit.map+' furniture outside collision: '+object.name);}
  const base=execFileSync('git',['show',manifest.baseClientCommit+':src/assets/'+edit.map+'.png'],{cwd:path.join(root,'vue-explorakit')});
  const result=await page.evaluate(async({base,source,floor,objects})=>{
   const load=async src=>{const i=new Image();i.src=src;await i.decode();const c=document.createElement('canvas');c.width=448;c.height=320;const g=c.getContext('2d');g.imageSmoothingEnabled=false;g.drawImage(i,0,0,448,320);return c;};
   const original=await load(base),art=await load(source),clean=await load(floor),c=document.createElement('canvas');c.width=448;c.height=320;const g=c.getContext('2d');g.imageSmoothingEnabled=false;g.drawImage(original,0,0);
   const data=art.getContext('2d').getImageData(0,0,448,320).data,bounds=[];
   for(const object of objects){const[x,y,w,h]=object.clear;g.drawImage(clean,x,y,w,h,x,y,w,h);}
   for(const object of objects){const[sx,sy,sw,sh]=object.sourceSearch;let x0=sx+sw,y0=sy+sh,x1=sx,y1=sy;
    for(let y=sy;y<sy+sh;y++)for(let x=sx;x<sx+sw;x++){const i=(y*448+x)*4,r=data[i],gg=data[i+1],b=data[i+2];if((r<42&&gg<68&&b<105)||(r>115&&gg>130)){x0=Math.min(x0,x);y0=Math.min(y0,y);x1=Math.max(x1,x);y1=Math.max(y1,y);}}
    if(x1<=x0||y1<=y0)throw Error('Furniture crop missing: '+object.name);
    const sourceRect=[x0,y0,x1-x0+1,y1-y0+1];g.drawImage(art,...sourceRect,...object.target);bounds.push({name:object.name,sourceRect,target:object.target});
   }
   // Only furniture patches may change; stairs, plants and walls stay exact.
   const before=original.getContext('2d').getImageData(0,0,448,320).data,after=g.getImageData(0,0,448,320).data;let outside=0;
   for(let y=0;y<320;y++)for(let x=0;x<448;x++){if(objects.some(o=>x>=o.clear[0]&&x<o.clear[0]+o.clear[2]&&y>=o.clear[1]&&y<o.clear[1]+o.clear[3]))continue;const i=(y*448+x)*4;for(let k=0;k<4;k++)if(before[i+k]!==after[i+k])outside++;}
   return{png:c.toDataURL().split(',')[1],bounds,outside};
  },{base:uri(base),source:uri(fs.readFileSync(edit.source)),floor:uri(fs.readFileSync(manifest.floor.source)),objects:edit.objects});
  assert.equal(result.outside,0);fs.writeFileSync(path.join(root,edit.asset),Buffer.from(result.png,'base64'));console.log(JSON.stringify({map:edit.map,bounds:result.bounds,outside:result.outside}));
 }
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
