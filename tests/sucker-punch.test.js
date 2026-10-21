const test=require('node:test'),assert=require('node:assert/strict');
const engine=require('../server/game/battle/battleEngine'),{planTurnActions}=require('../server/game/battle/turnActions');
const factory=require('../server/game/drift/pokemonFactory'),resources=require('../server/game/battle/battleResources');
const {DriftBattle}=require('../server/game/drift/driftBattle'),{encode,decode}=require('../server/game/drift/checkpointCodec');
function mon(moves=['Sucker Punch']){const p=factory.create(19,25,true);p.passiveAbility=null;p.abilities=moves;p.movePp=moves.map(resources.getMaxMovePp);p.maxHp=p.currentHp=1000;return p;}
function hit(a,b,f,name='Sucker Punch'){return engine.useattack(name,a,b,{battleState:f,attackerSide:f.sides.player,defenderSide:f.sides.enemy,attackerTeam:[a],defenderTeam:[b]});}
function plan(f,a,b,moveName,action='attack'){planTurnActions(f,[{pokemon:a,action:'attack',moveName:'Sucker Punch'},{pokemon:b,action,moveName}]);}
function fixed(work){const before=Math.random;try{Math.random=()=>.5;return work();}finally{Math.random=before;}}

test('Coup Bas succeeds only against a pending damaging move (including charge/fixed damage and Me First)',()=>fixed(()=>{
 for(const name of ['Tackle','Counter','Solar Beam','Me First']){const a=mon(),b=mon([name]),f=engine.createBattleState();plan(f,a,b,name);const r=hit(a,b,f);assert(r.damage>0,name);assert.equal(a.movePp[0],4);}
 const a=mon(),b=mon(['Growl']),f=engine.createBattleState();b.movePp=[0];plan(f,a,b,'Growl');assert(hit(a,b,f).damage>0,'a PP-exhausted status selection actually becomes Struggle');
 for(const [action,name]of [['attack','Growl'],['attack','Protect'],['attack','Sleep Talk'],['change','Tackle'],['bag','Tackle']]){const a=mon(),b=mon([name]),f=engine.createBattleState();plan(f,a,b,name,action);const r=hit(a,b,f);assert.equal(r.damage,0,action+'/'+name);assert(r.blocked);assert.match(r.messages.join(' '),/Coup Bas échoue/);assert.equal(a.movePp[0],4);}
}));
test('a spent, interrupted, replaced or stale opposing action cannot trigger Coup Bas; two Coup Bas respect order',()=>fixed(()=>{
 for(const blocked of [false,true]){const a=mon(),b=mon(['Tackle']),f=engine.createBattleState();plan(f,a,b,'Tackle');if(blocked)b.status='sleep';hit(b,a,f,'Tackle');assert.equal(hit(a,b,f).damage,0);}
 const a=mon(),b=mon(['Tackle']),f=engine.createBattleState();plan(f,a,b,'Tackle');assert.equal(hit(a,mon(['Tackle']),f).damage,0);plan(f,a,b,'Tackle');f.turn++;engine.ensureBattleData(b).lastMoveUsed='Tackle';assert.equal(hit(a,b,f).damage,0);
 const c=mon(),d=mon(),g=engine.createBattleState();plan(g,c,d,'Sucker Punch');assert(hit(c,d,g).damage>0);assert.equal(hit(d,c,g).damage,0);
 const e=mon(),h=mon(['Extreme Speed']),field=engine.createBattleState();plan(field,e,h,'Extreme Speed');const ordered=engine.orderBattleActions([{pokemon:e,moveName:'Sucker Punch'},{pokemon:h,moveName:'Extreme Speed'}],field);assert.equal(ordered[0].pokemon,h);hit(h,e,field,'Extreme Speed');assert.equal(hit(e,h,field).damage,0);
}));
for(const mode of ['rift','colosseum'])for(const opposing of ['Tackle','Growl','switch'])test(`${mode}: real action queue and checkpoint preserve Coup Bas conditions against ${opposing}`,()=>fixed(()=>{
 const a={userId:1,run:{mode},equipe:{pokemons:[mon()]},drifts:[],equipped:[],items:{},money:0,defeated:new Set()},b={userId:2,equipe:{pokemons:[mon([opposing==='switch'?'Tackle':opposing]),mon(['Tackle'])]},drifts:[],equipped:[],items:{},money:0,defeated:new Set()},events=[];
 const original=new DriftBattle(a,b,{type:'pvp',random:()=>.5,paceMs:0,emit:(_p,name,payload)=>events.push({name,payload})});
 const battle=decode(encode(original));battle.emit=(_p,name,payload)=>events.push({name,payload});battle.random=()=>.5;battle.now=()=>0;
 battle.action(battle.a,{action:'attack',number:0,turnId:battle.token});battle.action(battle.b,{action:opposing==='switch'?'change':'attack',number:opposing==='switch'?1:0,turnId:battle.token});
 const result=events.find(e=>e.name==='battleMoveResult'&&e.payload.actor==='player'&&e.payload.moveName==='Sucker Punch');assert(result);assert.equal(result.payload.damage>0,opposing==='Tackle');assert.equal(battle.a.equipe.pokemons[0].movePp[0],4);
}));
