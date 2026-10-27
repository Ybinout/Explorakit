const {badges}=require('../../../data/game/progression.json');
const config=Object.freeze({map:'route2_maison',outside:'route2',switch:{x:7,y:5},rift:{x:10,y:6},clone:{x:12,y:7},
    openingMs:8600,emergingMs:2800,closingMs:6200,awakeningMs:1800});
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
function interaction(player,p){
    if(player?.currentmap!==config.map)return null;const s=state(p);if(!s.unlocked)return null;
    if(s.stage==='sealed'&&distance(player,config.switch)<=1)return 'open';
    if(s.stage==='open'&&distance(player,config.rift)<=2)return 'emerge';
    if(s.stage==='clone'&&distance(player,config.clone)<=1)return 'battle';return null;
}
function blocked(map,x,y,p={}){if(map!==config.map)return false;const stage=p.flags?.[key(p,'stage')];if(!['open','clone','won'].includes(stage))return false;
    return(x===10&&y>=5&&y<=7)||(y===6&&x>=9&&x<=11)||(stage==='clone'&&x===config.clone.x&&y===config.clone.y);
}
module.exports={config,requiredBadges,endingBadges,replay,key,unlocked,state,interaction,blocked};
