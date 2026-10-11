const test=require('node:test');
const assert=require('node:assert/strict');
const fx=require('../server/game/drift/driftEffects');
const economy=require('../server/game/drift/economy');
const engine=require('../server/game/battle/battleEngine');
const factory=require('../server/game/drift/pokemonFactory');
function fixture(number,defensive=false){
    const a=factory.create(19,20),b=factory.create(19,20);
    for(const p of [a,b]){p.maxHp=100;p.currentHp=100;p.passiveAbility=null;engine.ensureBattleData(p);}
    const owned={uuid:'owned',definitionId:`DRF-${String(number).padStart(3,'0')}`,rarity:'mythic',element:'Normal'};
    const owner={drifts:[owned],equipped:['owned'],chain:0},empty={drifts:[],equipped:[]};
    fx.attach([a],defensive?empty:owner,false,()=>0);fx.attach([b],defensive?owner:empty,false,()=>0);
    return {a,b,owner,state:fx.states.get(defensive?b:a),move:engine.getMoveByName('Tackle')};
}
const callbacks={status:(p,s,source)=>engine.applyStatus(p,s,null,[],{attacker:source}),stage:(p,s,n)=>engine.applyStageChange(p,s,n,[])};
function hit(move,extras={}){return {move,success:true,damage:20,effectiveness:1,messages:[],...extras};}

for(const number of [1,6,7,8,9,10,11,12,24,32,33,35,36,38,39,41,42,56,58])test(`DRF-${number} : bonus offensif conditionnel réellement appliqué`,()=>{
    const {a,b,owner,state,move}=fixture(number);
    if(number===6)b.currentHp=20;
    if(number===8)state.streak=3;
    if(number===9)state.vengeance=true;
    if(number===12)b.__battle.statStages.defense=1;
    if(number===24)state.counter=true;
    if(number===32)state.flame=true;
    if(number===33)state.entry=true;
    if(number===36)state.shared.deaths=3;
    if(number===38)state.types=['Fire','Water'];
    if(number===41)state.reserve=true;
    if(number===42)b.status='poison';
    if(number===58)owner.chain=4;
    assert.ok(fx.multiplier(a,b,move,number===10)>1);
    owner.equipped=[];assert.equal(fx.multiplier(a,b,move,true),1);
});
for(const number of [13,14,17,18,37,48])test(`DRF-${number} : réduction défensive et déséquipement`,()=>{
    const {a,b,owner,state,move}=fixture(number,true);
    if(number===17)state.armor=true;if(number===18)b.currentHp=20;if(number===37)state.adapted='Normal';if(number===48)state.wild=true;
    assert.ok(fx.multiplier(a,b,move,false)<1);owner.equipped=[];assert.equal(fx.multiplier(a,b,move,false),1);
});

test('perce-armure, précision, priorités et défenses progressives respectent leurs bornes',()=>{
    let f=fixture(2);assert.equal(fx.pierce(f.a,100),70);
    f=fixture(40);assert.equal(fx.accuracy(f.a),.18);
    f=fixture(3);assert.equal(fx.priority(f.a,f.move),1);assert.equal(fx.priority(f.a,engine.getMoveByName('Growl')),0);
    f=fixture(57);assert.equal(fx.priority(f.a,f.move),1);assert.equal(fx.priority(f.a,f.move),0);
    f=fixture(20);f.state.turns=20;assert.equal(fx.defense(f.a,'defense',100),135);assert.equal(fx.defense(f.a,'attack',100),100);
});

