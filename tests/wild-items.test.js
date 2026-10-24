const test=require('node:test'),assert=require('node:assert/strict');
const loot=require('../server/game/items/wildLoot'),catalog=require('../data/game/items.json').items;
const factory=require('../server/game/drift/pokemonFactory'),engine=require('../server/game/battle/battleEngine');
const {medicineResult}=require('../server/game/items/medicineEffects');
const codec=require('../server/game/drift/checkpointCodec');
const {AdventureExperience}=require('../server/game/battle/adventureExperience');
const {calculateBattleExperience:xp}=require('../server/game/models/progression');
const {DriftBattle}=require('../server/game/drift/driftBattle');
const sequence=(...values)=>()=>values.shift() ?? .5;
function pkm(id=7) {const p=factory.create(id,40,true);p.passiveAbility=null;return p;}
function player() {return {items:{},equipe:{pokemons:[pkm()]},storage:[]};}
function fixed(fn) {const old=Math.random;Math.random=()=>.5;try{return fn();}finally{Math.random=old;}}
function enter(p,opponent=pkm(),state=engine.createBattleState()) {return engine.applySwitchInEffects(p,state.sides.player,state.sides.enemy,state,opponent);}

test('wild loot: exact 1/17 base threshold, weighted families, berries repeat and exhausted unique pools never waste a successful drop',()=>{
    assert.equal(loot.CHANCE,1/17);const p=player();
    assert(loot.awardExpedition(p,sequence(1/17-1e-8,0,0)));
    assert.equal(loot.awardExpedition(p,sequence(1/17,0,0)),null);
    let found=0;for(let i=0;i<17000;i++)if(loot.awardExpedition(p,sequence((i+.5)/17000,0,0)))found++;
    assert.equal(found,1000);
    const groups={};for(let i=0;i<10000;i++){const item=loot.select(new Set(),sequence((i+.5)/10000,.5));groups[item.wildLoot.group]=(groups[item.wildLoot.group]||0)+1;}
    assert.deepEqual(groups,{berries:5500,vitamins:2500,equipment:1500,key:500});
    const claimed=new Set(loot.uniqueKeys);
    for(const r of [0,.55,.8,.99])assert(!loot.select(claimed,sequence(r,.99)).unique);
});

test('unique expedition items remain discovered after use, equipment, storage, checkpoint and repeated rolls; new expeditions are independent',()=>{
    const p=player();assert.equal(loot.awardExpedition(p,sequence(0,.85,0)).key,'leftovers');
    p.items.leftovers=0;p.storage=[{box:0,slot:0,pokemon:{heldItem:'leftovers'}}];
    const saved=codec.decode(codec.encode(p));
    assert(saved.discoveredItems instanceof Set);assert(saved.discoveredItems.has('leftovers'));
    assert.equal(loot.awardExpedition(saved,sequence(0,.85,0)).key,'life_orb');
    assert.equal(loot.awardExpedition(saved,sequence(0,.99,0)).key,'exp_share');saved.items.exp_share=0;
    assert.notEqual(loot.awardExpedition(saved,sequence(0,.99,0)).key,'exp_share');
    const legacy=player();legacy.storage=[{pokemon:{heldItem:'leftovers'}}];
    assert.equal(loot.awardExpedition(legacy,sequence(0,.85,0)).key,'life_orb');
    assert.equal(loot.awardExpedition(player(),sequence(0,.85,0)).key,'leftovers');
});

