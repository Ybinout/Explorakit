// Deterministic assembly of generated pixel art into the existing blocked cells.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const{chromium}=require('playwright');
const root=path.resolve(__dirname,'..'),dir=path.join(root,'docs/art');
const names={furniture:'lucie-room-furniture.png',empty:'lucie-room-empty.png'};
const uri=b=>'data:image/png;base64,'+b.toString('base64');
const objects=[
 {name:'bookshelf',source:[111,77,36,40],target:[114,81,26,31],solid:true},
 {name:'bed',source:[287,77,40,59],target:[290,81,28,45],solid:true},
 {name:'table-lamp-papers',source:[127,168,40,45],target:[130,177,28,30],solid:true},
 {name:'chest',source:[256,175,39,38],target:[258,179,28,27],solid:true},
 {name:'plant',source:[303,199,23,39],target:[305,210,14,26],solid:true},
 {name:'rug',source:[207,204,34,84],target:[211,209,26,77],solid:false}
];
(async()=>{
 const collision=require('../server/game/world/mapRepository').loadCollisionData('route2_maison');
 for(const o of objects.filter(o=>o.solid)){const[x,y,w,h]=o.target;for(let yy=y;yy<y+h;yy++)for(let xx=x;xx<x+w;xx++)assert(collision[Math.floor(yy/16)][Math.floor(xx/16)],o.name+' outside blocked cells');}
 const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 try{
  const page=await browser.newPage();
  for(const[key,name]of Object.entries(names))if(process.env['ROOM_'+key.toUpperCase()]){
   const png=await page.evaluate(async src=>{const im=new Image();im.src=src;await im.decode();const c=document.createElement('canvas');c.width=448;c.height=320;const g=c.getContext('2d');g.imageSmoothingEnabled=false;g.fillStyle='#000';g.fillRect(0,0,448,320);g.drawImage(im,319,100,847,851,96,32,256,256);return c.toDataURL().split(',')[1];},uri(fs.readFileSync(process.env['ROOM_'+key.toUpperCase()])));
   fs.writeFileSync(path.join(dir,name),Buffer.from(png,'base64'));
  }
  const result=await page.evaluate(async({empty,art,objects})=>{
   const load=async src=>{const im=new Image();im.src=src;await im.decode();return im;};
   const base=await load(empty),furniture=await load(art),canvas=document.createElement('canvas');canvas.width=448;canvas.height=320;const g=canvas.getContext('2d');g.imageSmoothingEnabled=false;g.drawImage(base,0,0);const proof=[];
   for(const o of [...objects].sort((a,b)=>Number(a.solid)-Number(b.solid))){
    const[sx,sy,w,h]=o.source,c=document.createElement('canvas');c.width=w;c.height=h;const ctx=c.getContext('2d');ctx.drawImage(furniture,sx,sy,w,h,0,0,w,h);const pixels=ctx.getImageData(0,0,w,h),d=pixels.data,seen=new Uint8Array(w*h),q=[];
    let outline=null;
    if(o.name==='table-lamp-papers'){
     const raw=new Uint8Array(w*h),wide=new Uint8Array(w*h);outline=new Uint8Array(w*h);
     for(let n=0;n<raw.length;n++){const i=n*4;raw[n]=Math.max(d[i],d[i+1],d[i+2])<65&&d[i+2]-d[i]<22&&d[i+1]-d[i]<16?1:0;}
     // Close one-pixel gaps in the generated outline, keeping its enclosed
     // tabletop while excluding the former rectangular amber floor lighting.
     for(let y=1;y<h-1;y++)for(let x=1;x<w-1;x++)for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++)if(raw[(y+dy)*w+x+dx])wide[y*w+x]=1;
     for(let y=1;y<h-1;y++)for(let x=1;x<w-1;x++){let solid=1;for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++)solid&=wide[(y+dy)*w+x+dx];outline[y*w+x]=solid;}
    }
    const add=(x,y)=>{if(x<0||y<0||x>=w||y>=h)return;const n=y*w+x,i=n*4,r=d[i],gg=d[i+1],b=d[i+2];const blue=b>gg+7&&gg>r+3&&b-r>18&&b<170,amber=r>55&&r<110&&gg>45&&r>=gg&&gg>=b&&r-gg<22&&gg-b<22;if(seen[n]||(outline?outline[n]:!(blue||amber)))return;seen[n]=1;q.push(n);};
    for(let x=0;x<w;x++){add(x,0);add(x,h-1);}for(let y=0;y<h;y++){add(0,y);add(w-1,y);}
    for(let k=0;k<q.length;k++){const x=q[k]%w,y=Math.floor(q[k]/w);add(x-1,y);add(x+1,y);add(x,y-1);add(x,y+1);}
    let x0=w,y0=h,x1=-1,y1=-1;for(let y=0;y<h;y++)for(let x=0;x<w;x++){const n=y*w+x;if(seen[n])d[n*4+3]=0;else{x0=Math.min(x0,x);y0=Math.min(y0,y);x1=Math.max(x1,x);y1=Math.max(y1,y);}}
    ctx.putImageData(pixels,0,0);if(x1<x0)throw Error('Missing '+o.name);g.drawImage(c,x0,y0,x1-x0+1,y1-y0+1,...o.target);
    proof.push({name:o.name,source:[sx+x0,sy+y0,x1-x0+1,y1-y0+1],target:o.target,preservedPixels:w*h-q.length,removedBackground:q.length});
   }
   const pixels=g.getImageData(0,0,448,320).data;let outside=0;for(let y=0;y<320;y++)for(let x=0;x<448;x++)if(x<96||x>=352||y<32||y>=288){const i=(y*448+x)*4;if(pixels[i]||pixels[i+1]||pixels[i+2])outside++;}
   return{png:canvas.toDataURL().split(',')[1],proof,outside};
  },{empty:uri(fs.readFileSync(path.join(dir,names.empty))),art:uri(fs.readFileSync(path.join(dir,names.furniture))),objects});
  assert.equal(result.outside,0,'room bounds changed');
  const dest=path.join(root,'vue-explorakit/src/assets/route2_maison.png'),bytes=Buffer.from(result.png,'base64');
  if(process.argv.includes('--check'))assert(fs.readFileSync(dest).equals(bytes),'Room export differs');else fs.writeFileSync(dest,bytes);
  const{png,...proof}=result;console.log(JSON.stringify(proof));
 }finally{await browser.close();}
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
