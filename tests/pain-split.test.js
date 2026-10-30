const test=require('node:test'),assert=require('node:assert/strict');
const e=require('../server/game/battle/battleEngine'),ai=require('../server/game/battle/humanTrainerAI'),model=require('../server/game/battle/humanTrainerModel');
const {DriftBattle}=require('../server/game/drift/driftBattle'),factory=require('../server/game/drift/pokemonFactory');
const resources=require('../server/game/battle/battleResources');
let serial=0;
function mon(props={},moves=['Pain Split','Splash']){return Object.assign(factory.create(19,50,true),{
 uuid:'pain-'+(++serial),name:'Test',truename:'Test',level:50,type1:'Normal',type2:null,maxHp:200,currentHp:40,
 attack:100,defense:100,specialAttack:100,specialDefense:100,speed:100,
 currentAttack:100,currentDefense:100,currentSpecialAttack:100,currentSpecialDefense:100,currentSpeed:100,
 status:'normal',passiveAbility:null,heldItem:null,abilities:moves,movePp:moves.map(resources.getMaxMovePp),__battle:{statStages:{}}
},props);}
function fixed(work){const old=Math.random;Math.random=()=>.5;try{return work();}finally{Math.random=old;}}
function cast(a,b,f=e.createBattleState(),name='Pain Split'){return fixed(()=>e.useattack(name,a,b,{battleState:f,
 attackerSide:f.sides.player,defenderSide:f.sides.enemy,attackerTeam:[a],defenderTeam:[b]}));}
for(const [name,own,foe,expected]of [
 ['current HP average',{}, {currentHp:160},[100,100]],
 ['round down',{currentHp:1},{currentHp:200},[100,100]],
 ['individual maximums',{currentHp:10,maxHp:50},{currentHp:190,maxHp:300},[50,100]],
 ['one HP each',{currentHp:1},{currentHp:1},[1,1]],
 ['equal HP',{currentHp:100},{currentHp:100},[100,100]],
 ['Ghost target',{}, {currentHp:160,type1:'Ghost'},[100,100]],
 ['Heal Block', {__battle:{healBlockTurns:5}}, {currentHp:160,__battle:{healBlockTurns:5}},[100,100]]
])test(`Pain Split: ${name}`,()=>{const a=mon(own),b=mon(foe),r=cast(a,b);assert.deepEqual([a.currentHp,b.currentHp],expected);assert(r.success);assert.equal(r.damage,0);assert.equal(a.movePp[0],19);});