test('survie, bouclier, régénération et Pacte ne ressuscitent jamais un mort',()=>{
    for(const [number,hp] of [[15,1],[55,20]]){
        const f=fixture(number,true);
        const loss=fx.directDamage(f.b,200,f.a);assert.equal(100-loss,hp);
        f.b.currentHp=hp;assert.equal(fx.directDamage(f.b,200,f.a),200,'une seule sauvegarde par combat');
    }
    let low=fixture(55,true);low.b.currentHp=4;const loss=fx.directDamage(low.b,100,low.a);low.b.currentHp-=loss;fx.afterDamage(low.b,4,low.a);assert.equal(low.b.currentHp,20);assert.equal(fx.isDead(low.b),false);
    let f=fixture(21,true);f.b.currentHp=20;fx.afterDamage(f.b,60,f.a);assert.equal(f.state.shield,25);assert.equal(fx.directDamage(f.b,15,f.a),0);assert.equal(f.state.shield,10);
    f=fixture(16);f.a.currentHp=50;fx.endTurn(f.a);assert.equal(f.a.currentHp,53);
    f=fixture(56);f.a.currentHp=3;fx.endTurn(f.a);assert.equal(f.a.currentHp,0);assert.equal(fx.heal(f.a,100),0);assert.equal(fx.isDead(f.a),true);
});

test('double impact sans récursion, vampirisme, reflets et symbiose sur le soin effectif',()=>{
    let f=fixture(4);fx.afterMove(f.a,f.b,hit(f.move),callbacks);assert.equal(f.b.currentHp,94);
    f=fixture(5);f.a.currentHp=50;fx.afterMove(f.a,f.b,hit(f.move),callbacks);assert.equal(f.a.currentHp,53);
    f=fixture(19,true);fx.afterMove(f.a,f.b,hit(f.move),callbacks);assert.equal(f.a.currentHp,97);
    f=fixture(59);const ally=factory.create(19,20);ally.maxHp=100;ally.currentHp=50;fx.attach([f.a,ally],f.owner,false,()=>0);f.a.currentHp=90;
    fx.heal(f.a,100);assert.equal(f.a.currentHp,100);assert.equal(ally.currentHp,52,'20 % du soin réel de 10 PV');
    fx.damage(ally,100);f.a.currentHp=50;fx.heal(f.a,20);assert.equal(ally.currentHp,0);
});

test('ratés : punition, contre parfait et opportuniste ; attaques bloquées exclues',()=>{
    for(const number of [23,24,25]){
        const f=fixture(number,true);f.b.currentHp=50;
        fx.afterMove(f.a,f.b,{move:f.move,missed:true,success:false,damage:0},callbacks);
        if(number===23)assert.equal(f.a.currentHp,82);
        if(number===24)assert.equal(f.state.counter,true);
        if(number===25)assert.equal(f.b.currentHp,68);
    }
    const f=fixture(23,true);fx.afterMove(f.a,f.b,{move:f.move,blocked:true,damage:0},callbacks);assert.equal(f.a.currentHp,100);
});

test('statuts, contact, vitesse, précision, retrait de boost et drain trois tours',()=>{
    let f=fixture(22,true);assert.equal(engine.applyStatus(f.b,'poison',null,[],{attacker:f.a}),false);assert.equal(f.b.status,'normal');
    f=fixture(28,true);engine.applyStatus(f.b,'poison',null,[],{attacker:f.a});assert.equal(f.b.status,'normal');assert.equal(f.a.status,'poison');
    f=fixture(26,true);fx.afterMove(f.a,f.b,hit(f.move),{...callbacks,contact:true});assert.equal(f.a.status,'poison');
    f=fixture(27,true);fx.afterMove(f.a,f.b,hit(f.move),callbacks);assert.equal(f.a.__battle.statStages.speed,-1);
    f=fixture(29,true);fx.afterMove(f.a,f.b,hit(f.move,{effectiveness:2}),callbacks);assert.equal(f.a.__battle.statStages.accuracy,-1);
    f=fixture(31);f.b.__battle.statStages.defense=2;fx.afterMove(f.a,f.b,hit(f.move),callbacks);assert.equal(f.b.__battle.statStages.defense,1);
    f=fixture(30);f.a.currentHp=50;fx.afterMove(f.a,f.b,hit(f.move),callbacks);for(let i=0;i<4;i++)fx.endTurn(f.b);assert.equal(f.b.currentHp,91);assert.equal(f.a.currentHp,59);
});