for(const item of catalog.filter(i=>i.fieldUse?.effort))test(`${item.name}: real EV/stat changes, caps, no free healing and no mutation before confirmation`,()=>{
    const p=pkm();p.currentHp-=12;const {stat,amount}=item.fieldUse.effort;
    if(amount<0){p.ev[stat]=17;p.recalculateStats(true);}
    const before=JSON.stringify(p),result=medicineResult(p,item.key);
    assert.equal(JSON.stringify(p),before);assert.equal(result.ev[stat],amount>0?10:7);
    assert.equal(result.maxHp-result.currentHp,p.maxHp-p.currentHp);
    if(amount>0){p.ev[stat]=250;p.recalculateStats(true);assert.equal(medicineResult(p,item.key).ev[stat],252);p.ev[stat]=252;p.recalculateStats(true);assert.throws(()=>medicineResult(p,item.key),/aucun effet/);}
    else {p.ev[stat]=0;p.recalculateStats(true);assert.throws(()=>medicineResult(p,item.key),/aucun effet/);}
    p.currentHp=0;assert.throws(()=>medicineResult(p,item.key),/apte/);
});
test('vitamins respect the total 510 cap and Leppa restores a depleted move first without exceeding max PP',()=>{
    const p=pkm();p.ev={hp:252,attack:252,defense:4,specialAttack:0,specialDefense:0,speed:0};p.recalculateStats(true);
    assert.equal(medicineResult(p,'calcium').ev.specialAttack,2);
    p.ev.defense=6;p.recalculateStats(true);assert.throws(()=>medicineResult(p,'calcium'),/aucun effet/);
    p.abilities=['Tackle','Flamethrower'];p.movePp=[34,0];assert.deepEqual(medicineResult(p,'leppa_berry').movePp,[34,10]);
    p.movePp=[34,15];assert.deepEqual(medicineResult(p,'leppa_berry').movePp,[35,15]);
    p.movePp=[35,15];assert.throws(()=>medicineResult(p,'leppa_berry'),/PP sont pleins/);
});

for(const item of catalog.filter(i=>i.battle_effect==='cure_status'))test(`${item.name}: targeted status cure, wrong ailment untouched and Unnerve suppression`,()=>{
    const status=(item.cure||item.fieldUse.cure)[0],p=pkm();p.status=status;p.heldItem=item.key;enter(p);
    assert.equal(p.status,'normal');assert.equal(p.heldItem,null);
    const blocked=pkm(),enemy=pkm();blocked.status=status;blocked.heldItem=item.key;enemy.passiveAbility='Unnerve';enter(blocked,enemy);
    assert.equal(blocked.status,status);assert.equal(blocked.heldItem,item.key);
    if(item.key!=='lum_berry'){const wrong=pkm();wrong.status=status==='burn'?'poison':'burn';wrong.heldItem=item.key;enter(wrong);assert.equal(wrong.heldItem,item.key);}
});
test('confusion, PP and stat berries resolve once, including Gluttony and item suppression',()=>{
    for(const key of ['lum_berry','persim_berry']){const p=pkm();p.heldItem=key;p.__battle={confusionTurns:3};enter(p);assert.equal(p.__battle.confusionTurns,0);assert.equal(p.heldItem,null);}
    const pp=pkm();pp.abilities=['Flamethrower'];pp.movePp=[0];pp.heldItem='leppa_berry';enter(pp);assert.equal(pp.movePp[0],10);assert.equal(pp.heldItem,null);
    for(const item of catalog.filter(i=>i.battle_effect==='stat_berry')){const p=pkm();p.heldItem=item.key;p.currentHp=Math.floor(p.maxHp/4);enter(p);assert.equal(p.__battle.statStages[item.stat],1);assert.equal(p.heldItem,null);}
    const glutton=pkm();glutton.passiveAbility='Gluttony';glutton.currentHp=Math.floor(glutton.maxHp/2);glutton.heldItem='salac_berry';enter(glutton);assert.equal(glutton.__battle.statStages.speed,1);
    const klutz=pkm();klutz.passiveAbility='Klutz';klutz.heldItem='salac_berry';klutz.currentHp=1;enter(klutz);assert.equal(klutz.heldItem,'salac_berry');
});

