const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),{execFileSync}=require('node:child_process');
const touch=()=>import('../vue-explorakit/src/services/touchAction.js');
const e=(type,timeStamp,x=100,y=100,rest={})=>({type,timeStamp,clientX:x,clientY:y,pointerId:1,pointerType:'touch',isPrimary:true,...rest});
test('two stationary touches trigger exactly one action; releasing capture preserves the first tap',async()=>{
 const {TouchAction}=await touch(),t=new TouchAction();
 t.start(e('pointerdown',0),'start');assert(!t.end(e('pointerup',70),'start'));assert(!t.end(e('lostpointercapture',71),'start'));
 t.start(e('pointerdown',190,103,101),'start');assert(t.end(e('pointerup',250,103,101),'start'));assert(!t.end(e('lostpointercapture',251),'start'));
 t.start(e('pointerdown',310),'start');assert(!t.end(e('pointerup',350),'start'));
});
test('swipes, returning to origin, long touches, distant/late taps, cancellation, mouse and blocked UI do not perform Action',async()=>{
 const {TouchAction}=await touch();
 for(const kind of['swipe','long','distant','late','cancel','mouse','blocked','context','multitouch']){
  const t=new TouchAction();t.start(e('pointerdown',0),'a');assert(!t.end(e('pointerup',50),'a'));
  t.start(e('pointerdown',kind==='late'?500:150,kind==='distant'?180:100,100,kind==='mouse'?{pointerType:'mouse'}:{}),'a',kind!=='blocked');
  if(kind==='swipe')t.move(e('pointermove',170,120));
  if(kind==='multitouch')t.start(e('pointerdown',170,100,100,{pointerId:2,isPrimary:false}),'a');
  assert(!t.end(e(kind==='cancel'?'pointercancel':'pointerup',kind==='late'?550:kind==='long'?600:230,kind==='distant'?180:100),kind==='context'?'b':'a',kind!=='blocked'),kind);
 }
});
test('map and dialogue action route is separate from UI buttons and existing movement remains native',()=>{
 const s=fs.readFileSync('vue-explorakit/src/components/UserMap.vue','utf8');
 assert(s.includes('if (action) this.triggerMobileActionA()'));assert(s.includes('moveTouchGesture(gesture, event.clientX, event.clientY)'));assert(s.includes("'button,input,select,textarea,a,[contenteditable]'"));
});
test('new mist has broad overlapping wisps with bounded work; original island clouds and projection are unchanged',async()=>{
 const file='vue-explorakit/src/services/darkContinentMist.js',source=fs.readFileSync(file,'utf8'),old=execFileSync('git',['-C','vue-explorakit','show','bb894047d8077c3b4de62d64ad58c27a133960d9:src/services/darkContinentMist.js'],{encoding:'utf8'});
 assert.equal(source.split('  paintNew(')[0],old.split('  paintNew(')[0]);
 const {DarkContinentMist}=await import('../'+file);const fog=new DarkContinentMist();fog.cloud={};fog.grade={};
 const count=map=>{let n=0;const c={save(){},restore(){},fillRect(){},drawImage(){n++;}};fog.paint(c,map,20,true);return n;};
 assert(count('DC2_44')>count('jungle5')*2);
 for(let n=1;n<=48;n++){const calls=count('DC2_'+String(n).padStart(2,'0'));assert(calls>20&&calls<110,`${n}: ${calls}`);}
});
test('new continent wild/final raid backgrounds are distinct, legacy and fishing destinations retained',async()=>{
 const {battleEnvironment:b}=await import('../vue-explorakit/src/services/battleEnvironment.js');
 for(let n=1;n<=48;n++){const map='DC2_'+String(n).padStart(2,'0');assert.equal(b(map),'dark-continent2');assert.equal(b(map,false,null,'lake'),'lake');}
 assert.equal(b('jungle9'),'dark-jungle');assert.equal(b('route1'),'grass');
 let source=fs.readFileSync('vue-explorakit/src/services/darkBattleBackgrounds.js','utf8').replaceAll('export ','');
 const keys=vm.runInNewContext(source+';darkBattleBackgroundKey',{require:()=>''});
 assert.equal(keys('DC2_04',true),'dark-pyramid');assert.equal(keys('DC2_04'),'dark-continent2');assert.equal(keys('jungle9',true),'dark-jungle');assert.equal(keys(), 'dark-jungle');
 const art=require('../vue-explorakit/src/assets/battle/dark-continent2-atmosphere-art-v1.json');assert.equal(art.assets.length,4);
 for(const a of art.assets)assert(fs.statSync('vue-explorakit/'+a.target).size>10000);
});
test('berry matching the requested Normal/Speed/Defense tradeoff does not exist; closest recipe and rarity verified',()=>{
 const rules=require('../server/game/berries/rules'),items=require('../data/game/items.json').items;
 const result=rules.recipe(['corrupted_petaya_berry','corrupted_rawst_berry','corrupted_tanga_berry']);assert.equal(result.family,'offense_normal');
 const berry=items.find(i=>i.key==='mutant_offense_normal_legendary_berry');assert(berry.description.includes('30 %'));assert(berry.description.includes('Défense'));assert(berry.description.includes('25 %'));
});
