const {Battle,Dex}=require('@pkmn/sim'),{make}=require('../../scripts/calibrateCorruptionRaids'),doubles=require('../../server/game/doubles/ruleset'),{RaidBattle}=require('../../server/game/raids/RaidBattle');
function arena(mode,ability,{species=143,owner=0}={}){
 const mons=Array.from({length:mode==='raid'?4:2},(_,i)=>make(i===owner?species:143,50,1,['Bite','Water Gun','Toxic','Splash'],i===owner?ability:'Keen Eye'));for(const p of mons)p.heldItem=null;
 const foe=make(143,50,1,['Bite','Water Gun','Toxic','Splash'],'Keen Eye');foe.heldItem=null;let sim;
 if(mode==='raid'){sim=new RaidBattle(mons.map((p,i)=>({ownerId:i+1,pokemon:p})),foe,{seed:[1,2,3,4],now:()=>1000}).sim;sim.raid.shieldsUsed=2;}
 else{sim=new Battle({format:doubles.dex.formats.get('riftmondoubles'),seed:[1,2,3,4]},doubles.dex);doubles.installStats(sim);sim.setPlayer('p1',{team:mons.map(doubles.teamSet)});const other=make(143,50,1,['Splash'],'Keen Eye');other.heldItem=null;sim.setPlayer('p2',{team:[foe,other].map(doubles.teamSet)});}
 for(const p of sim.getAllActive()){p.baseMaxhp=p.maxhp=p.hp=400;p.storedStats={atk:100,def:100,spa:100,spd:100,spe:100};p.m.friendUsed=true;}
 function move(name,p=sim.p2.active[0],target=sim.p1.active[0]){const m=sim.dex.moves.get(name);if(!p.moveSlots.some(s=>s.id===m.id))p.moveSlots.push({move:m.name,id:m.id,pp:m.pp,maxpp:m.pp,target:m.target,disabled:false,used:false});sim.actions.runMove(m.id,p,target?p.getLocOf(target):0);}
 return{sim,subject:sim.p1.active[owner],foe:sim.p2.active[0],allies:sim.p1.active,move};
}
module.exports={arena,Dex};
