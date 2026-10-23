const { randomUUID } = require('node:crypto');
const { waterNear } = require('./fishingWaters');
const CAST_MS=650, REACTION_MS=1600, OFFER_MS=15000;
function createFishingController({ ownsRod, available, emit, onHook, now=Date.now, random=Math.random, setTimer=setTimeout, clearTimer=clearTimeout, nearWater=waterNear }) {
    const states=new WeakMap(), epochs=new WeakMap(), busy=new Set(), active=new Set(), cooldown=new WeakMap();
    const current=p=>states.get(p);
    const valid=(p,s)=>current(p)===s && available(p) && p.currentmap===s.map && p.x===s.origin.x && p.y===s.origin.y;
    function publish(p,s) { const {timer,expiresAt,...payload}=s; emit(p,'fishingState',{...payload,serverNow:now()}); }
    function cancel(p, message='') {
        epochs.set(p,(epochs.get(p)||0)+1);
        const s=current(p); if (!s) return false;
        clearTimer(s.timer);states.delete(p);active.delete(p);
        if(s.phase!=='offer')cooldown.set(p,now()+700);
        emit(p,'fishingState',{phase:'idle',message,serverNow:now()});return true;
    }
    function schedule(p,s,ms,fn) {
        clearTimer(s.timer);
        s.timer=setTimer(()=>{
            if(!valid(p,s)) { if(current(p)===s)cancel(p);return; }
            fn();
        },ms);s.timer?.unref?.();
    }
    async function offer(p) {
        if (current(p) || busy.has(p) || !available(p) || now()<(cooldown.get(p)||0)) return false;
        const water=nearWater(p); if (!water) return false;
        const epoch=epochs.get(p)||0, origin={x:p.x,y:p.y}, map=p.currentmap;
        busy.add(p);
        let owns;
        try { owns=await ownsRod(p); } finally { busy.delete(p); }
        if (!owns || epoch!==(epochs.get(p)||0) || !available(p) || p.currentmap!==map || p.x!==origin.x || p.y!==origin.y) return false;
        const s={id:randomUUID(),phase:'offer',map,origin,water:{x:water.x,y:water.y},direction:water.direction,startedAt:now(),expiresAt:now()+OFFER_MS};
        states.set(p,s);active.add(p);publish(p,s);schedule(p,s,OFFER_MS,()=>cancel(p));return true;
    }
    function start(p,id) {
        const s=current(p);
        if (!s || s.id!==id || s.phase!=='offer' || !valid(p,s) || now()>=s.expiresAt) { if(s&&!valid(p,s))cancel(p);return false; }
        p.direction=s.direction;
        s.phase='casting';s.startedAt=now();publish(p,s);
        schedule(p,s,CAST_MS,()=>{
            s.phase='waiting';s.startedAt=now();publish(p,s);
            schedule(p,s,2200+Math.floor(random()*3300),()=>{
                s.phase='bite';s.startedAt=now();s.deadline=now()+REACTION_MS;publish(p,s);
                schedule(p,s,REACTION_MS+150,()=>cancel(p,'Le poisson s’est échappé… Réessaie !'));
            });
        });return true;
    }
    function reel(p,id) {
        const s=current(p);
        if (!s || s.id!==id) return false;
        if(!valid(p,s)){cancel(p);return false;}
        if(s.phase==='offer')return start(p,id);
        if(s.phase==='hooked')return false;
        if(s.phase!=='bite') { cancel(p,'Trop tôt ! Attends le point d’exclamation avant de ferrer.');return false; }
        if(now()>s.deadline+150){cancel(p,'Trop tard… Le poisson s’est échappé !');return false;}
        s.phase='hooked';s.startedAt=now();publish(p,s);
        schedule(p,s,250,()=>{
            cancel(p);
            Promise.resolve().then(()=>onHook(p)).catch(error=>{
                console.error('Pêche :',error.message);
                emit(p,'fishingState',{phase:'idle',message:'Le poisson a filé. Tu peux réessayer.',serverNow:now()});
            });
        });return true;
    }
    function prune() { for(const p of active)if(!valid(p,current(p)))cancel(p); }
    function stop(){for(const p of new Set([...active,...busy]))cancel(p);}
    return {offer,start,reel,cancel,current,prune,stop};
}
module.exports={createFishingController,CAST_MS,REACTION_MS,OFFER_MS};
