const test=require('node:test'),assert=require('node:assert/strict');
const engine=require('../server/game/battle/battleEngine');
const forms=require('../server/game/abilities/abilityForms');
const coverage=require('../server/game/abilities/abilityCoverage');
const {clearBattleTransientState}=require('../server/game/battle/battleOutcome');
const {switchPokemonByIndex}=require('../server/game/battle/battleTeam');
const Pokemon=require('../server/game/models/Pokemon');
const factory=require('../server/game/drift/pokemonFactory');
let sequence=0;
function mon(ability=null,extra={}) {
    return Object.assign({uuid:`ability-check-${++sequence}`,name:'Test',truename:'Test',type1:'Normal',type2:null,
        level:50,maxHp:400,currentHp:400,attack:100,defense:100,specialAttack:100,specialDefense:100,speed:100,
        currentAttack:100,currentDefense:100,currentSpecialAttack:100,currentSpecialDefense:100,currentSpeed:100,
        status:'normal',gender:'male',passiveAbility:ability,abilities:['Pound','Thunderbolt','Growl','Double Slap'],movePp:[35,15,40,10],
        data:{id:1,base:{HP:80,Attack:80,Defense:80,'Sp. Attack':80,'Sp. Defense':80,Speed:80}}},extra);
}
function random(value,run){const old=Math.random;Math.random=()=>value;try{return run();}finally{Math.random=old;}}
function turn(a,b,move='Pound',state=engine.createBattleState(),options={}) {
    return engine.useattack(move,a,b,{battleState:state,attackerSide:state.sides.player,defenderSide:state.sides.enemy,...options});
}
function end(a,b,state=engine.createBattleState()){return engine.processEndOfRound(a,b,state.sides.player,state.sides.enemy,state);}
function enter(p,opponent=mon(),state=engine.createBattleState()){engine.applySwitchInEffects(p,state.sides.player,state.sides.enemy,state,opponent);return state;}
function stage(p,name){return p.__battle?.statStages?.[name]||0;}

