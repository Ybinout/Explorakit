const assert=require('node:assert/strict'),path=require('node:path');
const atlas=require('../vue-explorakit/src/data/classicNpcFrames.json');
const manifest=require('../vue-explorakit/src/data/npcDialoguePortraits.json');
async function validateNpcSprites(page,output){
 const result=await page.evaluate(async ({atlas,manifest})=>{
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
  const sheet=document.createElement('canvas');sheet.width=864;sheet.height=1200;sheet.id='npc-crop-review';const sheetCtx=sheet.getContext('2d');
  sheetCtx.fillStyle='#e5edf0';sheetCtx.fillRect(0,0,sheet.width,sheet.height);
  let portrait;
  for(let i=0;i<36;i++){
   const special=[{name:'aspha_route2_after',index:25},{name:'valpierre_vendeur',index:30},{name:'centre',index:0,imageName:'inf.png'},{name:'lucie_route2_locked',index:18}][i-32];
   vm.updateTextImageSequence([{text:'Bonjour !',imageName:special?.imageName||'townspeople.png',portraitFrame:{columns:8,rows:4,index:special?.index??i}}],special?.name||'');await vm.$nextTick();
   portrait=document.querySelector('canvas.portrait-atlas').__vue__;await portrait.renderPortrait();
   const resolved=vm.textImageSequence[0],asset=manifest.assets[Math.floor(i/18)],f=resolved.portraitFrame;
   if(!resolved.image.includes(asset.imageName.replace('.png','.'))||f.columns!==6||f.rows!==3||f.index!==i%18)throw Error('Portrait identity mismatch '+i);
   const illustration=new Image();illustration.src=resolved.image;await illustration.decode();
   if(illustration.src===image.src||illustration.naturalWidth!==asset.width||illustration.naturalHeight!==asset.height)throw Error('Dialogue must use its separate HD atlas');
   const rendered=portrait.$refs.portrait,expected=document.createElement('canvas');expected.width=rendered.width;expected.height=rendered.height;const ec=expected.getContext('2d');ec.imageSmoothingEnabled=true;ec.imageSmoothingQuality='high';
   const column=f.index%6,row=Math.floor(f.index/6),x=Math.floor(column*illustration.width/6)+1,y=asset.rowBounds[row]+1,w=Math.floor((column+1)*illustration.width/6)-1-x,h=asset.rowBounds[row+1]-1-y,scale=Math.min(rendered.width/w,rendered.height/h);
   ec.drawImage(illustration,x,y,w,h,(rendered.width-w*scale)/2,rendered.height-h*scale,w*scale,h*scale);
   const actual=rendered.getContext('2d').getImageData(0,0,rendered.width,rendered.height).data,wanted=ec.getImageData(0,0,expected.width,expected.height).data;
   if(actual.some((v,j)=>v!==wanted[j]))throw Error('Dialogue crop mismatch '+i);
   if(!portrait.ready||getComputedStyle(rendered).imageRendering!=='auto')throw Error('Illustration uses pixel rendering');
   const xx=i%6*144,yy=Math.floor(i/6)*200;sheetCtx.drawImage(rendered,xx,yy,144,144);const b=atlas.frames[i];sheetCtx.imageSmoothingEnabled=false;sheetCtx.drawImage(image,b.x,b.y,b.w,b.h,xx+(144-b.w*2)/2,yy+179-b.h*2,b.w*2,b.h*2);sheetCtx.imageSmoothingEnabled=true;sheetCtx.fillStyle='#234550';sheetCtx.font='11px sans-serif';sheetCtx.fillText(i+' '+b.name,xx+8,yy+194);
  }
  // Role overrides also cover saleswomen, continuation dialogues and static Wayne.
  for(const [name,expected] of [['shop_keeper_1',0],['clairfontaine_vendeuse',0],['aspha_route2_locked',32],['lucie_route2_after',35]]){
   vm.updateTextImageSequence([{text:'Bonjour',imageName:'townspeople.png',portraitFrame:{columns:8,rows:4,index:18}}],name);const r=vm.textImageSequence[0];if(r.portraitFrame.index!==expected%18||!r.image.includes(manifest.assets[Math.floor(expected/18)].imageName.replace('.png','.')))throw Error('Role override mismatch '+name);
  }
  vm.updateTextImageSequence([{text:'Wayne',imageName:'a.png'}],'dia1');if(vm.textImageSequence[0].portraitFrame.index!==15)throw Error('Wayne must match his painted navy cap');
  for(const imageName of ['moonpunch.png','hoze.png','raph.png','ana.png','wanda.png','7ps.png']){vm.updateTextImageSequence([{text:'Champion',imageName}]);if(vm.textImageSequence[0].portraitFrame||!vm.textImageSequence[0].image.includes(imageName.replace('.png','.')))throw Error('Champion portrait changed');}
  vm.updateTextImageSequence([{text:'Bonjour',imageName:'inf.png'}],'centre');await vm.$nextTick();portrait=document.querySelector('canvas.portrait-atlas').__vue__;await portrait.renderPortrait();
  // Invalid or absent input clears the previous person immediately, keeping the slot fixed.
  vm.textImageSequence[0].image='';await vm.$nextTick();await portrait.renderPortrait();
  if(portrait.ready||portrait.$refs.portrait.getContext('2d').getImageData(0,0,384,384).data.some(Boolean))throw Error('Previous portrait survives a missing illustration');
  vm.textImageSequence=[];sheet.style.cssText='position:fixed;inset:0;z-index:999999;background:#294550;width:min(864px,100vw);height:auto;image-rendering:auto';document.body.append(sheet);
  return{worldScale:2,originalAtlas:true,championsPreserved:true,feetAnchor:26,worldFrames:32,roleOverrides:special.length,portraitFrames:36,illustratedPortraits:true,separateAtlases:true,connectedCharacters:atlas.frames.length};
 },{atlas,manifest});
 assert.equal(result.worldFrames,32);await page.locator('#npc-crop-review').screenshot({path:path.join(output,'npc-crop-all-36.png')});await page.locator('#npc-crop-review').evaluate(el=>el.remove());await page.locator('#npc-world-review').screenshot({path:path.join(output,'npc-original-world.png')});await page.locator('#npc-world-review').evaluate(el=>el.remove());return result;
}
module.exports={validateNpcSprites};
