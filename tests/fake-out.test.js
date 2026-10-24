const test=require('node:test'),assert=require('node:assert/strict');
const engine=require('../server/game/battle/battleEngine');
const factory=require('../server/game/drift/pokemonFactory');
const {getMaxMovePp}=require('../server/game/battle/battleResources');
const {switchPokemonByIndex}=require('../server/game/battle/battleTeam');
const {DriftBattle}=require('../server/game/drift/driftBattle');
const codec=require('../server/game/drift/checkpointCodec');
function mon(moves=['Fake Out','Splash']) {
    const p=factory.create(52,25,true);p.passiveAbility=null;p.heldItem=null;p.type1='Normal';p.type2=null;
    p.abilities=moves;p.movePp=moves.map(getMaxMovePp);p.maxHp=p.currentHp=1000;return p;
}
function fixed(work){const old=Math.random;try{Math.random=()=>0.5;return work();}finally{Math.random=old;}}
function hit(a,b,state,name='Fake Out'){return engine.useattack(name,a,b,{battleState:state,attackerSide:state.sides.player,defenderSide:state.sides.enemy,attackerTeam:[a],defenderTeam:[b]});}
test('Bluff priority +3 beats speed and Extreme Speed; flinch cancels damage/PP and expires at round end',()=>fixed(()=>{
    const a=mon(),b=mon(['Extreme Speed']),s=engine.createBattleState();a.currentSpeed=1;b.currentSpeed=999;
    const order=engine.orderBattleActions([{pokemon:a,moveName:'Fake Out'},{pokemon:b,moveName:'Extreme Speed'}],s);
    assert.equal(order[0].pokemon,a);assert(hit(a,b,s).damage>0);assert.equal(b.__battle.flinch,true);
    const pp=b.movePp[0],r=hit(b,a,s,'Extreme Speed');assert.equal(r.actionPrevented,true);assert.match(r.messages.join(' '),/apeuré/);
    assert.equal(a.currentHp,1000);assert.equal(b.movePp[0],pp);
    engine.processEndOfRound(a,b,s.sides.player,s.sides.enemy,s);assert.equal(b.__battle.flinch,false);
    assert(hit(b,a,s,'Extreme Speed').damage>0);
}));
test('Bluff works only on first move attempt, even after sleep; re-entry resets eligibility, checkpoint preserves it',()=>fixed(()=>{
    for(const first of ['Fake Out','Splash','sleep']) {
        const a=mon(),b=mon(),s=engine.createBattleState();
        if(first==='sleep')engine.applyStatus(a,'sleep',null,[],{turns:2});
        hit(a,b,s,first==='Splash'?'Splash':'Fake Out');
        engine.processEndOfRound(a,b,s.sides.player,s.sides.enemy,s);
        const copy=codec.decode(codec.encode(a)),hp=b.currentHp,pp=copy.movePp[0];
        const r=hit(copy,b,s);assert(r.blocked);assert.equal(r.damage,0);assert.equal(b.currentHp,hp);assert.equal(copy.movePp[0],pp-1);assert.match(r.messages.join(' '),/première action/);
        const team=[copy,mon()];switchPokemonByIndex(team,1);switchPokemonByIndex(team,1);
        engine.applySwitchInEffects(copy,s.sides.player,s.sides.enemy,s,b);
        assert(hit(copy,b,s).damage>0);
    }
}));
test('Attention and Écran Poudre explain protection; Brise Moule really bypasses both through action resolution',()=>fixed(()=>{
    for(const ability of ['Inner Focus','Shield Dust'])for(const breaker of [false,true]) {
        const a=mon(),b=mon(['Tackle']),s=engine.createBattleState();b.passiveAbility=ability;if(breaker)a.passiveAbility='Mold Breaker';
        const r=hit(a,b,s);assert(r.damage>0);assert.equal(Boolean(b.__battle.flinch),breaker);
        if(!breaker)assert.match(r.messages.join(' '),/empêche l’apeurement/);
        const answer=hit(b,a,s,'Tackle');assert.equal(Boolean(answer.actionPrevented),breaker);
        if(!breaker)assert(answer.damage>0);
    }
}));
test('Sans Limite removes flinch intentionally; clones, Protect, Ghost and already-spent actions cannot be flinched',()=>fixed(()=>{
    for(const reason of ['sheer_force','substitute','protect','ghost','already_acted']) {
        const a=mon(),b=mon(['Splash']),s=engine.createBattleState();engine.ensureBattleData(b);
        if(reason==='sheer_force')a.passiveAbility='Sheer Force';
        if(reason==='substitute')b.__battle.substituteHp=1000;
        if(reason==='protect')b.__battle.protect=true;
        if(reason==='ghost')b.type1='Ghost';
        if(reason==='already_acted')hit(b,a,s,'Splash');
        const r=hit(a,b,s);assert(!b.__battle.flinch,reason);
        if(reason==='sheer_force')assert.match(r.messages.join(' '),/Sans Limite/);
        if(['protect','ghost'].includes(reason))assert.equal(r.damage,0);
    }
}));
for(const mode of ['rift','colosseum'])test(`${mode}: real queue cancels flinched animation and prevents consecutive Bluff`,()=>fixed(()=>{
    const player=(id,moves)=>({userId:id,run:{mode},equipe:{pokemons:[mon(moves)]},drifts:[],equipped:[],items:{},money:0,defeated:new Set()});
    const a=player(1,['Fake Out']),b=player(2,['Tackle']),events=[];a.equipe.pokemons[0].currentSpeed=1;b.equipe.pokemons[0].currentSpeed=999;
    const battle=new DriftBattle(a,b,{type:'pvp',random:()=>0.5,paceMs:0,emit:(viewer,name,payload)=>{if(viewer===a)events.push({name,payload});}});
    const turn=()=>{battle.action(a,{action:'attack',number:0,turnId:battle.token});battle.action(b,{action:'attack',number:0,turnId:battle.token});};
    turn();assert.equal(a.equipe.pokemons[0].currentHp,1000);assert(events.some(e=>e.name==='battleText'&&/apeuré/.test(e.payload.message)));
    assert(!events.some(e=>e.name==='battleMoveAnimation'&&e.payload.actor==='opponent'));
    battle.request();events.length=0;turn();
    const failed=events.find(e=>e.name==='battleMoveResult'&&e.payload.actor==='player');assert.equal(failed.payload.damage,0);assert.equal(failed.payload.blocked,true);
    assert(events.some(e=>e.name==='battleMoveAnimation'&&e.payload.actor==='opponent'));
}));

test('after a knockout, a fresh action queue overrides the survivor’s previous action marker',()=>fixed(()=>{
    const {planTurnActions}=require('../server/game/battle/turnActions');
    for(const alreadyActed of [false,true]) {
        const a=mon(),b=mon(['Splash']),s=engine.createBattleState();
        engine.ensureBattleData(b).lastActionTurn=s.turn;
        planTurnActions(s,[{pokemon:a,action:'attack',moveName:'Fake Out'},{pokemon:b,action:'attack',moveName:'Splash'}]);
        if(alreadyActed)hit(b,a,s,'Splash');
        assert(hit(a,b,s).damage>0);
        assert.equal(Boolean(b.__battle.flinch),!alreadyActed);
        if(!alreadyActed)assert(hit(b,a,s,'Splash').actionPrevented);
    }
}));
