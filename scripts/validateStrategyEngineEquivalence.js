// Published engine vs current engine, without calculator-only options.
const assert=require('node:assert/strict'),{execFileSync}=require('node:child_process'),Module=require('node:module'),path=require('node:path');
const filename=path.resolve(__dirname,'../server/game/battle/battleEngine.js'),m=new Module(filename,module);m.filename=filename;m.paths=module.paths;m._compile(execFileSync('git',['show','17102cb:server/game/battle/battleEngine.js'],{encoding:'utf8'}),filename);
const old=m.exports,next=require(filename),{make}=require('./calibrateCorruptionRaids');
const moves=['Tackle','Flamethrower','Thunderbolt','Earthquake','Surf','Ice Beam','Bullet Seed','Double Slap','Triple Kick','Psywave','Magnitude','Present','Dragon Rage','False Swipe','Knock Off','Superpower','Return','Foul Play','Psyshock','Drain Punch','Fake Out','Sucker Punch','Fly','Weather Ball','Hidden Power','Will-O-Wisp','Recover','Swords Dance','Protect','Future Sight'];
let cases=0;const random=Math.random;
try{for(const move of moves)for(const roll of [.01,.4,.99]){
 const source=make(34,100,4,[move],'Sheer Force'),target=make(143,150,4,['Tackle'],'Thick Fat');source.heldItem='life_orb';target.heldItem='sitrus_berry';
 function run(engine){Math.random=()=>roll;const[a,d]=structuredClone([source,target]),state=engine.createBattleState({battleType:'trainer'}),as=engine.createSideState(),ds=engine.createSideState();state.weather={kind:'rain',turns:4};const result=engine.useattack(move,a,d,{battleState:state,attackerSide:as,defenderSide:ds});const delayed=[];if(move==='Future Sight')for(let i=0;i<3;i++)delayed.push(engine.processEndOfRound(a,d,as,ds,state));return{result,delayed,hp:[a.currentHp,d.currentHp],status:[a.status,d.status],pp:a.movePp,items:[a.heldItem,d.heldItem],boosts:[a.__battle.statStages,d.__battle.statStages]};}
 assert.deepEqual(run(next),run(old),move+' @'+roll);cases++;
}}finally{Math.random=random;}
console.log(JSON.stringify({success:true,baseline:'17102cb',moves:moves.length,cases,liveDamageStatusesPpItemsAndBoostsIdentical:true}));