test('all 223 talents have explicit coverage and all Flying move types match Gen 7',()=>{
    const used=new Set(Object.values(require('../data/game/pokemon_abilities.gen7.json').pokemon).flatMap(p=>p.abilities.map(s=>s.name)));
    for(const name of used)assert.notEqual(coverage.status(name),'missing',name);
    assert.equal(coverage.singleBattleAbilities.size,213);assert.equal(coverage.doublesOnly.size,8);assert.equal(coverage.overworldPending.size,2);
    for(const name of ['Air Slash','Gust','Roost','Brave Bird','Aerial Ace'])assert.equal(engine.getMoveByName(name).type,'Flying');
    assert.equal(engine.getMovePriority('Air Slash',mon('Gale Wings')),1);
});
for(const [ability,status]of [['Static','paralyze'],['Flame Body','burn'],['Poison Point','poison'],['Effect Spore','paralyze']]) {
    test(`${ability}: contact procs, ranged moves and Long Reach do not`,()=>random(.25,()=>{
        const target=mon(ability),source=mon();turn(source,target);assert.equal(source.status,status);
        const ranged=mon();turn(ranged,mon(ability),'Thunderbolt');assert.equal(ranged.status,'normal');
        const distant=mon('Long Reach');turn(distant,mon(ability));assert.equal(distant.status,'normal');
    }));
}
test('Poison Touch, Cute Charm and Mummy react to contact and restore temporary talent',()=>random(.2,()=>{
    const poisoned=mon();turn(mon('Poison Touch'),poisoned);assert.equal(poisoned.status,'poison');
    const charmed=mon();turn(charmed,mon('Cute Charm',{gender:'female'}));assert(charmed.__battle.infatuationTurns>0);
    const source=mon('Huge Power');turn(source,mon('Mummy'));assert.equal(source.passiveAbility,'Mummy');
    clearBattleTransientState([source]);assert.equal(source.passiveAbility,'Huge Power');
    const guarded=mon('Comatose');turn(guarded,mon('Mummy'));assert.equal(guarded.passiveAbility,'Comatose');
}));
for(const ability of ['Rough Skin','Iron Barbs'])test(`${ability}: one eighth per contact, Magic Guard prevents loss`,()=>random(.8,()=>{
    const a=mon();turn(a,mon(ability));assert.equal(a.currentHp,350);
    const safe=mon('Magic Guard');turn(safe,mon(ability));assert.equal(safe.currentHp,400);
}));
test('Aftermath and Innards Out trigger only from a real damaging KO',()=>random(.8,()=>{
    const a=mon();turn(a,mon('Aftermath',{currentHp:10}));assert.equal(a.currentHp,300);
    const damp=mon('Damp');turn(damp,mon('Aftermath',{currentHp:10}));assert.equal(damp.currentHp,400);
    const b=mon();turn(b,mon('Innards Out',{currentHp:17}));assert.equal(b.currentHp,383);
}));
for(const [ability,move,stat,amount]of [['Stamina','Pound','defense',1],['Water Compaction','Water Gun','defense',2],['Justified','Bite','attack',1],['Rattled','Bite','speed',1],['Gooey','Pound','speed',-1]]) {
    test(`${ability}: stat reaction uses the actual hit`,()=>random(.8,()=>{
        const a=mon(),d=mon(ability);turn(a,d,move);assert.equal(stage(ability==='Gooey'?a:d,stat),amount);
    }));
}
test('Weak Armor, Anger Point, Cursed Body and Berserk',()=>random(.2,()=>{
    const weak=mon('Weak Armor');turn(mon(),weak);assert.equal(stage(weak,'defense'),-1);assert.equal(stage(weak,'speed'),2);
    const angry=mon('Anger Point');random(0,()=>turn(mon(),angry));assert.equal(stage(angry,'attack'),6);
    const cursed=mon();turn(cursed,mon('Cursed Body'));assert.equal(cursed.__battle.disabledMove,'Pound');assert(cursed.__battle.disableTurns>0);
    assert.equal(turn(cursed,mon()).success,false);
    const berserk=mon('Berserk',{currentHp:205});turn(mon(),berserk);assert.equal(stage(berserk,'specialAttack'),1);
}));
test('Color Change changes later effectiveness, Emergency Exit and Wimp Out request replacement',()=>random(.8,()=>{
    const color=mon('Color Change');turn(mon(),color,'Thunderbolt');assert.deepEqual(color.__battle.tempTypes,['Electric']);
    for(const ability of ['Emergency Exit','Wimp Out'])assert.equal(turn(mon(),mon(ability,{currentHp:205})).forceSwitch,true);
    assert.equal(turn(mon(),mon('Emergency Exit',{currentHp:150})).forceSwitch,false);
}));
test('Moxie, Beast Boost and Soul-Heart apply once after a KO, never against a clone',()=>random(.8,()=>{
    for(const [ability,stat]of [['Moxie','attack'],['Beast Boost','specialAttack'],['Soul-Heart','specialAttack']]) {
        const p=mon(ability,{currentSpecialAttack:180});turn(p,mon(null,{currentHp:1}));assert.equal(stage(p,stat),1);
        const clone=mon();engine.ensureBattleData(clone).substituteHp=1;turn(p,clone);assert.equal(stage(p,stat),1);
    }
}));
test('Pressure, Truant and Early Bird respect PP and turn consumption',()=>random(.8,()=>{
    const p=mon();turn(p,mon('Pressure'));assert.equal(p.movePp[0],33);
    const lazy=mon('Truant'),target=mon();turn(lazy,target);const hp=target.currentHp,pp=lazy.movePp[0];
    assert.equal(turn(lazy,target).success,false);assert.equal(target.currentHp,hp);assert.equal(lazy.movePp[0],pp);
    assert.equal(turn(lazy,target).success,true);
    const early=mon('Early Bird',{status:'sleep'});engine.ensureBattleData(early).sleepTurns=2;
    assert.equal(turn(early,mon()).success,true);assert.equal(early.status,'normal');
}));
test('Contrary, Simple, Defiant and Competitive react to actual opponent stat changes',()=>{
    for(const [ability,expected]of [['Contrary',1],['Simple',-2],['Defiant',1]]) {
        const p=mon(ability);engine.applyStageChange(p,'attack',-1,[],mon());assert.equal(stage(p,'attack'),expected);
    }
    const c=mon('Competitive');engine.applyStageChange(c,'defense',-1,[],mon());assert.equal(stage(c,'specialAttack'),2);
    engine.applyStageChange(c,'defense',-1,[],c);assert.equal(stage(c,'specialAttack'),2);
});
test('Synchronize, Corrosion, Aroma Veil and Magic Bounce with Mold Breaker',()=>random(.8,()=>{
    const p=mon(),sync=mon('Synchronize');assert(engine.applyStatus(sync,'badly_poison',null,[],{attacker:p}));assert.equal(p.status,'poison');
    const steel=mon(null,{type1:'Steel'});assert(engine.applyStatus(steel,'poison',null,[],{attacker:mon('Corrosion')}));
    const aroma=mon('Aroma Veil');turn(mon(),aroma,'Taunt');assert.equal(aroma.__battle.tauntTurns,0);
    const a=mon(),mirror=mon('Magic Bounce');turn(a,mirror,'Thunder Wave');assert.equal(a.status,'paralyze');assert.equal(mirror.status,'normal');
    const breaker=mon('Mold Breaker'),mirror2=mon('Magic Bounce');turn(breaker,mirror2,'Thunder Wave');assert.equal(mirror2.status,'paralyze');
}));
test('Serene Grace, Shield Dust, Inner Focus, Steadfast and Stench use real secondary effects',()=>{
    random(.4,()=>{const d=mon();turn(mon('Serene Grace'),d,'Bite');assert.equal(d.__battle.flinch,true);});
    random(.4,()=>{const d=mon();turn(mon(),d,'Bite');assert(!d.__battle.flinch);});
    for(const ability of ['Shield Dust','Inner Focus'])random(.2,()=>{const d=mon(ability);turn(mon(),d,'Bite');assert(!d.__battle.flinch);});
    random(.2,()=>{const d=mon('Steadfast');turn(mon(),d,'Bite');assert.equal(stage(d,'speed'),1);assert.equal(turn(d,mon()).success,false);});
    random(.08,()=>{const d=mon();turn(mon('Stench'),d);assert(d.__battle.flinch);});
});
test('Skill Link, Infiltrator and Scrappy resolve full hits, clones, screens and immunities',()=>random(.8,()=>{
    assert.equal(turn(mon('Skill Link'),mon(),'Double Slap').hits,5);
    const d=mon();engine.ensureBattleData(d).substituteHp=100;const result=turn(mon('Infiltrator'),d);assert(result.damage>0);assert.equal(d.__battle.substituteHp,100);
    assert(turn(mon('Scrappy'),mon(null,{type1:'Ghost'})).damage>0);
    assert.equal(turn(mon(),mon(null,{type1:'Ghost'})).damage,0);
}));
test('Poison Heal, Shed Skin, Speed Boost, Bad Dreams, Moody and Harvest at end of turn',()=>random(.2,()=>{
    const heal=mon('Poison Heal',{status:'badly_poison',currentHp:100});end(heal,mon());assert.equal(heal.currentHp,150);
    const shed=mon('Shed Skin',{status:'paralyze'});end(shed,mon());assert.equal(shed.status,'normal');
    const speed=mon('Speed Boost');end(speed,mon());assert.equal(stage(speed,'speed'),1);
    const sleeper=mon(null,{status:'sleep'});end(mon('Bad Dreams'),sleeper);assert.equal(sleeper.currentHp,350);
    const moody=mon('Moody');end(moody,mon());assert.equal(Object.values(moody.__battle.statStages).filter(x=>x===2).length,1);assert.equal(Object.values(moody.__battle.statStages).filter(x=>x===-1).length,1);
    const harvest=mon('Harvest',{heldItem:'oran_berry',currentHp:180});turn(mon(),harvest);assert.equal(harvest.heldItem,null);
    harvest.currentHp=300;end(harvest,mon());assert.equal(harvest.heldItem,'oran_berry');
}));
test('Quick Feet, Unburden, Slow Start, Stall and Unaware',()=>random(.8,()=>{
    assert.equal(engine.getBattleSpeed(mon('Quick Feet',{status:'paralyze'})),150);
    const unburden=mon('Unburden',{heldItem:'oran_berry',currentHp:180});turn(mon(),unburden);assert.equal(engine.getBattleSpeed(unburden),200);
    const slow=mon('Slow Start'),state=engine.createBattleState();enter(slow,mon(),state);assert.equal(engine.getBattleSpeed(slow),50);
    for(let i=0;i<5;i++)end(slow,mon(),state);assert.equal(engine.getBattleSpeed(slow),100);
    const stall=mon('Stall',{currentSpeed:999}),normal=mon();assert.equal(engine.orderBattleActions([{pokemon:stall,moveName:'Pound'},{pokemon:normal,moveName:'Pound'}],state)[0].pokemon,normal);
    const boosted=mon();engine.applyStageChange(boosted,'attack',6,[],boosted);
    const unaware=mon('Unaware');assert.equal(turn(boosted,unaware).damage,turn(mon(),mon('Unaware')).damage);
}));
test('Rivalry, aura, Tangled Feet, Long Reach, weight abilities and Stakeout',()=>random(.8,()=>{
    const baseline=turn(mon(),mon()).damage;
    assert(turn(mon('Rivalry'),mon()).damage>baseline);assert(turn(mon('Rivalry'),mon(null,{gender:'female'})).damage<baseline);
    assert(turn(mon('Dark Aura'),mon(),'Bite').damage>turn(mon(),mon(),'Bite').damage);
    assert(turn(mon('Dark Aura'),mon('Aura Break'),'Bite').damage<turn(mon(),mon(),'Bite').damage);
    const state=engine.createBattleState(),target=mon();enter(mon(),mon(),state);enter(target,mon(),state);assert(turn(mon('Stakeout'),target,'Pound',state).damage>=2*baseline);
    const tangled=mon('Tangled Feet');engine.ensureBattleData(tangled).confusionTurns=3;assert(turn(mon(),tangled).missed);
    const heavy=factory.create(143,50);heavy.passiveAbility='Heavy Metal';const light=factory.create(143,50);light.passiveAbility='Light Metal';
    assert(engine.getSpecialMoveResolution(engine.getMoveByName('Low Kick'),mon(),heavy).power>=engine.getSpecialMoveResolution(engine.getMoveByName('Low Kick'),mon(),light).power);
}));
test('Magician, Pickpocket, Sticky Hold, Klutz, Cheek Pouch, Unnerve and Pickup preserve item ownership',()=>random(.8,()=>{
    for(const name of ['Magician','Pickpocket']) {
        const receiver=mon(name),owner=mon(null,{heldItem:'leftovers'});
        if(name==='Magician')turn(receiver,owner);else turn(owner,receiver);
        assert.equal(receiver.heldItem,'leftovers');assert.equal(owner.heldItem,null);
        clearBattleTransientState([receiver,owner]);assert.equal(owner.heldItem,'leftovers');assert.equal(receiver.heldItem,null);
    }
    const thief=mon('Magician'),sticky=mon('Sticky Hold',{heldItem:'leftovers'});turn(thief,sticky);assert(!thief.heldItem);
    const klutz=mon('Klutz',{heldItem:'oran_berry',currentHp:100});turn(mon(),klutz);assert.equal(klutz.heldItem,'oran_berry');
    const cheek=mon('Cheek Pouch',{heldItem:'oran_berry',currentHp:100});turn(mon(),cheek);assert(cheek.currentHp>200);
    const berry=mon(null,{heldItem:'oran_berry',currentHp:100});turn(mon('Unnerve'),berry);assert.equal(berry.heldItem,'oran_berry');
    const picker=mon('Pickup'),owner=mon(null,{heldItem:'oran_berry',currentHp:100}),state=engine.createBattleState();turn(picker,owner,'Pound',state);end(picker,owner,state);assert.equal(picker.heldItem,'oran_berry');assert.equal(owner.__battle.consumedHeldItem,null);
    clearBattleTransientState([picker,owner]);assert.equal(owner.heldItem,'oran_berry');assert(!picker.heldItem);
}));
test('Liquid Ooze reverses draining and Dancer copies once without extra PP or a turn',()=>random(.8,()=>{
    const a=mon(null,{currentHp:200});turn(a,mon('Liquid Ooze'),'Giga Drain');assert(a.currentHp<200);
    const b=mon(null,{currentHp:200});turn(b,mon(),'Giga Drain');assert(b.currentHp>200);
    const dancer=mon('Dancer'),normal=mon();turn(normal,dancer,'Swords Dance');assert.equal(stage(normal,'attack'),2);assert.equal(stage(dancer,'attack'),2);
    assert.equal(dancer.__battle.lastActionTurn,0);
}));
test('trap talents distinguish grounded targets, Ghost immunity and Run Away',()=>{
    assert.equal(engine.canSwitchOut(mon(),mon('Shadow Tag')),false);
    assert.equal(engine.canSwitchOut(mon(null,{type1:'Ghost'}),mon('Shadow Tag')),true);
    assert.equal(engine.canSwitchOut(mon('Shadow Tag'),mon('Shadow Tag')),true);
    assert.equal(engine.canSwitchOut(mon(null,{type1:'Steel'}),mon('Magnet Pull')),false);
    assert.equal(engine.canSwitchOut(mon('Levitate'),mon('Arena Trap')),true);
    const state=engine.createBattleState();state.field.gravityTurns=2;assert.equal(engine.canSwitchOut(mon('Levitate'),mon('Arena Trap'),state),false);
    assert.equal(engine.canSwitchOut(mon('Run Away'),mon('Shadow Tag'),state,{escape:true}),true);
});
test('Levitate, Mold Breaker, Magic Guard and Trace work in the real engine',()=>random(.8,()=>{
    assert.equal(turn(mon(),mon('Levitate'),'Earthquake').damage,0);
    assert(turn(mon('Mold Breaker'),mon('Levitate'),'Earthquake').damage>0);
    assert(turn(mon('Mold Breaker'),mon('Fur Coat')).damage>turn(mon(),mon('Fur Coat')).damage);
    const guard=mon('Magic Guard',{status:'burn'}),state=engine.createBattleState();state.weather={kind:'hail',turns:5};end(guard,mon(),state);assert.equal(guard.currentHp,400);
    const tracer=mon('Trace'),target=mon('Intimidate');enter(tracer,target);assert.equal(tracer.passiveAbility,'Intimidate');assert.equal(stage(target,'attack'),-1);clearBattleTransientState([tracer]);assert.equal(tracer.passiveAbility,'Trace');
}));
test('forms and Disguise are temporary, survive checkpoint, and do not rewrite species or XP',()=>random(.8,()=>{
    const school=factory.create(746,30);school.passiveAbility='Schooling';const id=school.data.id,xp=school.experience;
    enter(school);assert.equal(school.__battle.abilityForm,'Wishiwashi-School');
    school.currentHp=1;end(school,mon());assert.equal(school.__battle.abilityForm,null);assert.equal(school.data.id,id);assert.equal(school.experience,xp);
    const blade=factory.create(681,40);blade.passiveAbility='Stance Change';enter(blade);turn(blade,mon());assert.equal(blade.__battle.abilityForm,'Aegislash-Blade');turn(blade,mon(),"King's Shield");assert.equal(blade.__battle.abilityForm,null);
    const disguise=factory.create(778,30);disguise.passiveAbility='Disguise';enter(disguise);assert.equal(turn(mon(),disguise,'Shadow Ball').damage,0);assert(disguise.__abilityMemory.disguiseBroken);
    const reserve=factory.create(1,30),team=[disguise,reserve];switchPokemonByIndex(team,1);switchPokemonByIndex(team,1);enter(disguise);assert(turn(mon(),disguise,'Shadow Ball').damage>0);
    const codec=require('../server/game/drift/checkpointCodec'),restored=codec.decode(codec.encode({p:disguise})).p;assert(restored instanceof Pokemon);assert(restored.__abilityMemory.disguiseBroken);
    clearBattleTransientState([disguise]);assert(!disguise.__abilityMemory);assert.equal(disguise.data.id,778);
    const zen=factory.create(555,30);zen.passiveAbility='Zen Mode';zen.currentHp=Math.floor(zen.maxHp/2);enter(zen);assert.equal(zen.__battle.abilityForm,'Darmanitan-Zen');
    const shields=factory.create(774,30);shields.passiveAbility='Shields Down';enter(shields);assert(!engine.applyStatus(shields,'poison',null,[]));shields.currentHp=1;end(shields,mon());assert.equal(shields.__battle.abilityForm,'Minior');
    const z=factory.create(718,30);z.passiveAbility='Power Construct';const hp=z.maxHp;z.currentHp=10;enter(z);end(z,mon());assert(z.maxHp>hp);clearBattleTransientState([z]);assert.equal(z.maxHp,hp);assert.equal(z.currentHp,10);
    const ash=factory.create(658,40);ash.passiveAbility='Battle Bond';enter(ash);turn(ash,mon(null,{currentHp:1}));assert.equal(ash.__battle.abilityForm,'Greninja-Ash');
}));
test('Illusion uses the last alive teammate, breaks on direct damage, and survives loading',()=>random(.8,()=>{
    const fox=factory.create(571,30),reserve=factory.create(25,30);fox.passiveAbility='Illusion';forms.attachTeam([fox,reserve]);enter(fox);assert.equal(fox.__battle.illusion.id,25);
    const restored=require('../server/game/drift/checkpointCodec').decode(require('../server/game/drift/checkpointCodec').encode({fox})).fox;
    assert.equal(require('../server/game/drift/colosseumAI').observedView(restored).type1,'Electric');
    assert.equal(restored.__abilityTeam[1].data.id,25);turn(mon(),restored);assert.equal(restored.__battle.illusion,null);clearBattleTransientState([restored]);assert(!restored.__abilityTeam);
}));
