const assert=require('node:assert/strict'),path=require('node:path');
const atlas=require('../vue-explorakit/src/data/townspeopleFrames.json');
async function validateNpcSprites(page,output){
 const result=await page.evaluate(async atlas=>{
  const vm=window.mobileTestVm,image=vm.ensurePnjSpriteSheet('townspeople.png');await image.decode();
  if(!image.src.includes('townspeople-pixel-v2'))throw Error('World did not load the pixel atlas');
  const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;const ctx=canvas.getContext('2d');ctx.drawImage(image,0,0);
  const pixels=ctx.getImageData(0,0,image.width,image.height).data,seen=new Set(),components=[];
  for(let y=0;y<image.height;y++)for(let x=0;x<image.width;x++){
   const k=y*image.width+x;if(seen.has(k)||pixels[k*4+3]<128)continue;const queue=[k];seen.add(k);let n=0,x0=x,x1=x,y0=y,y1=y;
   while(queue.length){const key=queue.pop(),px=key%image.width,py=Math.floor(key/image.width);n++;x0=Math.min(x0,px);x1=Math.max(x1,px);y0=Math.min(y0,py);y1=Math.max(y1,py);
    for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1],[1,1],[-1,-1],[1,-1],[-1,1]]){const xx=px+dx,yy=py+dy,j=yy*image.width+xx;if(xx<0||yy<0||xx>=image.width||yy>=image.height||seen.has(j)||pixels[j*4+3]<128)continue;seen.add(j);queue.push(j);}
   }if(n>20)components.push({x:x0,y:y0,w:x1-x0+1,h:y1-y0+1});
  }
  components.sort((a,b)=>Math.floor((a.y+a.h/2)/32)-Math.floor((b.y+b.h/2)/32)||a.x-b.x);
  if(JSON.stringify(components)!==JSON.stringify(atlas.frames))throw Error('Source rectangles split a character or include neighbouring feet');
  const previous=vm.pnjs,draw=ctx.drawImage,calls=[];
  ctx.drawImage=function(img,...args){calls.push(args);return draw.call(this,img,...args);};
  try{vm.pnjs=atlas.frames.map((_,index)=>({sprite:'townspeople.png',spriteFrame:{columns:8,rows:4,index},x:index%8,y:Math.floor(index/8),movedAt:0}));vm.drawPnjs(ctx);}finally{vm.pnjs=previous;ctx.drawImage=draw;}
  for(let i=0;i<32;i++){const b=atlas.frames[i];if(JSON.stringify(calls[i].slice(0,4))!==JSON.stringify([b.x,b.y,b.w,b.h]))throw Error('World uses an incorrect crop '+i);}
  vm.textImageSequence=[{text:'Bonjour !',image:image.src,portraitFrame:{columns:8,rows:4,index:0}}];await vm.$nextTick();
  const portrait=document.querySelector('canvas.portrait-atlas').__vue__;
  const sheet=document.createElement('canvas');sheet.width=512;sheet.height=256;sheet.id='npc-crop-review';const sheetCtx=sheet.getContext('2d');sheetCtx.imageSmoothingEnabled=false;
  for(let i=0;i<32;i++){
   vm.textImageSequence[0].portraitFrame.index=i;await vm.$nextTick();await portrait.renderPortrait();
   const rendered=portrait.$refs.portrait,expected=document.createElement('canvas');expected.width=192;expected.height=192;const ec=expected.getContext('2d');ec.imageSmoothingEnabled=false;const b=atlas.frames[i];ec.drawImage(image,b.x,b.y,b.w,b.h,(192-b.w*6)/2,192-b.h*6,b.w*6,b.h*6);
   const actual=rendered.getContext('2d').getImageData(0,0,192,192).data,wanted=ec.getImageData(0,0,192,192).data;
   if(actual.some((v,j)=>v!==wanted[j]))throw Error('Portrait crop differs from world '+i);
   sheetCtx.drawImage(rendered,(i%8)*64,Math.floor(i/8)*64,64,64);
  }
  vm.textImageSequence=[];sheet.style.cssText='position:fixed;inset:0;z-index:999999;background:#294550;width:512px;height:256px;image-rendering:pixelated';document.body.append(sheet);
  return{worldFrames:calls.length,portraitFrames:32,connectedCharacters:components.length};
 },atlas);
 assert.equal(result.worldFrames,32);await page.locator('#npc-crop-review').screenshot({path:path.join(output,'npc-crop-all-32.png')});await page.locator('#npc-crop-review').evaluate(el=>el.remove());return result;
}
module.exports={validateNpcSprites};
