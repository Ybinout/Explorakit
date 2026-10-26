const test = require('node:test');
const assert = require('node:assert/strict');
const service = () => import('../vue-explorakit/src/services/gamepad.js');
function pad(pressed = [], axes = [0, 0]) {
  return { index: 0, connected: true, mapping: 'standard', id: 'AYN Thor test', axes,
    buttons: Array.from({length: 17}, (_, i) => ({pressed: pressed.includes(i), value: pressed.includes(i) ? 1 : 0})) };
}
test('standard buttons, swapped face labels and sparse browser arrays', async () => {
  const {readGamepad} = await service();
  assert(readGamepad(pad([0])).confirm); assert(readGamepad(pad([1])).back);
  assert(readGamepad(pad([1]), 'nintendo').confirm); assert(readGamepad(pad([0]), 'nintendo').back);
  assert(readGamepad(pad([2])).team); assert(readGamepad(pad([3])).bag);
  assert(readGamepad(pad([3]), 'nintendo').team); assert(readGamepad(pad([2]), 'nintendo').bag);
  for (const [index, action] of [[9,'menu'],[4,'previous'],[5,'next']]) assert(readGamepad(pad([index]))[action]);
  assert.equal(readGamepad({buttons:[],axes:[]}).direction,null);
  assert.equal(readGamepad(null).confirm,false);
});
test('stick dead zone, hysteresis, D-pad precedence, opposite directions and invalid axes', async () => {
  const {readGamepad} = await service();
  assert.equal(readGamepad(pad([], [.34,.1])).direction,null);
  assert.equal(readGamepad(pad([], [.36,.1])).direction,'right');
  assert.equal(readGamepad(pad([], [.27,.1]),'standard','right').direction,'right');
  assert.equal(readGamepad(pad([], [.22,.1]),'standard','right').direction,null);
  assert.equal(readGamepad(pad([], [.7,-.9])).direction,'up');
  assert.equal(readGamepad(pad([13], [.9,0])).direction,'down');
  assert.equal(readGamepad(pad([12,13])).direction,null);
  assert.equal(readGamepad(pad([], [NaN,Infinity])).direction,null);
  for (const [button,direction] of [[12,'up'],[13,'down'],[14,'left'],[15,'right']]) assert.equal(readGamepad(pad([button])).direction,direction);
});
test('A only fires on a rising edge; directions repeat for menus but neutral stops immediately', async () => {
  const {GamepadReader} = await service(), events = [], r = new GamepadReader(e => events.push(e));
  r.update(pad(),0); r.update(pad([0,15]),10); r.update(pad([0,15]),100); r.update(pad([0,15]),329);
  assert.deepEqual(events,[{action:'direction',direction:'right',repeat:false},{action:'confirm'}]);
  r.update(pad([0,15]),330); r.update(pad([0,15]),440);
  assert.equal(events.filter(e=>e.repeat).length,2); assert.equal(events.filter(e=>e.action==='confirm').length,1);
  r.update(pad(),450); assert.deepEqual(events.at(-1),{action:'direction',direction:null,repeat:false});
  r.update(pad([0]),460); assert.equal(events.filter(e=>e.action==='confirm').length,2);
});
test('held controls cannot activate a new page or resume after blur / unplug without a release', async () => {
  const {GamepadReader} = await service(), events = [], r = new GamepadReader(e => events.push(e));
  r.update(pad([0,12]),0); r.update(pad([0,12]),500); assert.deepEqual(events,[]);
  r.update(pad(),510); r.update(pad([12]),520); r.reset();
  assert.deepEqual(events.at(-1),{action:'direction',direction:null}); const count=events.length;
  r.update(pad([0,12]),600); r.update(pad([0,12]),900); assert.equal(events.length,count);
  r.update(pad(),910); r.update(pad([0]),920); assert.deepEqual(events.at(-1),{action:'confirm'});
});
test('old preferences keep controller support, invalid settings normalize and an explicit opt-out persists', async () => {
  const {normalizeGamePreferences} = await import('../vue-explorakit/src/services/gamePreferences.js');
  assert.equal(normalizeGamePreferences({}).controllerEnabled,true);
  assert.equal(normalizeGamePreferences({controllerLayout:'random'}).controllerLayout,'standard');
  const p = normalizeGamePreferences({controllerEnabled:false,controllerLayout:'nintendo',themeMode:'dark',masterVolume:20});
  assert.equal(p.controllerEnabled,false); assert.equal(p.controllerLayout,'nintendo'); assert.equal(p.themeMode,'dark'); assert.equal(p.masterVolume,20);
});
test('browser reader is dormant without a pad, pauses while hidden and removes its loops/listeners', async () => {
  const {startGamepadControls,PREFERENCES_EVENT,GAMEPAD_EVENT}=await service();
  const keys=['window','document','navigator','requestAnimationFrame','cancelAnimationFrame','setTimeout','clearTimeout'];
  const saved=Object.fromEntries(keys.map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)]));
  const frames=new Map(),timers=new Map(),events=[];let serial=0,pads=[];
  const w=new EventTarget(),d=new EventTarget();d.hidden=false;d.hasFocus=()=>true;
  const set=(key,value)=>Object.defineProperty(globalThis,key,{configurable:true,writable:true,value});
  try{
    set('window',w);set('document',d);set('navigator',{getGamepads:()=>pads});
    set('requestAnimationFrame',fn=>{frames.set(++serial,fn);return serial;});
    set('cancelAnimationFrame',id=>frames.delete(id));set('setTimeout',fn=>{timers.set(++serial,fn);return serial;});set('clearTimeout',id=>timers.delete(id));
    w.addEventListener(GAMEPAD_EVENT,e=>events.push(e.detail));
    const controller=startGamepadControls({isConnected:false,querySelectorAll:()=>[]},{});
    assert.equal(frames.size,0);assert.equal(timers.size,1);
    pads=[pad()];w.dispatchEvent(new Event('gamepadconnected'));assert.equal(frames.size,1);assert.equal(timers.size,0);
    function step(time){const[id,fn]=frames.entries().next().value;frames.delete(id);fn(time);}
    pads=[pad([15])];step(100);assert.equal(events.at(-1).direction,'right');
    w.dispatchEvent(new Event('blur'));assert.equal(frames.size,0);assert.equal(events.at(-1).direction,null);
    const count=events.length;w.dispatchEvent(new Event('focus'));step(200);assert.equal(events.length,count);
    pads=[pad()];step(210);pads=[pad([12])];step(220);assert.equal(events.at(-1).direction,'up');
    d.hidden=true;d.dispatchEvent(new Event('visibilitychange'));assert.equal(frames.size,0);assert.equal(timers.size,0);assert.equal(events.at(-1).direction,null);
    pads=[pad()];d.hidden=false;d.dispatchEvent(new Event('visibilitychange'));assert.equal(frames.size,1);
    w.dispatchEvent(new CustomEvent(PREFERENCES_EVENT,{detail:{controllerEnabled:false}}));assert.equal(frames.size,0);assert.equal(timers.size,1);
    controller.destroy();assert.equal(frames.size,0);assert.equal(timers.size,0);
    w.dispatchEvent(new Event('gamepadconnected'));w.dispatchEvent(new Event('focus'));d.dispatchEvent(new Event('visibilitychange'));
    assert.equal(frames.size,0);assert.equal(timers.size,0);
    delete navigator.getGamepads;
    const unsupported=startGamepadControls({isConnected:false,querySelectorAll:()=>[]},{});
    assert.equal(frames.size,0);assert.equal(timers.size,0);unsupported.destroy();
  }finally{for(const key of keys){if(saved[key])Object.defineProperty(globalThis,key,saved[key]);else delete globalThis[key];}}
});
