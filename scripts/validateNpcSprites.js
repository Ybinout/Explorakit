const assert=require('node:assert/strict'),path=require('node:path');
const atlas=require('../vue-explorakit/src/data/classicNpcFrames.json');
async function validateNpcSprites(page,output){
 const result=await page.evaluate(async atlas=>{
  const vm=window.mobileTestVm,image=vm.ensurePnjSpriteSheet('townspeople.png');await image.decode();
  if(!/(?:^|\/)6931\.[a-z0-9]+\.png$/.test(image.src))throw Error('World did not load the author-provided atlas');
  if(image.naturalWidth!==atlas.width||image.naturalHeight!==atlas.height)throw Error('Wrong source sheet');
  const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;const ctx=canvas.getContext('2d');ctx.drawImage(image,0,0);
  const pixels=ctx.getImageData(0,0,image.width,image.height).data;
  for(const box of atlas.frames){
   let opaque=0;for(let y=box.y;y<box.y+box.h;y++)for(let x=box.x;x<box.x+box.w;x++)if(pixels[(y*image.width+x)*4+3])opaque++;
   if(opaque!==box.pixels||box.w>26||box.h>30)throw Error('Bad crop or neighbouring feet: '+box.name);
   const touched=new Set(),queue=[box.y*image.width+box.x];
   // Start at the first opaque pixel, then prove the crop holds one whole connected character.
   let first;for(let y=box.y;y<box.y+box.h&&first===undefined;y++)for(let x=box.x;x<box.x+box.w;x++)if(pixels[(y*image.width+x)*4+3]){first=y*image.width+x;break;}
   queue[0]=first;touched.add(first);while(queue.length){const i=queue.pop(),x=i%image.width,y=Math.floor(i/image.width);for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){const xx=x+dx,yy=y+dy,j=yy*image.width+xx;if(xx<0||yy<0||xx>=image.width||yy>=image.height||touched.has(j)||!pixels[j*4+3])continue;if(xx<box.x||yy<box.y||xx>=box.x+box.w||yy>=box.y+box.h)throw Error('Character was cut: '+box.name);touched.add(j);queue.push(j);}}
   if(touched.size!==opaque)throw Error('Extra pixels inside crop: '+box.name);
  }
  const previous=vm.pnjs,draw=ctx.drawImage,calls=[];
  const special=[{name:'aspha_route2',index:25,expected:32},{name:'valpierre_vendeur',index:30,expected:33},{name:'infirmiere',index:0,expected:34},{name:'lucie_route2',index:18,expected:35},{name:'clairfontaine_vendeuse',index:18,expected:0}];
  const actors=[...Array.from({length:32},(_,index)=>({name:'fixture_'+index,index,expected:index})),...special];
  ctx.drawImage=function(img,...args){calls.push(args);return draw.call(this,img,...args);};
  try{vm.pnjs=actors.map((a,index)=>({name:a.name,sprite:'townspeople.png',spriteFrame:{columns:8,rows:4,index:a.index},x:index%8,y:Math.floor(index/8),movedAt:0}));vm.drawPnjs(ctx);}finally{vm.pnjs=previous;ctx.drawImage=draw;}
  for(let i=0;i<actors.length;i++){
   const b=atlas.frames[actors[i].expected],args=calls[i];if(JSON.stringify(args.slice(0,4))!==JSON.stringify([b.x,b.y,b.w,b.h]))throw Error('World uses an incorrect crop '+i);
   const [x,y,w,h]=args.slice(4);if(w!==b.w*2||h!==b.h*2)throw Error('NPC must use crisp original pixels at 2x '+i);
   if(x+w/2!==(i%8)*32+16||y+h!==Math.floor(i/8)*32+26)throw Error('NPC feet moved '+i);
  }
  for(const name of ['moonpunch.png','hoze.png','raph.png','ana.png','wanda.png','7ps.png']){const champion=vm.ensurePnjSpriteSheet(name);await champion.decode();if(champion.src===image.src||champion.naturalWidth!==256)throw Error('Champion changed '+name);}
  const world=document.createElement('canvas');world.id='npc-world-review';world.width=960;world.height=640;const wc=world.getContext('2d');wc.fillStyle='#dce8e0';wc.fillRect(0,0,960,640);wc.imageSmoothingEnabled=false;
  atlas.frames.forEach((b,i)=>{const x=(i%8)*120,y=Math.floor(i/8)*128;wc.drawImage(image,b.x,b.y,b.w,b.h,x+(120-b.w*2)/2,y+88-b.h*2,b.w*2,b.h*2);wc.fillStyle='#203d49';wc.font='12px sans-serif';wc.fillText(b.name,x+5,y+110);});
  world.style.cssText='position:fixed;inset:0;z-index:999999;width:min(960px,100vw);height:auto;image-rendering:pixelated';document.body.append(world);
  vm.updateTextImageSequence([{text:'Bonjour !',imageName:'townspeople.png',portraitFrame:{columns:8,rows:4,index:0}}]);await vm.$nextTick();
  const portrait=document.querySelector('canvas.portrait-atlas').__vue__,illustration=new Image();illustration.src=vm.textImageSequence[0].image;await illustration.decode();
  if(illustration.src===image.src||illustration.naturalWidth<1024||illustration.naturalHeight<512)throw Error('Dialogue must load its own high resolution illustration atlas');
  const sheet=document.createElement('canvas');sheet.width=1024;sheet.height=512;sheet.id='npc-crop-review';const sheetCtx=sheet.getContext('2d');
  for(let i=0;i<32;i++){
   vm.textImageSequence[0].portraitFrame.index=i;await vm.$nextTick();await portrait.renderPortrait();
   const rendered=portrait.$refs.portrait,expected=document.createElement('canvas');expected.width=rendered.width;expected.height=rendered.height;const ec=expected.getContext('2d');ec.imageSmoothingEnabled=true;ec.imageSmoothingQuality='high';
   const column=i%8,row=Math.floor(i/8),x=Math.floor(column*illustration.width/8)+1,y=Math.floor(row*illustration.height/4)+1,w=Math.floor((column+1)*illustration.width/8)-1-x,h=Math.floor((row+1)*illustration.height/4)-1-y,scale=Math.min(rendered.width/w,rendered.height/h);
   ec.drawImage(illustration,x,y,w,h,(rendered.width-w*scale)/2,rendered.height-h*scale,w*scale,h*scale);
   const actual=rendered.getContext('2d').getImageData(0,0,rendered.width,rendered.height).data,wanted=ec.getImageData(0,0,expected.width,expected.height).data;
   if(actual.some((v,j)=>v!==wanted[j]))throw Error('Dialogue illustration uses a wrong crop '+i);
   if(!portrait.ready||getComputedStyle(rendered).imageRendering!=='auto')throw Error('Illustration still uses pixel rendering');
   sheetCtx.drawImage(rendered,(i%8)*128,Math.floor(i/8)*128,128,128);
  }
  // Invalid or absent input clears the previous person immediately, keeping the slot fixed.
  vm.textImageSequence[0].image='';await vm.$nextTick();await portrait.renderPortrait();
  if(portrait.ready||portrait.$refs.portrait.getContext('2d').getImageData(0,0,384,384).data.some(Boolean))throw Error('Previous portrait survives a missing illustration');
  vm.textImageSequence=[];sheet.style.cssText='position:fixed;inset:0;z-index:999999;background:#294550;width:min(1024px,100vw);height:auto;image-rendering:auto';document.body.append(sheet);
  return{worldScale:2,originalAtlas:true,championsPreserved:true,feetAnchor:26,worldFrames:32,roleOverrides:special.length,portraitFrames:32,illustratedPortraits:true,separateAtlases:true,connectedCharacters:atlas.frames.length};
 },atlas);
 assert.equal(result.worldFrames,32);await page.locator('#npc-crop-review').screenshot({path:path.join(output,'npc-crop-all-32.png')});await page.locator('#npc-crop-review').evaluate(el=>el.remove());await page.locator('#npc-world-review').screenshot({path:path.join(output,'npc-original-world.png')});await page.locator('#npc-world-review').evaluate(el=>el.remove());return result;
}
module.exports={validateNpcSprites};
