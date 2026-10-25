// Reproducible export/composition of built-in imagegen art. No generated changes outside the roof paint mask.
const fs=require('node:fs'),path=require('node:path'),{execFileSync}=require('node:child_process'),{createHash}=require('node:crypto'),{chromium}=require('playwright');
const root=path.resolve(__dirname,'..'),client=path.join(root,'vue-explorakit'),manifest=require('../docs/NRV_ROUTE3_ASSETS.json');
const uri=bytes=>'data:image/png;base64,'+bytes.toString('base64');
(async()=>{const browser=await chromium.launch({headless:true,args:['--no-sandbox']});try{const page=await browser.newPage();const original=n=>execFileSync('git',['show',manifest.baseClient+':src/assets/'+n],{cwd:client});
const result=await page.evaluate(async data=>{
 const load=async src=>{const i=new Image;i.src=src;await i.decode();return i;};
 const [base,front,paint,interior,portraits]=await Promise.all(data.slice(0,5).map(load));
 const canvas=(w,h)=>{const c=document.createElement('canvas');c.width=w;c.height=h;return c;};
 const tiny=canvas(80,88),tg=tiny.getContext('2d');tg.imageSmoothingEnabled=false;tg.drawImage(paint,0,0,80,88);const colors=tg.getImageData(0,0,80,88).data;
 const portraitOrder=data[5]||['noz','tom','cry'];
 const results={};let changed=0;
 for(const [name,image]of [['route3.png',base],['route3_f.png',front]]){
  const c=canvas(448,320),g=c.getContext('2d');g.drawImage(image,0,0);const pixels=g.getImageData(0,0,448,320),before=pixels.data.slice();
  const ref=canvas(448,320);ref.getContext('2d').drawImage(base,0,0);const original=ref.getContext('2d').getImageData(0,0,448,320).data;
  for(let y=152;y<=187;y++)for(let x=362;x<=401;x++){
   const j=(y*448+x)*4,k=((y-136)*80+x-352)*4,[r,gr,b]=colors.slice(k,k+3);
   if(gr>r*1.35&&gr>b*1.25&&original[j+2]>original[j]*1.15&&original[j+2]>original[j+1]&&pixels.data[j+3]>0){pixels.data.set([r,gr,b,pixels.data[j+3]],j);if(name==='route3.png')changed++;}
  }
  for(let y=0;y<320;y++)for(let x=0;x<448;x++)if(x<362||x>401||y<152||y>187){const j=(y*448+x)*4;for(let k=0;k<4;k++)if(pixels.data[j+k]!==before[j+k])throw Error('Paint escaped roof');}
  g.putImageData(pixels,0,0);results[name]=c.toDataURL().split(',')[1];
 }
 if(changed<100)throw Error('Graffiti is not visible');
 const room=canvas(448,320),rg=room.getContext('2d');rg.imageSmoothingEnabled=false;rg.drawImage(interior,0,0,448,320);results['route3_maison_nrv.png']=room.toDataURL().split(',')[1];
 for(let index=0;index<3;index++){
  const left=Math.round(index*portraits.width/3),right=Math.round((index+1)*portraits.width/3),width=right-left;
  const c=canvas(384,Math.round(portraits.height*384/width)),g=c.getContext('2d');g.imageSmoothingQuality='high';g.drawImage(portraits,left,0,width,portraits.height,0,0,c.width,c.height);
  const a=g.getImageData(0,0,c.width,c.height).data;let transparent=0;for(let i=3;i<a.length;i+=4)if(!a[i])transparent++;
  if(transparent<c.width*c.height*0.04)throw Error('Portrait alpha missing');
  results['image/nrv-'+portraitOrder[index]+'-v1.png']=c.toDataURL().split(',')[1];
 }
 return{images:results,changedRoofPixels:changed,outsideRoofUnchanged:true};
},[uri(original('route3.png')),uri(original('route3_f.png')),uri(fs.readFileSync(manifest.sources.roof)),uri(fs.readFileSync(manifest.sources.interior)),uri(fs.readFileSync(manifest.sources.portraits)),manifest.portraitOrder]);
for(const [name,base64]of Object.entries(result.images)){if(process.env.NRV_PORTRAITS_ONLY==='1'&&!name.startsWith('image/'))continue;const file=path.join(client,'src/assets',name);fs.writeFileSync(file,Buffer.from(base64,'base64'));}
console.log(JSON.stringify({changedRoofPixels:result.changedRoofPixels,outsideRoofUnchanged:result.outsideRoofUnchanged,assets:Object.keys(result.images).map(name=>({name,sha256:createHash('sha256').update(fs.readFileSync(path.join(client,'src/assets',name))).digest('hex')}))}));
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
