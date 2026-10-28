const {badges}=require('../../../data/game/progression.json');
const config=Object.freeze({map:'route2_maison',outside:'route2',switch:{x:7,y:5,width:2,height:2},rift:{x:13,y:10},clone:{x:13,y:13},
    wake:{map:'etage',x:592,y:336},openingMs:8000,emergingMs:2800,closingMs:6200,awakeningMs:1800});
const requiredBadges=badges.filter(b=>!b.exclusiveGroup&&b.countsForCapture!==false&&!b.hidden).map(b=>b.key);
const endingBadges=['violence_badge','pardon_badge'];
const stages=new Set(['sealed','open','clone','won','complete']);
function replay(p={}){return p.flags?.admin_mirror_replay==='true';}
function key(p,name){return(replay(p)?'admin_mirror_':'mirror_')+name;}
function unlocked(p={}){const earned=new Set((p.badges||[]).filter(b=>b.earned).map(b=>b.key));return requiredBadges.every(k=>earned.has(k))&&endingBadges.some(k=>earned.has(k));}
function state(p={}){
    const raw=p.flags?.[key(p,'stage')],stage=stages.has(raw)?raw:'sealed';let appearance=null;
    try{const a=JSON.parse(p.flags?.[key(p,'appearance')]||'null');if(a&&require('../../persistence/playerRepository').sanitizeSpriteName(a.sprite)===a.sprite)appearance={sprite:a.sprite};}catch{}
    return {map:config.map,unlocked:unlocked(p),stage,replay:replay(p),ruined:p.flags?.[key(p,'ruined')]==='true',appearance,rift:config.rift,clone:config.clone};
}
function distance(p,t){return Math.abs(Math.floor(p.x/32)-t.x)+Math.abs(Math.floor(p.y/32)-t.y);}
function riftCell(x,y){const dx=Math.abs(x-config.rift.x),dy=Math.abs(y-config.rift.y);return(dy<=1&&dx<=1)||(dy===0&&dx===2);}
function besideRift(player){
    const x=Math.floor(player.x/32),y=Math.floor(player.y/32);
    if(riftCell(x,y))return false;
    // The solid tear is wider than its centre tile. Every accessible edge and
    // corner can be used, without requiring the player to face the front.
    for(let dx=-1;dx<=1;dx++)for(let dy=-1;dy<=1;dy++)if(riftCell(x+dx,y+dy))return true;
    return false;
}
function besideBookshelf(player){
    const x=Math.floor(player.x/32),y=Math.floor(player.y/32),s=config.switch;
    const dx=Math.max(s.x-x,0,x-(s.x+s.width-1)),dy=Math.max(s.y-y,0,y-(s.y+s.height-1));
    return dx+dy===1;
}
function interaction(player,p){
    if(player?.currentmap!==config.map)return null;const s=state(p);if(!s.unlocked)return null;
    if(s.stage==='sealed'&&besideBookshelf(player))return 'open';
    if(s.stage==='open'&&besideRift(player))return 'emerge';
    if(s.stage==='clone'&&(besideRift(player)||distance(player,config.clone)<=1))return 'battle';return null;
}
function blocked(map,x,y,p={}){if(map!==config.map)return false;const stage=p.flags?.[key(p,'stage')];if(!['open','clone','won','complete'].includes(stage))return false;
    return riftCell(x,y)||(stage==='clone'&&x===config.clone.x&&y===config.clone.y);
}
module.exports={config,requiredBadges,endingBadges,replay,key,unlocked,state,interaction,blocked};
