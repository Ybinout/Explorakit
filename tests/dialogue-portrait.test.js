const test = require('node:test'), assert = require('node:assert/strict');
const service = () => import('../vue-explorakit/src/services/dialoguePortrait.js');
test('illustrated portrait crops stay inside their own cell on the actual fractional-size atlas', async () => {
  const {dialoguePortraitRect,drawDialoguePortrait}=await service(),image={naturalWidth:1774,naturalHeight:887};
  for(let index=0;index<32;index++) {
    const frame={columns:8,rows:4,index},b=dialoguePortraitRect(image,frame),column=index%8,row=Math.floor(index/8);
    assert(b.x>column*1774/8 && b.y>row*887/4);
    assert(b.x+b.w<(column+1)*1774/8 && b.y+b.h<(row+1)*887/4);
    const calls=[],ctx={drawImage:(...args)=>calls.push(args)};
    assert(drawDialoguePortrait(ctx,image,frame,384,384));assert.equal(ctx.imageSmoothingEnabled,true);assert.equal(ctx.imageSmoothingQuality,'high');
    const [,x,y,w,h,dx,dy,dw,dh]=calls[0];assert.deepEqual({x,y,w,h},b);
    assert(dx>=0&&dy>=0&&dx+dw<=384&&dy+dh<=384);assert.equal(dw/dh,w/h);
  }
});
test('invalid portrait frames do not sample another character or a world sprite', async () => {
  const {dialoguePortraitRect,drawDialoguePortrait}=await service(),image={naturalWidth:1774,naturalHeight:887};
  for(const frame of [null,{}, {columns:8,rows:4,index:-1},{columns:8,rows:4,index:32},{columns:8,rows:4,index:1.5},{columns:0,rows:4,index:0},{columns:'8',rows:4,index:0}]) {
    assert.equal(dialoguePortraitRect(image,frame),null);
    assert.equal(drawDialoguePortrait({drawImage(){assert.fail('Invalid frame was drawn');}},image,frame,384,384),false);
  }
  assert.equal(dialoguePortraitRect({naturalWidth:0,naturalHeight:0},{columns:8,rows:4,index:0}),null);
});
