// Assemble the generated, continuous floor and stair art without moving furniture.
// No runtime renderer, map, collision or progression changes are involved.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process'),{chromium}=require('playwright');
const root=path.resolve(__dirname,'..'),client=path.join(root,'vue-explorakit');
const compact=require('../docs/DEPARTMENT_STORE_COMPACT_FURNITURE.json');
const baseCommit='a9ca1cfbd1e7e4bbc81d7c7c2ff46e8b1677e84c';
const source=path.join(root,'docs/art/department-store-room-master.png');
const uri=b=>'data:image/png;base64,'+b.toString('base64');
(async()=>{
 const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 try{
  const page=await browser.newPage();
  // Optional initial import; subsequent exports are fully repository-local.
  if(process.env.ROOM_MASTER_SOURCE){
   const png=await page.evaluate(async src=>{const im=new Image();im.src=src;await im.decode();const c=document.createElement('canvas');c.width=448;c.height=320;const g=c.getContext('2d');g.imageSmoothingEnabled=false;g.drawImage(im,0,0,448,320);return c.toDataURL().split(',')[1];},uri(fs.readFileSync(process.env.ROOM_MASTER_SOURCE)));
   fs.writeFileSync(source,Buffer.from(png,'base64'));
  }
  const results=[];
  for(const edit of compact.edits){
   const collision=require('../server/game/world/mapRepository').loadCollisionData(edit.map);
   for(const object of edit.objects){const[x,y,w,h]=object.target;for(let yy=y;yy<y+h;yy++)for(let xx=x;xx<x+w;xx++)assert(collision[Math.floor(yy/16)][Math.floor(xx/16)],edit.map+' furniture outside collision');}
   const original=execFileSync('git',['show',baseCommit+':src/assets/'+edit.map+'.png'],{cwd:client});
   const result=await page.evaluate(async({original,master,edit})=>{
    const load=async src=>{const im=new Image();im.src=src;await im.decode();const c=document.createElement('canvas');c.width=448;c.height=320;const g=c.getContext('2d');g.imageSmoothingEnabled=false;g.drawImage(im,0,0);return c;};
    const before=await load(original),art=await load(master),canvas=await load(original),g=canvas.getContext('2d');
    const old=before.getContext('2d').getImageData(0,0,448,320).data;
    // A SINGLE uninterrupted source covers the entire floor, including the former
    // patch rectangles. Never copy an object's old rectangular blue background.
    g.drawImage(art,31,98,388,169,31,70,388,197);
    const stairs=[];
    if(edit.map!=='tour_rdc')stairs.push({direction:'down',rect:[30,43,52,53]});
    if(edit.map!=='tour_etage3')stairs.push({direction:'up',rect:[366,43,51,53]});
    for(const {rect}of stairs)g.drawImage(art,...rect,...rect);
    const objects=edit.objects.map(o=>({name:o.name,rect:o.target}));
    // The plant at ground level overlaps the floor. Keep its original silhouette.
    if(edit.map==='tour_rdc')objects.push({name:'plant',rect:[33,61,25,35]},{name:'door',rect:[192,253,64,34]});
    if(edit.map==='tour_etage3')objects.push({name:'plant',rect:[389,46,26,36]});
    const masks=[];
    for(const object of objects){
     const[x,y,w,h]=object.rect,c=document.createElement('canvas');c.width=w;c.height=h;
     const q=c.getContext('2d');q.drawImage(before,x,y,w,h,0,0,w,h);const pixels=q.getImageData(0,0,w,h),d=pixels.data;
     // Only blue floor connected to the outside of the crop is transparent.
     // Dark outlines retain blue merchandise and counter surfaces inside them.
     const background=new Uint8Array(w*h),queue=[];
     const add=(xx,yy)=>{if(xx<0||yy<0||xx>=w||yy>=h)return;const n=yy*w+xx,i=n*4,r=d[i],gg=d[i+1],b=d[i+2];if(background[n]||!(r>=40&&r<=115&&gg>r+10&&b>gg+12&&gg<=155))return;background[n]=1;queue.push(n);};
     for(let xx=0;xx<w;xx++){add(xx,0);add(xx,h-1);}for(let yy=0;yy<h;yy++){add(0,yy);add(w-1,yy);}
     for(let k=0;k<queue.length;k++){const xx=queue[k]%w,yy=Math.floor(queue[k]/w);add(xx-1,yy);add(xx+1,yy);add(xx,yy-1);add(xx,yy+1);}
     for(let n=0;n<background.length;n++)if(background[n])d[n*4+3]=0;
     q.putImageData(pixels,0,0);g.drawImage(c,x,y);masks.push({name:object.name,rect:object.rect,transparentFloor:queue.length,preservedPixels:w*h-queue.length});
    }
    const after=g.getImageData(0,0,448,320).data;
    let outside=0;for(let y=0;y<320;y++)for(let x=0;x<448;x++){
     if((x>=31&&x<419&&y>=70&&y<267)||stairs.some(s=>x>=s.rect[0]&&x<s.rect[0]+s.rect[2]&&y>=s.rect[1]&&y<s.rect[1]+s.rect[3]))continue;
     const i=(y*448+x)*4;for(let k=0;k<4;k++)if(old[i+k]!==after[i+k])outside++;
    }
    const brightness=rect=>{let total=0,n=0;for(let y=rect[1];y<rect[1]+rect[3];y++)for(let x=rect[0];x<rect[0]+rect[2];x++){const i=(y*448+x)*4;total+=(after[i]+after[i+1]+after[i+2])/3;n++;}return total/n;};
    return{png:canvas.toDataURL().split(',')[1],outside,masks,stairs:stairs.map(s=>({...s,brightness:brightness(s.direction==='up'?[378,53,23,34]:[43,53,23,34])}))};
   },{original:uri(original),master:uri(fs.readFileSync(source)),edit});
   assert.equal(result.outside,0,edit.map+' changed outside floor/stairs');
   const down=result.stairs.find(s=>s.direction==='down'),up=result.stairs.find(s=>s.direction==='up');
   if(down&&up)assert(up.brightness>down.brightness+60,'stairs must be visibly different');
   const output=path.join(client,'src/assets',edit.map+'.png'),bytes=Buffer.from(result.png,'base64');
   if(process.argv.includes('--check'))assert(fs.readFileSync(output).equals(bytes),edit.map+' export mismatch');else fs.writeFileSync(output,bytes);
   const{png,...proof}=result;results.push({map:edit.map,...proof});
  }
  console.log(JSON.stringify({source:'docs/art/department-store-room-master.png',baseCommit,results}));
 }finally{await browser.close();}
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
