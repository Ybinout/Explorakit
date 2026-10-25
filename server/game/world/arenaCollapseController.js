const rules = require('./arenaCollapse');
function createArenaCollapseController({getPlayer,loadStart,emit,rescue,collision,occupied,now=Date.now,setTimer=setTimeout,clearTimer=clearTimeout}) {
    let startedAt = null, timer = null, generation = 0, disposed = false;
    function clear() { if (timer !== null) clearTimer(timer);timer = null; }
    function active() { return !disposed && getPlayer()?.currentmap === rules.config.map; }
    function publish() {
        if (!active() || startedAt === null) return;
        const p = getPlayer(), time = now();
        if (rules.blocked(startedAt,Math.floor(p.x/32),Math.floor(p.y/32),time)) {
            const safe = rules.safeTile(p,collision(),startedAt,time,occupied);
            if (safe) rescue(p,safe);
        }
        emit(rules.snapshot(startedAt,time));
        clear();
        const next = rules.config.holes.map(h => h.atMs-rules.elapsed(startedAt,time)).filter(n => n>0).sort((a,b)=>a-b)[0];
        if (next !== undefined) { timer=setTimer(publish,next+2);timer?.unref?.(); }
    }
    async function enter() {
        const token = ++generation;clear();startedAt=null;
        if (!active()) { emit(null);return; }
        const start = await loadStart();
        if (token !== generation || !active()) return;
        startedAt=start;publish();
    }
    function blocked(x,y) { return active() && (startedAt === null || rules.blocked(startedAt,x,y,now())); }
    function stop() { disposed=true;generation++;clear();startedAt=null; }
    return {enter,blocked,stop};
}
module.exports = { createArenaCollapseController };
