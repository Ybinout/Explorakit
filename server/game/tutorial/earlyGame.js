const KEY='early_game_tutorial';
const PHASES=['wayne','grass','hp','potential','types','actions','attack','capture_info','capture','care','complete'];
const NEXT={hp:'potential',potential:'types',types:'actions',actions:'attack',capture_info:'capture',care:'complete'};
function initial(){return {version:1,phase:'wayne',metWayne:false,encounter:null};}
function parse(value){try{const s=typeof value==='string'?JSON.parse(value):value;return s?.version===1&&PHASES.includes(s.phase)?s:null;}catch{return null;}}
function state(progress){return parse(progress?.flags?.[KEY]);}
function active(s){return !!s&&s.phase!=='complete'&&s.phase!=='care';}
function view(s){return s?{...s,enabled:true,grassHint:s.metWayne&&['wayne','grass'].includes(s.phase),grassTiles:s.metWayne&&['wayne','grass'].includes(s.phase)?grassTiles():[]}:{enabled:false,phase:'complete'};}
function wayneDialogue(progress){const s=state(progress);if(!s||s.phase==='complete'&&s.metWayne)return null;return !s.metWayne?'wayne_training':'wayne_practice';}
function grassTiles(){const grid=require('../world/mapRepository').battleMapData('start');return grid.flatMap((row,y)=>row.flatMap((v,x)=>v?[{x,y}]:[]));}
module.exports={KEY,PHASES,NEXT,initial,parse,state,active,view,wayneDialogue,grassTiles};
