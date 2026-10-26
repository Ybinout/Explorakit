const test = require('node:test'), assert = require('node:assert/strict');
const daylight = () => import('../vue-explorakit/src/services/worldDaylight.js');
const stamp = text => Date.parse(text);
test('Paris real day: morning, day, sunset, night, midnight and DST remain continuous', async () => {
    const { daylightAt } = await daylight();
    for (const offset of ['+02:00', '+01:00']) {
        const date = offset === '+02:00' ? '2026-07-10' : '2026-12-10';
        for (const [time, phase, night] of [['05:00:00','night',1],['06:00:00','dawn',1],
            ['07:00:00','dawn',.32],['12:00:00','day',0],['17:00:00','dusk',0],['17:30:00','dusk',.4],['18:00:00','night',1],['20:00:00','night',1],['23:00:00','night',1]]) {
            const actual = daylightAt(stamp(`${date}T${time}${offset}`));
            assert.equal(actual.phase, phase); assert.equal(actual.night, night);
        }
    }
    const from = stamp('2026-10-24T00:00:00Z'); let before = daylightAt(from);
    for (let seconds = 1; seconds <= 86400; seconds++) {
        const current = daylightAt(from + seconds * 1000);
        for (const key of ['night','warmth','lamps']) {
            assert(current[key] >= 0 && current[key] <= 1); assert(Math.abs(current[key] - before[key]) < .002);
        }
        before = current;
    }
    for (const date of ['2026-10-25','2026-03-29']) {
        assert.deepEqual(daylightAt(stamp(date+'T00:59:59Z')),daylightAt(stamp(date+'T01:00:00Z')));
    }
});
test('server clock overrides wrong device time and compensates latency without trusting browser timezone', async () => {
    const { WorldClock, daylightAt } = await daylight(), clock = new WorldClock(1000, 10);
    const serverTime = stamp('2026-10-24T21:00:00Z');
    assert(clock.sync({serverTime,timeZone:'Europe/Paris'},110,10));
    assert.equal(clock.now(210),serverTime + 150); assert.equal(daylightAt(clock.now(210)).phase,'night');
    const before = clock.now(210);
    for (const payload of [{serverTime:NaN,timeZone:'Europe/Paris'},{serverTime:0,timeZone:'Europe/Paris'},
        {serverTime,timeZone:'UTC'}]) assert(!clock.sync(payload,210));
    assert(!clock.sync({serverTime,timeZone:'Europe/Paris'},20000,0)); assert.equal(clock.now(210),before);
});
test('clock binding pauses hidden ticks, resyncs on return and ignores late acknowledgements after disposal', async () => {
    const {WorldClock,bindWorldClock}=await daylight(),listeners=new Map(),events=new Map(),timers=new Set(),replies=[];
    const saved={document:global.document,setTimeout:global.setTimeout,clearTimeout:global.clearTimeout};
    global.document={hidden:false,addEventListener:(e,fn)=>listeners.set(e,fn),removeEventListener:e=>listeners.delete(e)};
    global.setTimeout=fn=>{timers.add(fn);return fn;};global.clearTimeout=fn=>timers.delete(fn);
    const socket={connected:true,on:(e,fn)=>events.set(e,fn),off:e=>events.delete(e),timeout(){return this;},emit:(_e,fn)=>replies.push(fn)};
    let updates=0;
    try {
        const dispose=bindWorldClock(socket,new WorldClock(),()=>updates++);
        assert.equal(timers.size,1);assert.equal(replies.length,1);
        document.hidden=true;listeners.get('visibilitychange')();assert.equal(timers.size,0);
        document.hidden=false;listeners.get('visibilitychange')();assert.equal(timers.size,1);assert.equal(replies.length,2);
        events.get('connect')();assert.equal(replies.length,3);
        dispose();const before=updates;for(const reply of replies)reply(null,{serverTime:Date.now(),timeZone:'Europe/Paris'});
        assert.equal(updates,before);assert.equal(timers.size,0);assert.equal(listeners.size,0);assert.equal(events.size,0);
    } finally {Object.assign(global,saved);}
});
test('both namespaces expose a read-only timestamp: payload cannot select the world time', () => {
    const {registerWorldClock} = require('../server/realtime/worldClock');
    const calls=[],handlers={}; const socket={emit:(...args)=>calls.push(args),on:(key,fn)=>handlers[key]=fn};
    registerWorldClock(socket,()=>123456789);
    assert.deepEqual(calls,[['worldClockState',{serverTime:123456789,timeZone:'Europe/Paris',cycle:'real-day'}]]);
    handlers['worldClock:sync']({serverTime:9}); let state; handlers['worldClock:sync'](value=>state=value);
    assert.equal(state.serverTime,123456789);
});
test('every current outdoor region follows the cycle, while all indoor/cave/arena locations keep their own light', async () => {
    const {outdoorMap,townLights}=await import('../vue-explorakit/src/data/nightLights.js');
    const {nodes}=require('../data/game/region_map.json');
    for(const node of nodes) assert.equal(outdoorMap(node.id),node.kind!=='cave',node.id);
    for(const map of ['centre','maison','maison2','route2_maison','tour_rdc','tour_etage2','ville5_arene','ville1_shop','ville4_maison1','gen_arene1',null,'__proto__']) assert(!outdoorMap(map),map);
    for(const node of nodes.filter(n=>n.kind==='town')) assert(Object.hasOwn(townLights,node.id),node.id+' has authored night lights');
    for(const profile of Object.values(townLights)) for(const [x,y]of [...profile.windows||[],...profile.lamps||[]]) assert(x>=0&&y>=0&&x<448&&y<320);
});
test('fireflies stay inside actual green grass, pulse with rests, and stop in daylight, reduced motion or storms', async () => {
    const {firefliesAt}=await import('../vue-explorakit/src/services/worldNight.js');
    const {default:grass}=await import('../vue-explorakit/src/data/worldGrass.js');
    const light={night:1,lamps:1,warmth:0}; let found=0; const populations=new Set();
    for(let t=0;t<106000;t+=500) {
        const motes=firefliesAt('route4',t,light); populations.add(motes.length); assert(motes.length<=9);
        for(const p of motes) { found++; assert(grass.route4.some(([cell])=>cell===p.cell));
            assert(Math.abs(p.x-(p.cell%28*16+8))<=5);assert(Math.abs(p.y-(Math.floor(p.cell/28)*16+8))<=3);
            assert(p.alpha>=0&&p.alpha<=1);
        }
        for(const weather of [{rain:3},{wind:3},{sand:1},{snow:1}]) assert.deepEqual(firefliesAt('route4',t,light,weather),[]);
        assert.deepEqual(firefliesAt('route4',t,light,{},false),[]);
        assert.deepEqual(firefliesAt('route4',t,{night:0}),[]);
        assert.deepEqual(firefliesAt('ville5_arene',t,light),[]);
    }
    assert(found>100); assert(populations.size>2);
});
test('night renderer caches lighting, limits animation, clears in daytime/interiors and releases surfaces', async () => {
    const {WorldNightRenderer}=await import('../vue-explorakit/src/services/worldNight.js');
    const surfaces=[];const create=()=>{const ctx={};for(const name of ['save','restore','clearRect','fillRect','translate','scale','drawImage'])ctx[name]=()=>{};
        for(const name of ['createRadialGradient','createLinearGradient'])ctx[name]=()=>({addColorStop(){}});
        const c={width:0,height:0,getContext:()=>ctx};surfaces.push(c);return c;};
    const renderer=new WorldNightRenderer(create),target={drawImage(){}};const night={night:1,lamps:1,warmth:0};
    renderer.draw(target,'ville5',1000,night,{},false);const frames=renderer.frames;
    renderer.draw(target,'ville5',6000,night,{},false);assert.equal(renderer.frames,frames);assert.equal(renderer.paints,1);
    renderer.draw(target,'ville5',6050,{...night,night:.8},{},false);assert.equal(renderer.paints,2);
    renderer.draw(target,'route4',7000,night);const f=renderer.frames;renderer.draw(target,'route4',7010,night);assert.equal(renderer.frames,f);
    renderer.draw(target,'route4',7051,night);assert.equal(renderer.frames,f+1);
    renderer.draw(target,'route4',7100,{night:0,lamps:0,warmth:0});assert.equal(renderer.canvas,null);
    renderer.draw(target,'cave1',7200,night);assert.equal(renderer.canvas,null);
    renderer.destroy(); assert(surfaces.every(s=>s.width===0&&s.height===0));renderer.draw(target,'route4',7300,night);assert.equal(renderer.canvas,null);
});