test('switch manuel seulement pour Relais vital et compteurs de morts/streak/énergie',()=>{
    let f=fixture(34);f.a.currentHp=50;fx.switched(f.a,false);assert.equal(f.a.currentHp,50);fx.switched(f.a,true);assert.equal(f.a.currentHp,60);
    f=fixture(8);fx.afterMove(f.a,f.b,hit(f.move),callbacks);assert.equal(f.state.streak,1);fx.afterMove(f.a,f.b,hit(f.move,{success:false,missed:true,damage:0}),callbacks);assert.equal(f.state.streak,0);
    f=fixture(41);fx.endTurn(f.a);assert.equal(f.state.reserve,true);fx.afterMove(f.a,f.b,hit(f.move),callbacks);fx.endTurn(f.a);assert.equal(f.state.reserve,false);
    f=fixture(36);fx.fainted(f.a);fx.fainted(f.a);assert.equal(f.state.shared.deaths,1);
});

test('les douze Drifts de progression sont désactivés en tournoi',()=>{
    for(let n=43;n<=54;n++){const f=fixture(n);assert.ok(fx.value(f.owner,n)>0);assert.equal(fx.value(f.owner,n,true),0);}
});

test('vrais dégâts moteur : bonus actifs seulement sur Pokémon Drift, immunités conservées',()=>{
    const a=factory.create(19,20),b=factory.create(19,20);a.passiveAbility=null;b.passiveAbility=null;
    const original=Math.random;Math.random=()=>.9;
    try{
        const base=engine.calculateDamage(a,b,engine.getMoveByName('Tackle'));
        const owner={drifts:[{uuid:'d',definitionId:'DRF-001',rarity:'mythic',element:'Normal'}],equipped:['d']};
        fx.attach([a],owner);assert.ok(engine.calculateDamage(a,b,engine.getMoveByName('Tackle'))>base);
        fx.detach([a]);assert.equal(engine.calculateDamage(a,b,engine.getMoveByName('Tackle')),base);
        const ghost=factory.create(92,20);fx.attach([a],owner);assert.equal(engine.calculateDamage(a,ghost,engine.getMoveByName('Tackle')),0);
    }finally{Math.random=original;}
});

test('Chance du collectionneur augmente le drop relatif sans changer la rareté ; soins/fortune/revente',()=>{
    const make=()=>({userId:1,alive:true,inbattle:false,run:{phase:'exploration'},currentmap:'ville1_shop',money:1000,items:{drift_potion:2},drifts:[],equipped:[],equipe:{pokemons:[factory.create(19,5)]}});
    const p=make();p.drifts.push({uuid:'d',definitionId:'DRF-044',rarity:'mythic'});p.equipped=['d'];
    const sequence=[.19,.9,.2,.99];economy.drop(p,'wild',()=>sequence.shift());assert.equal(p.drifts.length,2);assert.equal(p.drifts[1].rarity,'epic');
    const q=make();economy.drop(q,'wild',()=>.19);assert.equal(q.drifts.length,0);
    p.drifts.push({uuid:'s',definitionId:'DRF-052',rarity:'mythic'});p.equipped=['s'];p.equipe.pokemons[0].currentHp=1;
    economy.usePotion(p,'drift_potion',p.equipe.pokemons[0].uuid,()=>0);assert.equal(p.items.drift_potion,2);assert.ok(p.equipe.pokemons[0].currentHp>1);
    p.drifts.push({uuid:'merchant',definitionId:'DRF-053',rarity:'mythic'});p.equipped=['merchant'];const before=p.money;
    economy.remove(p,'s',true);assert.equal(p.money,before+2600);
});

test('Recherche rare favorise une espèce explicitement rare sans changer la carte ni ses niveaux',()=>{
    const p={drifts:[{uuid:'rare',definitionId:'DRF-054',rarity:'mythic'}],equipped:[]};
    // In start: Pikachu has weight 25, three common species 100, Kapoera 25.
    // This draw is outside Pikachu's base interval, inside its boosted interval.
    const basic=factory.wild('start',p,()=>.08);p.equipped=['rare'];const boosted=factory.wild('start',p,()=>.08);
    assert.equal(basic.data.id,88);assert.equal(boosted.data.id,25);assert.equal(basic.level,boosted.level);
    assert.equal(factory.wild('centre',p,()=>0),null);
});