const attacks={Fire:['Flamethrower','Grass'],Water:['Surf','Fire'],Electric:['Thunderbolt','Water'],Grass:['Energy Ball','Water'],Ice:['Ice Beam','Dragon'],Fighting:['Brick Break','Normal'],Poison:['Sludge Bomb','Grass'],Ground:['Earthquake','Electric'],Flying:['Aerial Ace','Fighting'],Psychic:['Psychic','Fighting'],Bug:['X-Scissor','Psychic'],Rock:['Rock Slide','Fire'],Ghost:['Shadow Ball','Ghost'],Dragon:['Dragon Claw','Dragon'],Dark:['Dark Pulse','Psychic'],Steel:['Iron Head','Ice'],Fairy:['Moonblast','Dragon'],Normal:['Pound','Normal']};
for(const item of catalog.filter(i=>i.battle_effect==='type_resist'))test(`${item.name}: first matching hit halved, real consumption, second hit full, estimate read-only`,()=>fixed(()=>{
    const [name,type]=attacks[item.resist_type],a=pkm(),b=pkm();a.abilities=[name];a.movePp=[20];b.type1=type;b.type2=null;b.maxHp=b.currentHp=10000;
    const field=engine.createBattleState(),before=engine.estimateDamage(a,b,engine.getMoveByName(name),{battleState:field});b.heldItem=item.key;
    const estimate=engine.estimateDamage(a,b,engine.getMoveByName(name),{battleState:field});assert.equal(b.heldItem,item.key);assert(Math.abs(estimate-before/2)<=1);
    const first=engine.useattack(name,a,b,{battleState:field});assert.equal(b.heldItem,null);assert(first.messages.some(m=>m.includes(item.name)));assert(first.damage>0);
    const second=engine.useattack(name,a,b,{battleState:field});assert(Math.abs(first.damage-second.damage/2)<=1);
}));
test('resistance berries ignore neutral hits, clones, Unnerve and Magic Room without consumption',()=>fixed(()=>{
    for(const kind of ['neutral','substitute','unnerve','magicRoom']){
        const a=pkm(),b=pkm(),state=engine.createBattleState();a.abilities=['Ice Beam'];a.movePp=[10];b.type1=kind==='neutral'?'Water':'Dragon';b.type2=null;b.maxHp=b.currentHp=10000;b.heldItem='yache_berry';
        if(kind==='substitute')b.__battle={substituteHp:1000};if(kind==='unnerve')a.passiveAbility='Unnerve';if(kind==='magicRoom')state.field.magicRoomTurns=5;
        engine.useattack('Ice Beam',a,b,{battleState:state});assert.equal(b.heldItem,'yache_berry',kind);
    }
}));

test('Adventure Multi Exp replaces participation splitting with full fighter and 40 percent to each living reserve, scaled separately, once',()=>{
    const lead=pkm(),bench=pkm(),dead=pkm(),egg=pkm(),foe=pkm(19);dead.currentHp=0;egg.isEgg=true;bench.level=5;bench.recalculateStats();
    const p={id:'owner',equipe:{pokemons:[lead,bench,dead,egg]}},tracker=new AdventureExperience({expShare:true}),events=[],io={to:()=>({emit:(_name,data)=>events.push(data)})};
    tracker.enter(lead,foe);tracker.enter(bench,foe);const full=xp(foe,1,lead),shared=Math.floor(xp(foe,1,bench)*0.4),initial=bench.experience;foe.currentHp=0;
    const awards=tracker.reward(p,foe,1,io);assert.equal(awards.length,2);assert.equal(awards[0].xp,full);assert.equal(awards[1].xp,shared);assert.equal(bench.experience,initial+shared);assert.equal(events.length,2);assert.equal(bench.ev.speed,1,'This reserve faced the enemy and earns its EV yield');assert.deepEqual(tracker.reward(p,foe,1,io),[]);
});
for(const mode of ['rift','colosseum'])test(`${mode}: Multi Exp keeps fighter XP and better existing sharing, includes living reserves and does not double rewards`,()=>{
    function run(enabled){const lead=pkm(),reserve=pkm(),foe=pkm(19),events=[];if(enabled)lead.heldItem='exp_share';const p={run:{mode},items:enabled?{exp_share:1}:{},equipe:{pokemons:[lead,reserve]},drifts:[],equipped:[]};
        const b=Object.assign(Object.create(DriftBattle.prototype),{a:p,type:'wild',rewarded:new Set(),emit:(_p,_event,data)=>events.push(data)});
        const initial=[lead.experience,reserve.experience];b.reward(foe);const gains=[lead.experience-initial[0],reserve.experience-initial[1]];b.reward(foe);assert.deepEqual([lead.experience-initial[0],reserve.experience-initial[1]],gains);return {gains,events};}
    const normal=run(false),shared=run(true);assert.equal(shared.gains[0],normal.gains[0]);assert(shared.gains[1]>=Math.floor(shared.gains[0]/2));assert(shared.gains[1]>=normal.gains[1]);assert.equal(shared.events.length,2);
});
