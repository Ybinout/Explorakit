const test=require('node:test'),assert=require('node:assert/strict');
function host(){const listeners=new Set(),h={location:{href:'https://game.test/game'},addEventListener:(_,fn)=>listeners.add(fn),removeEventListener:(_,fn)=>listeners.delete(fn)},entries=[{state:{key:'router-base'},url:h.location.href}];let index=0;
 h.history={get state(){return entries[index].state;},pushState(state,_title,url){entries.splice(index+1);entries.push({state,url});index++;h.location.href=url;},back(){setImmediate(()=>{if(!index)return;index--;h.location.href=entries[index].url;for(const l of listeners)l({state:entries[index].state});});}};return h;}
async function settle(){for(let n=0;n<5;n++)await new Promise(r=>setImmediate(r));}
test('Back closes the latest window, then its parent, without leaving the route or stacking synthetic pages',async()=>{
 const{OverlayBackStack}=await import('../vue-explorakit/src/services/overlayBackStack.js'),h=host(),s=new OverlayBackStack(h),closed=[];let parent=true,child=true,dropParent,dropChild;
 dropParent=s.add(()=>{closed.push('bag');parent=false;dropParent();},()=>parent);dropChild=s.add(()=>{closed.push('detail');child=false;dropChild();},()=>child);
 h.history.back();await settle();assert.deepEqual(closed,['detail']);assert(parent&&!child);assert.equal(h.location.href,'https://game.test/game');assert.equal(s.entries.length,1);
 h.history.back();await settle();assert.deepEqual(closed,['detail','bag']);assert.equal(s.entries.length,0);assert.equal(h.history.state.key,'router-base');assert(!s.armed);s.destroy();
});
test('manual closes, replacing one window with another, and removing an underlying window do not consume the next actual Back',async()=>{
 const{OverlayBackStack}=await import('../vue-explorakit/src/services/overlayBackStack.js'),h=host(),s=new OverlayBackStack(h);let count=0,open=true,drop=s.add(()=>{count++;open=false;drop();},()=>open);drop();let fresh=true,dropFresh=s.add(()=>{count++;fresh=false;dropFresh();},()=>fresh);await settle();assert.equal(count,0);h.history.back();await settle();assert.equal(count,1);assert(!s.armed);
 let top=true;const bottom=s.add(()=>assert.fail('closed underneath'));let release=s.add(()=>{count++;top=false;release();},()=>top);bottom();h.history.back();await settle();assert.equal(count,2);assert.equal(s.entries.length,0);s.destroy();
});
test('an asynchronous close which fails or stays busy retains the window and consumes no normal navigation',async()=>{
 const{OverlayBackStack}=await import('../vue-explorakit/src/services/overlayBackStack.js'),h=host(),s=new OverlayBackStack(h);let calls=0,open=true;const release=s.add(async()=>{calls++;if(calls===1)throw Error('save failed');open=false;release();},()=>open);h.history.back();await settle();assert(open);assert.equal(calls,1);assert(s.armed);h.history.back();await settle();assert(!open);assert.equal(calls,2);assert.equal(s.entries.length,0);s.destroy();
});
test('a reload cleans its old same-URL sentinel and never closes a newly mounted window as stale history drains',async()=>{
 const{OverlayBackStack}=await import('../vue-explorakit/src/services/overlayBackStack.js'),h=host();h.history.pushState({riftmonOverlay:'previous-page'},'',h.location.href);const s=new OverlayBackStack(h);let open=true,release=s.add(()=>{open=false;release();},()=>open);await settle();assert(open&&s.armed);h.history.back();await settle();assert(!open);s.destroy();
});
