const {dbPool,withTransaction}=require('../config/database');
const scene=require('../game/world/mirrorRift');
const {effectiveEndingBadges}=require('../game/world/endingBadges');
async function read(id,c=dbPool,lock=false){
    const [[owner]]=await c.execute('SELECT id,username,map,x,y,sprite FROM users WHERE id=?'+(lock?' FOR UPDATE':''),[id]);
    const[flags]=await c.execute('SELECT flag_key,flag_value FROM player_story_flags WHERE user_id=?',[id]);
    const[badges]=await c.execute('SELECT badge_key FROM player_badges WHERE user_id=?',[id]);
    const progress={flags:Object.fromEntries(flags.map(f=>[f.flag_key,f.flag_value])),badges:badges.map(b=>({key:b.badge_key,earned:true}))};
    progress.badges=effectiveEndingBadges(progress.badges,progress.flags,owner);
    return {owner,progress,state:scene.state(progress)};
}
async function flag(c,id,key,value){await c.execute('INSERT INTO player_story_flags(user_id,flag_key,flag_value)VALUES(?,?,?) ON DUPLICATE KEY UPDATE flag_value=VALUES(flag_value)',[id,key,String(value)]);}
async function advance(id,action,player){return withTransaction(async c=>{
    const r=await read(id,c,true);if(!r.owner||player?.userId!==id||!r.state.unlocked||scene.interaction(player,r.progress)!==action)return false;
    if(action==='open'){await flag(c,id,scene.key(r.progress,'stage'),'open');await flag(c,id,scene.key(r.progress,'ruined'),'true');}
    else if(action==='emerge'){
        await flag(c,id,scene.key(r.progress,'stage'),'clone');
        await flag(c,id,scene.key(r.progress,'appearance'),JSON.stringify({sprite:require('./playerRepository').sanitizeSpriteName(player.sprite)}));
    }else return false;
    return true;
});}
// No RPC exposes this operation: the authoritative battle's victory callback owns it.
async function win(id){return withTransaction(async c=>{const r=await read(id,c,true);if(!r.owner||!r.state.unlocked||r.state.stage!=='clone')return false;
    await flag(c,id,scene.key(r.progress,'stage'),'won');return true;
});}
async function completeWake(id){return withTransaction(async c=>{const r=await read(id,c,true);if(!r.owner||r.state.stage!=='won')return false;
    const home=scene.config.wake;
    await c.execute('UPDATE users SET map=?,x=?,y=? WHERE id=?',[home.map,home.x,home.y,id]);
    await flag(c,id,scene.key(r.progress,'stage'),'complete');return true;
});}
async function resetReplay(c,id){for(const[k,v]of Object.entries({replay:'true',stage:'sealed',ruined:'false',appearance:''}))await flag(c,id,'admin_mirror_'+k,v);}
module.exports={read,advance,win,completeWake,resetReplay};