test('Substitute correctly fails the whole move with one PP, no HP change or fake success',()=>{
 const a=mon(),b=mon({currentHp:160,__battle:{substituteHp:50}}),r=cast(a,b);
 assert.equal(r.success,false);assert.equal(r.blocked,true);assert.match(r.messages.join(' '),/clone.*Balance/);
 assert.deepEqual([a.currentHp,b.currentHp,b.__battle.substituteHp],[40,160,50]);assert.equal(a.movePp[0],19);assert.equal(a.__battle.lastMoveFailed,true);
});
test('Infiltrator bypasses Substitute without consuming its HP',()=>{
 const a=mon({passiveAbility:'Infiltrator'}),b=mon({currentHp:160,__battle:{substituteHp:50}}),r=cast(a,b);
 assert(r.success);assert.deepEqual([a.currentHp,b.currentHp,b.__battle.substituteHp],[100,100,50]);
});
test('Protect blocks Pain Split and costs one PP',()=>{const a=mon(),b=mon({currentHp:160,__battle:{protect:true}}),r=cast(a,b);assert(r.blocked);assert.deepEqual([a.currentHp,b.currentHp],[40,160]);assert.equal(a.movePp[0],19);});
for(const defense of ['Magic Coat','Magic Bounce'])test(`Pain Split is not reflected by ${defense}`,()=>{
 const a=mon(),b=mon({currentHp:160,...(defense==='Magic Coat'?{__battle:{magicCoat:true}}:{passiveAbility:defense})}),r=cast(a,b);
 assert(r.success);assert.deepEqual([a.currentHp,b.currentHp],[100,100]);assert(!r.messages.some(m=>m.includes('renvoie')));
 assert.equal(a.movePp[0],19);assert.equal(b.movePp[0],20);assert.equal(b.__battle.lastMoveUsed,null);
 if(defense==='Magic Coat')assert.equal(b.__battle.magicCoat,true,'a non-reflectable move does not consume the coat');
});
for(const name of ['Toxic','Thunder Wave','Stealth Rock'])test(`Magic Coat still reflects ${name}`,()=>{
 const a=mon({},[name]),b=mon({currentHp:160,__battle:{magicCoat:true}}),f=e.createBattleState(),r=cast(a,b,f,name);
 assert(r.messages.some(m=>m.includes('renvoie')));
 if(name==='Toxic'){assert.equal(a.status,'badly_poison');assert.equal(b.status,'normal');}
 if(name==='Thunder Wave'){assert.equal(a.status,'paralyze');assert.equal(b.status,'normal');}
 if(name==='Stealth Rock'){assert.equal(f.sides.player.hazards.stealthRock,true);assert.equal(f.sides.enemy.hazards.stealthRock,false);}
});
for(const ability of ['Magic Guard','Wonder Guard','Sturdy','Liquid Ooze'])test(`Pain Split bypasses ${ability} without direct-damage reactions`,()=>{
 const a=mon({heldItem:'life_orb'}),b=mon({currentHp:160,passiveAbility:ability,heldItem:'focus_sash'}),r=cast(a,b);
 assert.deepEqual([a.currentHp,b.currentHp],[100,100]);assert.equal(r.damage,0);assert.equal(b.heldItem,'focus_sash');
});
function project(a,b,reply='Splash',extra={}){const field=e.createBattleState();return model.project(a,b,e.getMoveByName('Pain Split'),e.getMoveByName(reply),{field,ownSide:field.sides.player,enemySide:field.sides.enemy,chance:()=>1,damage:()=>0},{first:true,...extra});}
test('AI recognizes redistribution, keeps equal-HP success and never mutates inputs or consumes RNG',()=>{
 const a=mon(),b=mon({currentHp:160}),before=JSON.stringify([a,b]),random=Math.random;Math.random=()=>{throw Error('Live RNG consumed');};
 let p;try{p=project(a,b);}finally{Math.random=random;}
 assert.deepEqual([p.own.currentHp,p.foe.currentHp],[100,100]);assert(p.action.recognized);assert(p.action.useful);assert.equal(p.action.inflicted,0);assert.equal(JSON.stringify([a,b]),before);
 const same=project(mon({currentHp:100}),mon({currentHp:100}));assert.equal(same.action.useful,false);assert.equal(same.own.__battle.lastMoveFailed,false);
});
test('AI distinguishes Protect failure from a successful equal-HP Pain Split',()=>{
 const r=project(mon(),mon({currentHp:160}), 'Protect',{first:false});
 assert.deepEqual([r.own.currentHp,r.foe.currentHp],[40,160]);assert(r.action.recognized);assert.equal(r.action.useful,false);assert.equal(r.own.__battle.lastMoveFailed,true);
});
test('AI weights full paralysis without consuming random numbers',()=>{
 const r=project(mon({status:'paralyze'}),mon({currentHp:160}));
 assert.deepEqual([r.own.currentHp,r.foe.currentHp],[85,115]);
});
for(const name of ['No Guard','Lock-On'])test(`AI allows Pain Split against an airborne target with ${name}`,()=>{
 const a=mon(name==='No Guard'?{passiveAbility:name}:{}),b=mon({currentHp:160,__battle:{semiInvulnerable:'airborne',chargeMove:'Fly'}});
 if(name==='Lock-On')a.__battle={statStages:{},lockOnTurns:2,lockOnTargetId:b.uuid};
 const actualA=structuredClone(a),actualB=structuredClone(b);cast(actualA,actualB);const predicted=project(a,b);
 assert.deepEqual([actualA.currentHp,actualB.currentHp],[100,100]);assert.deepEqual([predicted.own.currentHp,predicted.foe.currentHp],[100,100]);
});
for(const [name,props]of [['Substitute',{__battle:{substituteHp:50}}],['semi-invulnerable',{__battle:{semiInvulnerable:'airborne',chargeMove:'Fly'}}],['Prankster Dark',{type1:'Dark'}]])test(`AI does not project a usable Pain Split into ${name}`,()=>{
 const a=mon(name==='Prankster Dark'?{passiveAbility:'Prankster'}:{}),b=mon({currentHp:160,...props}),r=project(a,b);
 assert.deepEqual([r.own.currentHp,r.foe.currentHp],[40,160]);assert(r.action.recognized);assert.equal(r.action.useful,false);
});
test('the real planner prefers useful Pain Split and avoids healing its opponent',()=>{
 const a=mon({currentSpeed:200},['Splash','Pain Split']),b=mon({currentHp:160},['Splash']),field=e.createBattleState();
 const options={team:[a],opponentTeam:[b],field,ownSide:field.sides.player,enemySide:field.sides.enemy,memory:{},round:1};
 assert.equal(ai.chooseAction(options).number,1);
 a.currentHp=200;b.currentHp=10;assert.equal(ai.chooseAction(options).number,0);
});

for(const mode of [{name:'Rift wild',type:'wild',npc:true,mode:'rift'},{name:'Rift PvP',type:'pvp',npc:false,mode:'rift'},
 {name:'Colosseum',type:'arena',npc:true,mode:'colosseum'},{name:'Super Tournament',type:'trainer',npc:true}]){
 for(const condition of ['normal','substitute','magic-coat'])test(`${mode.name}: Pain Split ${condition} publishes the real result and HP`,()=>{
  const a=mon(),b=mon({currentHp:160,...(condition==='substitute'?{__battle:{substituteHp:50}}:condition==='magic-coat'?{__battle:{magicCoat:true}}:{})},['Splash']);
  const p=(id,pokemon)=>({userId:id,socketId:'pain-'+id,equipe:{pokemons:[pokemon]},items:{},money:0,drifts:[],equipped:[],defeated:new Set(),chain:0});
  const own=p(1,a),foe=p(2,b),events=[];own.run={mode:mode.mode};foe.npc=mode.npc;
  const battle=new DriftBattle(own,foe,{type:mode.type,now:()=>0,random:()=>.5,paceMs:0,rules:{report:false,rewards:false,permanentDeaths:false},emit:(p,event,data)=>{if(p===own)events.push({event,data});}});
  try{fixed(()=>{assert(battle.action(own,{action:'attack',number:0,turnId:battle.token}));if(!foe.npc)assert(battle.action(foe,{action:'attack',number:0,turnId:battle.token}));});
   const r=events.find(e=>e.event==='battleMoveResult'&&e.data.actor==='player').data;
   assert.equal(r.success,condition!=='substitute');assert.deepEqual([a.currentHp,b.currentHp],condition==='substitute'?[40,160]:[100,100]);assert.equal(a.movePp[0],19);
   assert(!events.some(e=>e.event==='battleText'&&e.data.message.includes('renvoie')));
  }finally{battle.finish(null,'fled');}
 });
}
