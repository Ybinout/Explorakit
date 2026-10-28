const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const mysql = require('mysql2/promise');

const shouldRun = process.env.RUN_MYSQL_TESTS === '1';
const testDatabaseName = process.env.DB_TEST_NAME || `${process.env.DB_NAME || 'pokemon_game'}_test`;

process.env.NODE_ENV = 'test';
process.env.BATTLE_DELAY_SCALE = '0';

const Pokemon = require('../server/game/models/Pokemon');
const Team = require('../server/game/models/Team');
const startWildBattle = require('../server/game/battle/wildBattle');
const startTrainerBattle = require('../server/game/battle/trainerBattle');
const { startPvpBattle } = require('../server/game/battle/pvpBattle');
const { createUserWithStarter } = require('../server/persistence/userRepository');
const { loadEquipe } = require('../server/persistence/teamRepository');
const { loadUserItems } = require('../server/persistence/itemRepository');

class ScriptedSocket extends EventEmitter {
    constructor(actions = []) {
        super();
        this.actions = [...actions];
        this.outgoing = [];
    }

    emit(eventName, payload) {
        this.outgoing.push({ eventName, payload });
        if (eventName === 'requestAction') {
            if (payload.replacementId) this.lastReplacementId=payload.replacementId;
            else if (this.lastReplacementId) setImmediate(()=>super.emit('actionResponse',{action:'attack',number:0,replacementId:this.lastReplacementId}));
            const action = this.actions.shift() || { action: 'flee' };
            setImmediate(() => super.emit('actionResponse', { ...action, ...(payload.replacementId ? {replacementId:payload.replacementId} : {}) }));
            return true;
        }
        return super.emit(eventName, payload);
    }
}

class RecordingIo {
    constructor(socketsById = {}) {
        this.events = [];
        this.sockets = { sockets: new Map(Object.entries(socketsById)) };
    }

    to(targetId) {
        return {
            emit: (eventName, payload) => {
                this.events.push({ targetId, eventName, payload });
            }
        };
    }

    lastEvent(targetId, eventName) {
        return [...this.events]
            .reverse()
            .find((event) => event.targetId === targetId && event.eventName === eventName);
    }
}

function createTestPool() {
    if (!/test/i.test(testDatabaseName)) {
        throw new Error('DB_TEST_NAME doit contenir « test » pour protéger la base de jeu.');
    }
    return mysql.createPool({
        host: process.env.DB_HOST || 'localhost',
        port: Number(process.env.DB_PORT || 3306),
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASSWORD || '',
        database: testDatabaseName,
        connectionLimit: 2
    });
}

function createPokemon(id, name, moves = ['Tackle']) {
    const pokemon = new Pokemon(id, name, 5, 64, {
        attack: 20,
        defense: 20,
        hp: 20,
        specialAttack: 20,
        specialDefense: 20,
        speed: 20
    }, 'Bashful', 2);
    for (const move of moves) pokemon.addAbility(move);
    return pokemon;
}

for (const kind of ['wild','trainer','pvp']) test(`Sommeil ${kind} : premier tour bloqué, réveil avant animation, aucun faux PP ni dégât`, {skip:!shouldRun}, async()=>{
    const pool=createTestPool(); let userId;
    try {
        const {user,player}=await createPlayer(7);userId=user.id;
        const active=createPokemon(7,'Lanceur',['Spore','Splash']),enemy=createPokemon(19,'Dormeur');
        active.truename='Lanceur';enemy.truename='Dormeur';
        for(const p of [active,enemy]) {p.passiveAbility=null;p.heldItem=null;p.currentHp=p.maxHp=1000;}
        active.currentSpeed=999;player.equipe=createTeam(active);
        const rival={id:'sleep-rival',equipe:createTeam(enemy)};
        const io=new RecordingIo({[player.id]:new ScriptedSocket([{action:'attack',number:0},{action:'attack',number:1},{action:'flee'}]),
            [rival.id]:new ScriptedSocket([{action:'attack',number:0},{action:'attack',number:0},{action:'flee'}])});
        const pp=enemy.movePp[0];
        await withFixedRandom(0,()=>kind==='wild'?startWildBattle(player,enemy,io,userId):kind==='trainer'?startTrainerBattle(player,rival.equipe,io,userId):startPvpBattle(player,rival,io));
        const events=io.events.filter(e=>e.targetId===player.id);
        const results=events.filter(e=>e.eventName==='battleMoveResult'&&e.payload.actor==='opponent');
        assert.equal(results.length,2);assert.equal(results[0].payload.success,false);assert.equal(results[0].payload.damage,0);assert(results[1].payload.damage>0);
        assert.equal(enemy.movePp[0],pp-1);
        const animations=events.filter(e=>e.eventName==='battleMoveAnimation'&&e.payload.actor==='opponent');assert.equal(animations.length,1);
        const asleep=events.findIndex(e=>e.eventName==='battleText'&&/Dormeur dort/.test(e.payload.message));
        const wake=events.findIndex(e=>e.eventName==='battleText'&&/Dormeur se reveille/.test(e.payload.message));
        assert(asleep>=0&&wake>asleep);assert(events.indexOf(animations[0])>wake);
        assert.equal(events.filter(e=>e.eventName==='battleText'&&/Dormeur.*utilise Tackle/.test(e.payload.message)).length,1);
    } finally {if(userId)await pool.execute('DELETE FROM users WHERE id=?',[userId]);await pool.end();}
});

function createTeam(...pokemons) {
    const team = new Team();
    for (const pokemon of pokemons) team.ajouterPokemon(pokemon);
    return team;
}

for(const kind of ['wild','trainer'])test(`Régression ${kind}: Miroir Magik au switch ne consomme pas le premier Bluff`,{skip:!shouldRun},async()=>{
    const pool=createTestPool();let userId;
    try {
        const {user,player}=await createPlayer(7);userId=user.id;
        const lead=createPokemon(7,'Premier',['Splash']),reserve=createPokemon(52,'Relais',['Fake Out']),enemy=createPokemon(19,'Cible',['Growl']);
        for(const p of [lead,reserve,enemy]){p.passiveAbility=null;p.heldItem=null;p.currentHp=p.maxHp=1000;}
        reserve.passiveAbility='Magic Bounce';player.equipe=createTeam(lead,reserve);
        const io=new RecordingIo({[player.id]:new ScriptedSocket([{action:'change',number:1},{action:'attack',number:0},{action:'flee'}])});
        await withFixedRandom(0.5,()=>kind==='wild'?startWildBattle(player,enemy,io,userId):startTrainerBattle(player,createTeam(enemy),io,userId));
        const result=io.events.find(e=>e.eventName==='battleMoveResult'&&e.payload.actor==='player'&&e.payload.moveName==='Fake Out');
        assert(result?.payload.damage>0);assert(!result.payload.blocked);
        assert(io.events.some(e=>e.eventName==='battleText'&&/Miroir Magik/.test(e.payload.message)));
        assert(io.events.some(e=>e.eventName==='battleText'&&/apeuré/.test(e.payload.message)));
        assert.equal((await loadEquipe(userId)).pokemons.find(p=>p.uuid===reserve.uuid).movePp[0],9);
    }finally{if(userId)await pool.execute('DELETE FROM users WHERE id=?',[userId]);await pool.end();}
});

for (const kind of ['wild','trainer','pvp']) test(`Bluff ${kind} : priorité, apeurement sans attaque fantôme, puis échec au tour suivant`, {skip:!shouldRun}, async()=>{
    const pool=createTestPool();let userId;
    try {
        const {user,player}=await createPlayer(7);userId=user.id;
        const active=createPokemon(52,'Bluffeur',['Fake Out']),enemy=createPokemon(19,'Cible');
        for(const p of [active,enemy]) {p.passiveAbility=null;p.heldItem=null;p.currentHp=p.maxHp=1000;}
        active.currentSpeed=1;enemy.currentSpeed=999;player.equipe=createTeam(active);
        const rival={id:'fake-out-rival',equipe:createTeam(enemy)};
        const actions=[{action:'attack',number:0},{action:'attack',number:0},{action:'flee'}];
        const io=new RecordingIo({[player.id]:new ScriptedSocket(actions),[rival.id]:new ScriptedSocket(actions)});
        const pp=enemy.movePp[0];
        await withFixedRandom(0.5,()=>kind==='wild'?startWildBattle(player,enemy,io,userId):kind==='trainer'?startTrainerBattle(player,rival.equipe,io,userId):startPvpBattle(player,rival,io));
        const events=io.events.filter(e=>e.targetId===player.id),results=events.filter(e=>e.eventName==='battleMoveResult');
        assert.equal(results[0].payload.actor,'player');assert(results[0].payload.damage>0);
        assert.equal(results[1].payload.actor,'opponent');assert.equal(results[1].payload.damage,0);
        const next=results.filter(e=>e.payload.actor==='player')[1];assert.equal(next.payload.damage,0);assert(next.payload.blocked);
        assert.equal(enemy.movePp[0],pp-1);assert.equal(active.movePp[0],8);
        assert.equal(events.filter(e=>e.eventName==='battleMoveAnimation'&&e.payload.actor==='opponent').length,1);
        assert(events.some(e=>e.eventName==='battleText'&&/apeuré/.test(e.payload.message)));
        assert(events.some(e=>e.eventName==='battleText'&&/Bluff échoue/.test(e.payload.message)));
    } finally {if(userId)await pool.execute('DELETE FROM users WHERE id=?',[userId]);await pool.end();}
});

test('ordre de l’équipe : sauvegarde en plein combat/arène et premier compagnon K.O. au combat suivant', {skip:!shouldRun}, async()=>{
    const pool=createTestPool();let id;
    try {
        const fixture=await createPlayer(7);id=fixture.user.id;const player=fixture.player;
        const a=createPokemon(7,'Premier'),b=createPokemon(4,'Deuxième'),c=createPokemon(25,'Troisième');
        player.equipe=createTeam(a,b,c);const original=[a.uuid,b.uuid,c.uuid];
        const {rememberPartyOrder,restorePartyOrder}=require('../server/game/battle/partyOrder');
        const {switchPokemonByIndex}=require('../server/game/battle/battleTeam');
        const {editEquipe}=require('../server/persistence/teamRepository');
        rememberPartyOrder(player.equipe);switchPokemonByIndex(player.equipe,2);
        await editEquipe(id,player.equipe);
        assert.equal(player.equipe.pokemons[0],c);assert.deepEqual((await loadEquipe(id)).pokemons.map(p=>p.uuid),original);
        const enemy=createPokemon(19,'Victime'),tracker=new (require('../server/game/battle/adventureExperience').AdventureExperience)();
        tracker.enter(c,enemy);enemy.currentHp=0;
        await require('../server/game/battle/arenaExperience').createArenaExperience('order_fixture',[enemy]).reward(id,player,enemy,2,new RecordingIo(),tracker);
        assert.equal(player.equipe.pokemons[0],c);assert.deepEqual((await loadEquipe(id)).pokemons.map(p=>p.uuid),original);
        const captured=createPokemon(16,'Capturé');player.equipe.ajouterPokemon(captured);original.push(captured.uuid);
        await editEquipe(id,player.equipe);assert.deepEqual((await loadEquipe(id)).pokemons.map(p=>p.uuid),original);
        restorePartyOrder(player.equipe);a.currentHp=0;
        const foe=createPokemon(19,'Suivant',['Splash']),socket=new ScriptedSocket([{action:'flee'}]),io=new RecordingIo({[player.id]:socket});
        const activeAtIntro=[],baseTo=io.to.bind(io);io.to=target=>({emit:(name,payload)=>{if(name==='introAnimation')activeAtIntro.push(payload.player.equipe.pokemons[0].uuid);baseTo(target).emit(name,payload);}});
        await withFixedRandom(.5,()=>startWildBattle(player,foe,io,id));
        assert.equal(activeAtIntro[0],b.uuid);assert.deepEqual(player.equipe.pokemons.map(p=>p.uuid),original);
        assert.deepEqual((await loadEquipe(id)).pokemons.map(p=>p.uuid),original);assert.equal(a.currentHp,0);
    } finally {if(id)await pool.execute('DELETE FROM users WHERE id=?',[id]);await pool.end();}
});

test('arène : première victime récompensée une seule fois malgré défaite et reconnexion, puis XP du suivant', {skip:!shouldRun}, async()=>{
    const pool=createTestPool();let id;
    try {
        const fixture=await createPlayer(7);id=fixture.user.id;const player=fixture.player;
        player.equipe=createTeam(createPokemon(7,'Compagnon'));
        const initial=player.equipe.pokemons[0].experience;
        async function attempt(lose) {
            player.equipe.pokemons.forEach(p=>{p.currentHp=p.maxHp;p.status='normal';p.movePp=p.abilities.map(()=>35);});
            const first=createPokemon(19,'Premier',['Splash']);first.currentHp=1;first.__battle={ingrain:true}; // Keep this XP-receipt fixture in its original slot.
            // Same species in two original slots must have separate XP receipts.
            const last=lose?require('../server/game/drift/pokemonFactory').create(19,100,true):createPokemon(19,'Second',['Splash']);
            last.abilities=lose?['Tackle']:['Splash'];last.movePp=[35];if(!lose)last.currentHp=1;
            const socket=new ScriptedSocket(Array.from({length:5},()=>({action:'attack',number:0}))),io=new RecordingIo({[player.id]:socket});
            await withFixedRandom(.5,()=>startTrainerBattle(player,createTeam(first,last),io,id,{experienceKind:'arena',arenaBattleKey:'anti_farm_fixture'}));
            return io;
        }
        const first=await attempt(true);
        assert.equal(first.lastEvent(player.id,'endbattle').payload.reason,'defeat');
        assert.equal(first.events.filter(e=>e.eventName==='battleExperience').length,1);
        player.equipe=await loadEquipe(id);const afterFirst=player.equipe.pokemons[0].experience;assert(afterFirst>initial);
        const second=await attempt(true);
        assert.equal(second.lastEvent(player.id,'endbattle').payload.reason,'defeat');
        assert.equal(second.events.filter(e=>e.eventName==='battleExperience').length,0);
        assert.deepEqual(second.lastEvent(player.id,'endbattle').payload.summary.experience,[]);
        player.equipe=await loadEquipe(id);assert.equal(player.equipe.pokemons[0].experience,afterFirst);
        const third=await attempt(false);
        assert.equal(third.lastEvent(player.id,'endbattle').payload.reason,'victory');
        assert.equal(third.events.filter(e=>e.eventName==='battleExperience').length,1);
        assert((await loadEquipe(id)).pokemons[0].experience>afterFirst);
        const [receipts]=await pool.execute("SELECT flag_key FROM player_story_flags WHERE user_id=? AND flag_key LIKE 'arena_xp:%'",[id]);
        assert.deepEqual(receipts.map(r=>r.flag_key).sort(),['arena_xp:anti_farm_fixture:0','arena_xp:anti_farm_fixture:1']);
    } finally {if(id)await pool.execute('DELETE FROM users WHERE id=?',[id]);await pool.end();}
});

test('arène : reçu et équipe atomiques, ordre stable, concurrence et rollback sans animation XP fantôme', {skip:!shouldRun}, async()=>{
    const pool=createTestPool();let id,otherId;
    try {
        const {createArenaExperience}=require('../server/game/battle/arenaExperience');
        const {AdventureExperience}=require('../server/game/battle/adventureExperience');
        const {editEquipe}=require('../server/persistence/teamRepository');
        const fixture=await createPlayer(7);id=fixture.user.id;const p=fixture.player,lead=p.equipe.pokemons[0],base=lead.experience;
        const a=createPokemon(19,'A'),b=createPokemon(19,'B'),roster=[a,b],gate=createArenaExperience('receipt_fixture',roster);
        const tracker=new AdventureExperience();tracker.enter(lead,a);tracker.enter(lead,b);a.currentHp=b.currentHp=0;
        roster.reverse();const io=new RecordingIo();
        // Force an SQL write failure after training was staged; neither reward nor event survives.
        const uuid=lead.uuid;lead.uuid='x'.repeat(200);
        tracker.participants.set(b,new Set([lead.uuid]));
        await assert.rejects(gate.reward(id,p,b,2,io,tracker));lead.uuid=uuid;tracker.participants.set(b,new Set([uuid]));
        assert.equal(lead.experience,base);assert.equal(io.events.length,0);assert(!tracker.rewarded.has(b));
        const [[count]]=await pool.execute("SELECT COUNT(*) AS n FROM player_story_flags WHERE user_id=? AND flag_key LIKE 'arena_xp:%'",[id]);assert.equal(count.n,0);
        Object.defineProperty(lead,'__heldItemOrigin',{value:lead,writable:true,configurable:true});
        Object.defineProperty(lead,'__heldItemBeforeExchange',{value:'leftovers',writable:true,configurable:true});
        lead.heldItem='life_orb';lead.__battle={stages:{speed:3}};
        const gained=await gate.reward(id,p,b,2,io,tracker);assert.equal(gained.length,1);
        assert.equal(lead.__heldItemOrigin,lead);assert.equal(lead.heldItem,'life_orb');assert.equal(lead.__battle.stages.speed,3);
        assert.equal((await loadEquipe(id)).pokemons[0].heldItem,'leftovers','mid-battle save contains permanent item, not the exchanged one');
        assert.equal((await loadEquipe(id)).pokemons[0].experience,lead.experience);
        const [flags]=await pool.execute("SELECT flag_key FROM player_story_flags WHERE user_id=? AND flag_key LIKE 'arena_xp:%'",[id]);assert.deepEqual(flags.map(r=>r.flag_key),['arena_xp:receipt_fixture:1']);
        // Same account/slot, newly constructed opponents and concurrent requests: exactly one gain.
        const before=lead.experience;
        const grants=await Promise.all([0,1].map(async()=>{
            const player={...p,equipe:await loadEquipe(id)},enemy=createPokemon(19,'Nouveau UUID'),t=new AdventureExperience();
            t.enter(player.equipe.pokemons[0],enemy);enemy.currentHp=0;
            return createArenaExperience('concurrent_fixture',[enemy]).reward(id,player,enemy,2,new RecordingIo(),t);
        }));
        assert.equal(grants.filter(result=>result.length).length,1);
        assert.equal((await loadEquipe(id)).pokemons[0].experience,before+grants.flat()[0].xp);
        const other=await createPlayer(7);otherId=other.user.id;const t=new AdventureExperience();b.currentHp=1;t.enter(other.player.equipe.pokemons[0],b);b.currentHp=0;
        assert.equal((await createArenaExperience('receipt_fixture',[a,b]).reward(otherId,other.player,b,2,new RecordingIo(),t)).length,1);
        // No surviving participant means no XP was given: the slot remains available on retry.
        const noXpGate=createArenaExperience('no_recipient_fixture',[a]),noXpTracker=new AdventureExperience();
        const alive=other.player.equipe.pokemons[0];a.currentHp=1;noXpTracker.enter(alive,a);a.currentHp=0;alive.currentHp=0;
        assert.equal((await noXpGate.reward(otherId,other.player,a,2,new RecordingIo(),noXpTracker)).length,0);
        const [[empty]]=await pool.execute("SELECT COUNT(*) AS n FROM player_story_flags WHERE user_id=? AND flag_key='arena_xp:no_recipient_fixture:0'",[otherId]);assert.equal(empty.n,0);
        alive.currentHp=alive.maxHp;a.currentHp=1;const retry=new AdventureExperience();retry.enter(alive,a);a.currentHp=0;
        assert.equal((await noXpGate.reward(otherId,other.player,a,2,new RecordingIo(),retry)).length,1);
        // Missing identities fail closed; ordinary trainers do not use this gate.
        assert.throws(()=>createArenaExperience(undefined,[a]));
        await editEquipe(id,await loadEquipe(id));
    } finally {for(const userId of [id,otherId])if(userId)await pool.execute('DELETE FROM users WHERE id=?',[userId]);await pool.end();}
});

function withFixedRandom(value, work) {
    const previousRandom = Math.random;
    Math.random = () => value;
    return Promise.resolve()
        .then(work)
        .finally(() => {
            Math.random = previousRandom;
        });
}

async function createPlayer(starterId = 1) {
    const username = `battle_${Date.now()}_${Math.floor(Math.random() * 100000)}`;
    const user = await createUserWithStarter(username, 'mot-de-passe-test', { starterId });
    return {
        user,
        player: {
            id: `socket-${user.id}`,
            userId: user.id,
            username,
            equipe: await loadEquipe(user.id)
        }
    };
}

test.after(async () => {
    if (!shouldRun) return;
    const { dbPool } = require('../server/config/database');
    await dbPool.end();
});

for (const kind of ['wild','trainer','pvp']) for (const ability of ['Limber','Imposter']) {
    test(`Morphing/Mouchoir Choix ${kind} ${ability}: vraie copie, ordre du tour suivant, PP et restauration SQL`, {skip:!shouldRun}, async()=>{
        const pool=createTestPool(); let userId;
        try {
            const {user,player}=await createPlayer(7);userId=user.id;
            const factory=require('../server/game/drift/pokemonFactory');
            const ditto=factory.create(132,40,true),enemy=factory.create(94,40,true);
            for(const p of [ditto,enemy]){p.currentHp=p.maxHp=10000;p.status='normal';p.heldItem=null;}
            ditto.passiveAbility=ability;ditto.heldItem='choice_scarf';ditto.abilities=['Transform'];ditto.movePp=[10];ditto.currentSpeed=40;
            enemy.passiveAbility='Levitate';enemy.abilities=['Tackle'];enemy.movePp=[35];enemy.currentSpeed=200;
            player.equipe=createTeam(ditto);player.currentmap='route1';
            const {editEquipe}=require('../server/persistence/teamRepository');await editEquipe(userId,player.equipe);
            const rival={id:'transform-rival',equipe:createTeam(enemy)};
            const io=new RecordingIo({[player.id]:new ScriptedSocket([{action:'attack',number:0},{action:'attack',number:0},{action:'flee'}]),
                [rival.id]:new ScriptedSocket([{action:'attack',number:0},{action:'attack',number:0},{action:'flee'}])});
            const emitTo=io.to.bind(io);let observedCopy=false;
            io.to=target=>({emit:(event,payload)=>{
                if(ditto.__battle?.transformed){
                    observedCopy=true;assert.equal(ditto.currentSpeed,200);assert.equal(ditto.__battle.transformSpriteId,94);
                    assert.equal(require('../server/game/battle/battleEngine').getBattleSpeed(ditto),300);
                    assert.deepEqual(ditto.abilities,['Tackle']);assert(ditto.movePp[0]<=5);assert.equal(ditto.passiveAbility,'Levitate');
                }
                emitTo(target).emit(event,JSON.parse(JSON.stringify(payload)));
            }});
            await withFixedRandom(.5,()=>kind==='wild'?startWildBattle(player,enemy,io,userId):kind==='trainer'?startTrainerBattle(player,rival.equipe,io,userId):startPvpBattle(player,rival,io));
            assert(observedCopy);
            const animations=io.events.filter(e=>e.targetId===player.id&&e.eventName==='battleMoveAnimation').map(e=>e.payload.actor);
            assert.deepEqual(animations.slice(0,4),ability==='Imposter'?['player','opponent','player','opponent']:['opponent','player','player','opponent']);
            assert.equal(ditto.data.id,132);assert.deepEqual(ditto.abilities,['Transform']);assert.equal(ditto.passiveAbility,ability);assert.equal(ditto.heldItem,'choice_scarf');assert(!ditto.__battle);
            assert.deepEqual(ditto.movePp,[ability==='Imposter'?10:9]);
            await editEquipe(userId,player.equipe);const saved=(await loadEquipe(userId)).pokemons[0];
            assert.equal(saved.data.id,132);assert.deepEqual(saved.abilities,['Transform']);assert.deepEqual(saved.movePp,ditto.movePp);assert.equal(saved.passiveAbility,ability);assert.equal(saved.heldItem,'choice_scarf');
        } finally {if(userId)await pool.execute('DELETE FROM users WHERE id=?',[userId]);await pool.end();}
    });
}

test('capture Aventure SQL : vrais badges uniquement, forte pénalité avant progression, capture normale après six badges et anti-usurpation', {skip:!shouldRun},async()=>{
 const pool=createTestPool();let id;
 try{
  const fixture=await createPlayer(7);id=fixture.user.id;const p=fixture.player;p.currentmap='route1';
  p.equipe.pokemons=[require('../server/game/drift/pokemonFactory').create(7,80,true)];
  await require('../server/persistence/teamRepository').editEquipe(id,p.equipe);
  await pool.execute("INSERT INTO user_items(user_id,item_key,quantity) VALUES(?,'hyperball',5) ON DUPLICATE KEY UPDATE quantity=5",[id]);
  async function run(){const wild=require('../server/game/drift/pokemonFactory').create(19,60,true);wild.abilities=['Splash'];wild.movePp=[40];wild.currentHp=1;
   const socket=new ScriptedSocket([{action:'bag',itemKey:'hyperball',badgeCount:8,capturePolicy:{comfortableLevel:100}}, {action:'flee'}]),io=new RecordingIo({[p.id]:socket});
   p.badgeCount=8;p.badges=Array.from({length:8},()=>({earned:true}));
   await withFixedRandom(.01,()=>startWildBattle(p,wild,io,id));return io;
  }
  const first=await run(),low=first.lastEvent(p.id,'captureAnimation').payload;
  assert.equal(low.success,false);assert(low.chance>0&&low.chance<.001);assert.equal(first.lastEvent(p.id,'endbattle').payload.reason,'fled');
  assert.equal(first.lastEvent(p.id,'introAnimation').payload.capturePolicy.badgeCount,0);
  assert.equal(first.lastEvent(p.id,'introAnimation').payload.capturePolicy.comfortableLevel,27);
  assert.equal((await loadUserItems(id)).find(i=>i.key==='hyperball').quantity,4);assert.equal((await loadEquipe(id)).pokemons.length,1);
  for(const key of ['lake_badge','dune_badge','bloom_badge','ore_badge','tide_badge','summit_badge'])await pool.execute('INSERT INTO player_badges(user_id,badge_key) VALUES(?,?)',[id,key]);
  const second=await run(),high=second.lastEvent(p.id,'captureAnimation').payload;
  assert.equal(high.success,true);assert(high.chance>.5);assert.equal(second.lastEvent(p.id,'introAnimation').payload.capturePolicy.badgeCount,6);
  assert.equal(second.lastEvent(p.id,'introAnimation').payload.capturePolicy.comfortableLevel,105);
  assert.equal((await loadUserItems(id)).find(i=>i.key==='hyperball').quantity,3);assert.equal((await loadEquipe(id)).pokemons.length,2);
 }finally{if(id)await pool.execute('DELETE FROM users WHERE id=?',[id]);await pool.end();}
});

test('combat sauvage réel : capture, objet consommé et équipe persistée', { skip: !shouldRun }, async () => {
    const pool = createTestPool();
    let userId = null;
    try {
        const fixture = await createPlayer(1);
        userId = fixture.user.id;
        const { player } = fixture;
        player.currentmap = 'start';
        const beforeOran = (await loadUserItems(userId)).find(item=>item.key==='oran_berry')?.quantity || 0;
        const beforeEv = { ...player.equipe.pokemons[0].ev };
        const wildPokemon = createPokemon(19, 'Rattata');
        wildPokemon.maxHp = 100;
        wildPokemon.currentHp = 1;

        const socket = new ScriptedSocket([{ action: 'bag', itemKey: 'hyperball' }]);
        const io = new RecordingIo({ [player.id]: socket });
        const result = await withFixedRandom(0, () => startWildBattle(player, wildPokemon, io, userId));

        assert.equal(io.events.find(e => e.eventName === 'battleFieldState').payload.weather.kind, 'rain');
        assert.equal(result, true);
        assert.equal(io.lastEvent(player.id, 'captureAnimation')?.payload.success, true);
        assert.equal(io.lastEvent(player.id, 'endbattle')?.payload.reason, 'captured');
        const summary = io.lastEvent(player.id, 'endbattle').payload.summary;
        assert.equal(summary.outcome, 'captured');
        assert.equal(summary.mode, 'adventure');
        assert.equal(summary.capturedPokemon.uuid, wildPokemon.uuid);
        assert.equal(summary.capturedPokemon.pokemonId, 19);
        assert.deepEqual(summary.loot, ['Baie Oran']);
        assert.equal((await loadUserItems(userId)).find(item=>item.key==='oran_berry')?.quantity,beforeOran+1);
        assert.equal(io.events.filter(e=>e.eventName==='battleText'&&/Objet trouvé/.test(e.payload.message)).length,1);
        assert.equal(summary.money, Math.floor((20 + wildPokemon.level * 2) * 1.5));
        const [[wallet]] = await pool.execute('SELECT money FROM users WHERE id=?',[userId]);
        assert.equal(wallet.money, summary.money);
        assert.deepEqual(summary.experience, []);
        const saved=await loadEquipe(userId);
        assert.equal(saved.pokemons.length, 2);
        assert.equal(saved.pokemons[0].ev.speed,beforeEv.speed+1);
        assert.equal(saved.pokemons[1].ev.speed,0);
        assert.deepEqual(io.events.find(e=>e.eventName==='introAnimation').payload.effortYield,{speed:1});
        const hyperBall = (await loadUserItems(userId)).find((item) => item.key === 'hyperball');
        assert.equal(hyperBall.quantity, 1);
    } finally {
        if (userId) await pool.execute('DELETE FROM users WHERE id = ?', [userId]);
        await pool.end();
    }
});

test('combat sauvage réel : attaque, victoire, expérience et PP persistés', { skip: !shouldRun }, async () => {
    const pool = createTestPool();
    let userId = null;
    try {
        const fixture = await createPlayer(1);
        userId = fixture.user.id;
        const { player } = fixture;
        const beforeOran = (await loadUserItems(userId)).find(item=>item.key==='oran_berry')?.quantity || 0;
        const activePokemon = player.equipe.pokemons[0];
        activePokemon.currentAttack = 999;
        activePokemon.currentSpeed = 999;
        const initialExperience = activePokemon.experience;
        const initialPp = activePokemon.movePp[0];
        const wildPokemon = createPokemon(19, 'Rattata');
        wildPokemon.currentHp = 1;
        const socket = new ScriptedSocket([{ action: 'attack', number: 0 }]);
        const io = new RecordingIo({ [player.id]: socket });

        const result = await withFixedRandom(0, () => startWildBattle(player, wildPokemon, io, userId));
        const persistedPokemon = (await loadEquipe(userId)).pokemons[0];

        assert.equal(result, true);
        assert.equal(io.lastEvent(player.id, 'endbattle')?.payload.reason, 'victory');
        assert.ok(io.events.some((event) => event.eventName === 'battleMoveAnimation'));
        assert.ok(persistedPokemon.experience > initialExperience);
        assert.equal(persistedPokemon.movePp[0], initialPp - 1);
        const summary = io.lastEvent(player.id, 'endbattle').payload.summary;
        assert.equal(summary.outcome, 'victory');
        assert.deepEqual(summary.loot, ['Baie Oran']);
        assert.equal((await loadUserItems(userId)).find(item=>item.key==='oran_berry')?.quantity,beforeOran+1);
        assert.equal(summary.experience[0].xpGained, persistedPokemon.experience - initialExperience);
        assert.equal(summary.money, Math.floor((20 + wildPokemon.level * 2) * 1.5));
        const [[wallet]] = await pool.execute('SELECT money FROM users WHERE id=?',[userId]);
        assert.equal(wallet.money, summary.money);
    } finally {
        if (userId) await pool.execute('DELETE FROM users WHERE id = ?', [userId]);
        await pool.end();
    }
});

test('combat sauvage réel : K.O., changement forcé puis fuite', { skip: !shouldRun }, async () => {
    const pool = createTestPool();
    let userId = null;
    try {
        const fixture = await createPlayer(4);
        userId = fixture.user.id;
        const { player } = fixture;
        const firstPokemon = player.equipe.pokemons[0];
        firstPokemon.currentHp = 1;
        firstPokemon.currentDefense = 1;
        firstPokemon.currentSpeed = 1;
        const replacement = createPokemon(7, 'Remplaçant', ['Water Gun']);
        replacement.currentHp = replacement.maxHp;
        player.equipe.ajouterPokemon(createPokemon(25, 'Autre choix'));
        player.equipe.ajouterPokemon(replacement);

        const wildPokemon = createPokemon(19, 'Rattata');
        wildPokemon.currentAttack = 999;
        wildPokemon.currentSpeed = 999;
        const socket = new ScriptedSocket([
            { action: 'attack', number: 0 },
            { action: 'change', number: 2 },
            { action: 'flee' }
        ]);
        const io = new RecordingIo({ [player.id]: socket });
        const result = await withFixedRandom(0.5, () => startWildBattle(player, wildPokemon, io, userId));

        assert.equal(socket.outgoing.filter(e=>e.eventName==='requestAction'&&e.payload.replacement).length,1);
        assert.equal(result, true);
        assert.equal(firstPokemon.currentHp, 0);
        assert.equal(player.equipe.pokemons[0].uuid, firstPokemon.uuid);
        assert.equal(io.lastEvent(player.id, 'endbattle')?.payload.reason, 'fled');
        assert.equal((await loadEquipe(userId)).pokemons[0].uuid, firstPokemon.uuid);
        const summary = io.lastEvent(player.id, 'endbattle').payload.summary;
        assert.equal(summary.outcome, 'fled');
        assert.deepEqual(summary.lostPokemon, [], 'Le K.O. Aventure reste temporaire');
        assert.deepEqual(summary.experience, []);
    } finally {
        if (userId) await pool.execute('DELETE FROM users WHERE id = ?', [userId]);
        await pool.end();
    }
});

test('combat sauvage réel : défaite terminale persistée', { skip: !shouldRun }, async () => {
    const pool = createTestPool();
    let userId = null;
    try {
        const fixture = await createPlayer(7);
        userId = fixture.user.id;
        const { player } = fixture;
        const activePokemon = player.equipe.pokemons[0];
        activePokemon.currentHp = 1;
        activePokemon.currentDefense = 1;
        activePokemon.currentSpeed = 1;
        const wildPokemon = createPokemon(19, 'Rattata');
        wildPokemon.currentAttack = 999;
        wildPokemon.currentSpeed = 999;
        const socket = new ScriptedSocket([{ action: 'attack', number: 0 }]);
        const io = new RecordingIo({ [player.id]: socket });

        const result = await withFixedRandom(0.5, () => startWildBattle(player, wildPokemon, io, userId));

        assert.equal(result, false);
        assert.equal(io.lastEvent(player.id, 'endbattle')?.payload.reason, 'defeat');
        assert.equal((await loadEquipe(userId)).pokemons[0].currentHp, 0);
        const summary = io.lastEvent(player.id, 'endbattle').payload.summary;
        assert.equal(summary.outcome, 'defeat');
        assert.deepEqual(summary.lostPokemon, []);
        assert.deepEqual(summary.loot, []);
        assert.equal(summary.money, 0);
    } finally {
        if (userId) await pool.execute('DELETE FROM users WHERE id = ?', [userId]);
        await pool.end();
    }
});

test('combat dresseur réel : victoire, récompense et sauvegarde', { skip: !shouldRun }, async () => {
    const pool = createTestPool();
    let userId = null;
    try {
        const fixture = await createPlayer(1);
        userId = fixture.user.id;
        const { player } = fixture;
        player.currentmap = 'start';
        player.equipe.pokemons[0].currentAttack = 999;
        player.equipe.pokemons[0].currentSpeed = 999;
        const enemy = createPokemon(19, 'Adversaire');
        enemy.currentHp = 1;
        const enemyTeam = createTeam(enemy);
        const socket = new ScriptedSocket([{ action: 'attack', number: 0 }]);
        const io = new RecordingIo({ [player.id]: socket });

        const result = await withFixedRandom(0.5, () => startTrainerBattle(player, enemyTeam, io, userId));
        assert.equal(io.events.find(e => e.eventName === 'battleFieldState').payload.weather.kind, 'rain');
        const [[userRow]] = await pool.execute('SELECT money FROM users WHERE id = ?', [userId]);

        assert.equal(result, true);
        assert.equal(io.lastEvent(player.id, 'endbattle')?.payload.reason, 'victory');
        assert.ok(Number(userRow.money) > 0);
        assert.equal((await loadEquipe(userId)).pokemons.length, 1);
    } finally {
        if (userId) await pool.execute('DELETE FROM users WHERE id = ?', [userId]);
        await pool.end();
    }
});

test('combat dresseur réel : changement manuel puis fuite', { skip: !shouldRun }, async () => {
    const pool = createTestPool();
    let userId = null;
    try {
        const fixture = await createPlayer(4);
        userId = fixture.user.id;
        const { player } = fixture;
        const initialOrder=player.equipe.pokemons.map(p=>p.uuid);
        const replacement = createPokemon(7, 'Relève', ['Water Gun']);
        replacement.currentHp = replacement.maxHp;
        player.equipe.ajouterPokemon(replacement);
        const enemy = createPokemon(19, 'Adversaire');
        enemy.currentAttack = 1;
        const socket = new ScriptedSocket([
            { action: 'change', number: 1 },
            { action: 'flee' }
        ]);
        const io = new RecordingIo({ [player.id]: socket });

        const result = await withFixedRandom(0.5, () => startTrainerBattle(player, createTeam(enemy), io, userId));

        assert.equal(result, true);
        assert.deepEqual(player.equipe.pokemons.map(p=>p.uuid),[...initialOrder,replacement.uuid]);
        assert.equal(io.lastEvent(player.id, 'endbattle')?.payload.reason, 'fled');
    } finally {
        if (userId) await pool.execute('DELETE FROM users WHERE id = ?', [userId]);
        await pool.end();
    }
});

test('combat PVP réel : attaques synchronisées et victoire du bon joueur', { skip: !shouldRun }, async () => {
    const pokemonA = createPokemon(1, 'A');
    pokemonA.currentAttack = 999;
    pokemonA.currentSpeed = 999;
    const pokemonB = createPokemon(19, 'B');
    pokemonB.currentHp = 1;
    const playerA = { id: 'pvp-a', currentmap: 'start', username: 'Alice', equipe: createTeam(pokemonA) };
    const playerB = { id: 'pvp-b', currentmap: 'start', username: 'Bob', equipe: createTeam(pokemonB) };
    const io = new RecordingIo({
        [playerA.id]: new ScriptedSocket([{ action: 'attack', number: 0 }]),
        [playerB.id]: new ScriptedSocket([{ action: 'attack', number: 0 }])
    });

    const result = await withFixedRandom(0.5, () => startPvpBattle(playerA, playerB, io));

    assert.equal(io.events.find(e => e.targetId === playerA.id && e.eventName === 'battleFieldState').payload.weather.kind, 'rain');
    assert.equal(io.events.find(e => e.targetId === playerB.id && e.eventName === 'battleFieldState').payload.weather.kind, 'rain');
    assert.deepEqual(result, { winnerId: playerA.id, reason: 'finished' });
    assert.equal(io.lastEvent(playerA.id, 'endbattle')?.payload.playerWon, true);
    assert.equal(io.lastEvent(playerB.id, 'endbattle')?.payload.playerWon, false);
    assert.ok(io.events.some((event) => event.eventName === 'battleMoveAnimation'));
});

test('combat PVP réel : abandon simultané produit un match nul explicite', { skip: !shouldRun }, async () => {
    const playerA = { id: 'pvp-flee-a', username: 'Alice', equipe: createTeam(createPokemon(1, 'A')) };
    const playerB = { id: 'pvp-flee-b', username: 'Bob', equipe: createTeam(createPokemon(4, 'B')) };
    const io = new RecordingIo({
        [playerA.id]: new ScriptedSocket([{ action: 'flee' }]),
        [playerB.id]: new ScriptedSocket([{ action: 'flee' }])
    });

    const result = await startPvpBattle(playerA, playerB, io);

    assert.deepEqual(result, { winnerId: null, reason: 'both_fled' });
    assert.equal(io.lastEvent(playerA.id, 'endbattle')?.payload.draw, true);
    assert.equal(io.lastEvent(playerB.id, 'endbattle')?.payload.draw, true);
});

test('combat PVP réel : une déconnexion retire aussi l’invite adverse sans attendre sa commande', { skip: !shouldRun, timeout: 5000 }, async () => {
    const a = { id: 'pvp-disconnect-a', username: 'Alice', equipe: createTeam(createPokemon(1, 'A')) };
    const b = { id: 'pvp-disconnect-b', username: 'Bob', equipe: createTeam(createPokemon(4, 'B')) };
    class WaitingSocket extends EventEmitter {
        emit(name, payload) {
            if (name === 'requestAction' && this === first) setImmediate(() => { io.sockets.sockets.delete(a.id); super.emit('disconnect'); });
            return super.emit(name, payload);
        }
    }
    const first = new WaitingSocket(), second = new WaitingSocket(), io = new RecordingIo({ [a.id]: first, [b.id]: second });
    assert.deepEqual(await startPvpBattle(a, b, io), { winnerId: b.id, reason: 'opponent_disconnected' });
    assert.equal(first.listenerCount('actionResponse'), 0); assert.equal(second.listenerCount('actionResponse'), 0);
    assert.equal(first.listenerCount('disconnect'), 0); assert.equal(second.listenerCount('disconnect'), 0);
});



test('dresseur : le dernier Pokémon rapporte son XP, une seule fois et jusque dans la sauvegarde', { skip: !shouldRun }, async () => {
    const pool = createTestPool();
    let userId;
    try {
        const { user, player } = await createPlayer(1);
        userId = user.id;
        const active = player.equipe.pokemons[0];
        active.currentAttack = 999;
        active.currentSpeed = 999;
        const before = active.experience;
        const enemy = createPokemon(19, 'Rattata');
        enemy.currentHp = 1;
        enemy.passiveAbility = 'Run Away';
        const { calculateBattleExperience, BATTLE_EXPERIENCE_MULTIPLIERS } = require('../server/game/models/progression');
        const expectedXp = calculateBattleExperience(enemy, BATTLE_EXPERIENCE_MULTIPLIERS.trainer, active);
        const socket = new ScriptedSocket([{ action: 'attack', number: 0 }]);
        const io = new RecordingIo({ [player.id]: socket });
        await withFixedRandom(0.5, () => startTrainerBattle(player, createTeam(enemy), io, userId));
        const saved = (await loadEquipe(userId)).pokemons[0];
        assert.ok(saved.experience > before, 'La dernière victoire de dresseur doit donner de l’XP');
        assert.equal(saved.experience, active.experience);
        assert.equal(saved.experience - before, expectedXp);
        assert.equal(saved.ev.speed, 1, 'Rattata rapporte un EV vitesse');
        const updates = io.events.filter(event => event.eventName === 'battleExperience');
        assert.equal(updates.length, 1);
        assert.equal(updates[0].targetId, player.id);
        assert.equal(updates[0].payload.xpGained, expectedXp);
        assert.equal(updates[0].payload.pokemon.uuid, saved.uuid);
        const summary = io.lastEvent(player.id, 'endbattle').payload.summary;
        assert.equal(summary.outcome, 'victory');
        assert.equal(summary.experience[0].xpGained, expectedXp);
        assert.equal(summary.experience[0].uuid, saved.uuid);
        assert.equal(summary.money, enemy.level * 30);
    } finally {
        if (userId) await pool.execute('DELETE FROM users WHERE id = ?', [userId]);
        await pool.end();
    }
});


test('arène : tous les K.O. donnent le bonus prévu, fuite sans K.O. sans XP', { skip: !shouldRun }, async () => {
    const pool = createTestPool();
    let userId;
    try {
        const { user, player } = await createPlayer(7);
        userId = user.id;
        const active = player.equipe.pokemons[0];
        active.experience = active.getNextLevelExpForLevel(100);
        active.level = 100;
        active.recalculateStats();
        const before = active.experience;
        const first = createPokemon(19, 'Premier');
        const last = createPokemon(16, 'Dernier');
        for (const enemy of [first, last]) { enemy.currentHp = 1; enemy.passiveAbility = null; }
        const { calculateBattleExperience, BATTLE_EXPERIENCE_MULTIPLIERS } = require('../server/game/models/progression');
        const expected = [first, last].reduce((sum, enemy) => sum + Math.max(1, Math.floor(calculateBattleExperience(enemy, BATTLE_EXPERIENCE_MULTIPLIERS.arena, active) * 0.7)), 0);
        const socket = new ScriptedSocket([{ action: 'attack', number: 0 }, { action: 'attack', number: 0 }]);
        await withFixedRandom(0.5, () => startTrainerBattle(player, createTeam(first, last), new RecordingIo({ [player.id]: socket }), userId, { experienceKind: 'arena', arenaBattleKey: 'test_arena' }));
        assert.equal((await loadEquipe(userId)).pokemons[0].experience, before + expected);
        const fleeSocket = new ScriptedSocket([{ action: 'flee' }]);
        await withFixedRandom(0.5, () => startTrainerBattle(player, createTeam(createPokemon(19, 'Intact')), new RecordingIo({ [player.id]: fleeSocket }), userId, { experienceKind: 'arena', arenaBattleKey: 'test_arena' }));
        assert.equal((await loadEquipe(userId)).pokemons[0].experience, before + expected);
    } finally {
        if (userId) await pool.execute('DELETE FROM users WHERE id = ?', [userId]);
        await pool.end();
    }
});

test('wild failed capture gives no money; successful capture with six companions goes to the PC and rewards normally', {skip:!shouldRun},async()=>{
 const pool=createTestPool();let userId;
 try{
  const {user,player}=await createPlayer(1);userId=user.id;
  const run=async(random,temporary=false)=>{
   const target=createPokemon(19,'Rattata',['Growl']);target.currentHp=target.maxHp;const originalAbility=target.passiveAbility;
   if(temporary){target.__passiveAbilityBeforeBattle=originalAbility;target.passiveAbility='Pressure';target.__heldItemBeforeExchange=null;target.heldItem='leftovers';target.__moveAndStatOverrides={abilities:['Growl'],movePp:[40]};target.abilities=['Thunderbolt'];target.movePp=[15];}
   const io=new RecordingIo({[player.id]:new ScriptedSocket([{action:'bag',itemKey:'pokeball'},{action:'flee'}])});
   io.originalAbility=originalAbility;await withFixedRandom(random,()=>startWildBattle(player,target,io,userId));return io;
  };
  let io=await run(.99);assert.equal(io.lastEvent(player.id,'endbattle').payload.summary.money,0);
  let [[wallet]]=await pool.execute('SELECT money FROM users WHERE id=?',[userId]);assert.equal(wallet.money,0);
  io=await run(.17);assert.equal(io.lastEvent(player.id,'endbattle').payload.summary.outcome,'captured');assert.equal(io.lastEvent(player.id,'endbattle').payload.summary.money,45);
  while(player.equipe.pokemons.length<6)player.equipe.pokemons.push(createPokemon(7,'Full team'));
  io=await run(0,true);assert.equal(io.lastEvent(player.id,'endbattle').payload.summary.money,45);
  assert.equal(player.equipe.pokemons.length,6);const stored=await require('../server/persistence/pokemonStorageRepository').loadEntries(userId);assert.equal(stored.length,1);assert.equal(stored[0].pokemon.data.id,19);assert.equal(stored[0].pokemon.passiveAbility,io.originalAbility);assert.equal(stored[0].pokemon.heldItem,null);assert.deepEqual(stored[0].pokemon.abilities,['Growl']);
  [[wallet]]=await pool.execute('SELECT money FROM users WHERE id=?',[userId]);assert.equal(wallet.money,90);
 }finally{if(userId)await pool.execute('DELETE FROM users WHERE id=?',[userId]);await pool.end();}
});

for (const mode of ['wild','trainer']) test(`${mode}: pivot publishes the right entrant before the opponent attacks`, {skip:!shouldRun}, async()=>{
    const pool=createTestPool();let userId;
    try {
        const fixture=await createPlayer(1);userId=fixture.user.id;const {player}=fixture;
        const first=player.equipe.pokemons[0],replacement=createPokemon(7,'Relay');
        first.abilities=['U-turn'];first.movePp=[20];first.currentSpeed=999;first.passiveAbility=null;
        replacement.passiveAbility=null;replacement.maxHp=replacement.currentHp=500;player.equipe.ajouterPokemon(replacement);
        const enemy=createPokemon(19,'Opponent');enemy.passiveAbility=null;enemy.currentSpeed=1;enemy.maxHp=enemy.currentHp=500;
        const socket=new ScriptedSocket([{action:'attack',number:0},{action:'flee'}]);
        const io=new RecordingIo({[player.id]:socket});io.to=targetId=>({emit:(eventName,payload)=>io.events.push({targetId,eventName,payload:JSON.parse(JSON.stringify(payload))})});
        await withFixedRandom(.5,()=>mode==='wild'?startWildBattle(player,enemy,io,userId):startTrainerBattle(player,createTeam(enemy),io,userId));
        const attack=io.events.findIndex(e=>e.eventName==='battleMoveAnimation'&&e.payload.actor==='opponent');assert(attack>0);
        const before=io.events.slice(0,attack).filter(e=>e.eventName==='introAnimation');
        assert.equal(before.at(-1).payload.player.equipe.pokemons[0].uuid,replacement.uuid);
        assert(before.some(e=>e.payload.transitions.some(t=>t.kind==='enter'&&t.uuid===replacement.uuid)));
        assert(before.every(e=>e.payload.wildPokemon.uuid===enemy.uuid),'Player must never appear on the enemy side');
        assert(replacement.currentHp<500,'Enemy attacks the entrant, not the outgoing Pokémon');
    } finally {if(userId)await pool.execute('DELETE FROM users WHERE id=?',[userId]);await pool.end();}
});
test('Adventure trainer voluntary switch consumes its action instead of granting an extra attack', {skip:!shouldRun}, async()=>{
    const pool=createTestPool();let userId;
    try {
        const fixture=await createPlayer(1);userId=fixture.user.id;const {player}=fixture;
        const lead=player.equipe.pokemons[0];lead.passiveAbility=null;lead.maxHp=lead.currentHp=500;lead.abilities=['Growl','Vine Whip'];lead.movePp=[40,25];
        const enemy=createPokemon(7,'Water'),replacement=createPokemon(4,'Fire');enemy.passiveAbility=replacement.passiveAbility=null;
        const socket=new ScriptedSocket([{action:'attack',number:0},{action:'flee'}]);const io=new RecordingIo({[player.id]:socket});
        await withFixedRandom(.5,()=>startTrainerBattle(player,createTeam(enemy,replacement),io,userId));
        assert(io.events.some(e=>e.eventName==='introAnimation'&&e.payload.transitions.some(t=>t.kind==='recall'&&t.side==='opponent')));
        const attacks=io.events.filter(e=>e.eventName==='battleMoveAnimation');assert.deepEqual(attacks.map(e=>e.payload.actor),['player']);
        assert.equal(lead.currentHp,500);assert.equal(replacement.movePp[0],35);
    } finally {if(userId)await pool.execute('DELETE FROM users WHERE id=?',[userId]);await pool.end();}
});


test('combat dresseur réel : K.O. puis choix de la deuxième réserve sans subir un tour supplémentaire', { skip: !shouldRun }, async () => {
    const pool=createTestPool();let userId;
    try {
        const fixture=await createPlayer(4),{player}=fixture;userId=fixture.user.id;
        const lead=player.equipe.pokemons[0];lead.passiveAbility=null;lead.currentHp=1;lead.currentSpeed=1;lead.currentDefense=1;
        const skipped=createPokemon(25,'Premier choix'),chosen=createPokemon(7,'Choix voulu');
        skipped.passiveAbility=chosen.passiveAbility=null;player.equipe.ajouterPokemon(skipped);player.equipe.ajouterPokemon(chosen);
        const enemy=createPokemon(19,'Rival');enemy.passiveAbility=null;enemy.currentAttack=999;enemy.currentSpeed=999;
        const socket=new ScriptedSocket([{action:'attack',number:0},{action:'change',number:2},{action:'flee'}]);
        const io=new RecordingIo({[player.id]:socket}),hp=chosen.currentHp;
        assert.equal(await withFixedRandom(.5,()=>startTrainerBattle(player,createTeam(enemy),io,userId)),true);
        assert.equal(lead.currentHp,0);assert.deepEqual(player.equipe.pokemons.map(p=>p.uuid),[lead.uuid,skipped.uuid,chosen.uuid]);assert.equal(chosen.currentHp,hp);
        assert.equal(chosen.movePp[0],35);assert.equal(socket.outgoing.filter(e=>e.eventName==='requestAction'&&e.payload.replacement).length,1);
        assert.deepEqual((await loadEquipe(userId)).pokemons.map(p=>p.uuid),[lead.uuid,skipped.uuid,chosen.uuid]);
    } finally { if(userId)await pool.execute('DELETE FROM users WHERE id=?',[userId]);await pool.end(); }
});

test('combat PVP réel : le choix après K.O. ne consomme pas une action adverse', { skip: !shouldRun }, async () => {
    const lead=createPokemon(4,'Premier'),reserve=createPokemon(25,'Réserve'),chosen=createPokemon(7,'Choisi'),enemy=createPokemon(19,'Adversaire');
    for(const p of [lead,reserve,chosen,enemy])p.passiveAbility=null;
    lead.currentHp=1;lead.currentDefense=1;lead.currentSpeed=1;enemy.currentSpeed=999;enemy.currentAttack=999;
    const a={id:'choice-a',equipe:createTeam(lead,reserve,chosen)},b={id:'choice-b',equipe:createTeam(enemy)};
    const sa=new ScriptedSocket([{action:'attack',number:0},{action:'change',number:2},{action:'flee'}]);
    const sb=new ScriptedSocket([{action:'attack',number:0},{action:'flee'}]),io=new RecordingIo({[a.id]:sa,[b.id]:sb}),hp=chosen.currentHp;
    await withFixedRandom(.5,()=>startPvpBattle(a,b,io));
    assert.equal(lead.currentHp,0);assert.deepEqual(a.equipe.pokemons.map(p=>p.uuid),[lead.uuid,reserve.uuid,chosen.uuid]);assert.equal(chosen.currentHp,hp);
    assert.equal(sa.outgoing.filter(e=>e.eventName==='requestAction'&&e.payload.replacement).length,1);
    assert.equal(sb.outgoing.filter(e=>e.eventName==='requestAction').length,2);
    assert.equal(io.events.filter(e=>e.targetId===a.id&&e.eventName==='battleMoveAnimation').length,1);
});


for(const kind of ['wild','trainer','pvp'])test(`Morphéo réseau ${kind} : météo immédiate, Ball’Météo Eau et retour normal sauvegardé`,{skip:!shouldRun},async()=>{
    const pool=createTestPool();let userId;
    try{
        const fixture=await createPlayer(7),{player}=fixture;userId=fixture.user.id;player.currentmap='start';
        const cast=require('../server/game/drift/pokemonFactory').create(351,40,true);cast.passiveAbility='Forecast';cast.abilities=['Rain Dance','Weather Ball'];cast.movePp=[5,10];player.equipe=createTeam(cast);
        const enemy=createPokemon(143,'Météorologue',['Splash']);enemy.passiveAbility='Drought';enemy.maxHp=enemy.currentHp=10000;
        const socket=new ScriptedSocket([{action:'attack',number:0},{action:'attack',number:1},{action:'flee'}]);
        const other={id:'weather-opponent',equipe:createTeam(enemy)},otherSocket=new ScriptedSocket([{action:'attack',number:0},{action:'attack',number:0},{action:'flee'}]);
        const io=new RecordingIo({[player.id]:socket,[other.id]:otherSocket});
        const battle=()=>kind==='wild'?startWildBattle(player,enemy,io,userId):kind==='trainer'?startTrainerBattle(player,other.equipe,io,userId):startPvpBattle(player,other,io);
        await withFixedRandom(.5,battle);
        const views=io.events.filter(e=>e.targetId===player.id&&e.eventName==='introAnimation').map(e=>e.payload);
        assert(views.some(v=>v.player.equipe.pokemons[0].__battle?.formSpriteId===10013)||io.events.some(e=>e.eventName==='battleText'&&e.payload.message.includes('Solaire')));
        assert(views.some(v=>v.moveTypes?.[1]==='Water'));
        const ball=io.events.find(e=>e.targetId===player.id&&e.eventName==='battleMoveAnimation'&&e.payload.moveName==='Weather Ball');assert.equal(ball.payload.moveType,'Water');
        const saved=(await loadEquipe(userId)).pokemons[0];assert.equal(saved.data.id,351);assert.equal(saved.type1,'Normal');assert.equal(saved.passiveAbility,'Forecast');assert(!saved.__battle);
    }finally{if(userId)await pool.execute('DELETE FROM users WHERE id=?',[userId]);await pool.end();}
});

test('Mounir Aventure : équipe réelle sous la pluie, Morphéo réservé et transformé, une réplique à l’entrée et récompenses sauvegardées', {skip:!shouldRun}, async()=>{
    const pool=createTestPool(); let userId;
    try {
        const {user,player}=await createPlayer(7); userId=user.id; player.currentmap='ville1_arene';
        const lead=player.equipe.pokemons[0]; lead.experience=lead.getNextLevelExpForLevel(100); lead.level=100; lead.recalculateStats(); lead.currentAttack=999; lead.currentSpeed=999;
        const team=require('../server/game/world/pnjTeamFactory').getPnjTeam('moonpunch');
        const socket=new ScriptedSocket(Array.from({length:10},()=>({action:'attack',number:0})));
        const io=new RecordingIo({[player.id]:socket}), snapshots=[];
        const to=io.to.bind(io);io.to=id=>({emit:(event,payload)=>{if(event==='introAnimation')snapshots.push(JSON.parse(JSON.stringify(payload)));to(id).emit(event,payload);}});
        await withFixedRandom(.5,()=>startTrainerBattle(player,team,io,userId,{experienceKind:'arena',arenaBattleKey:'test_arena'}));
        assert.equal(io.lastEvent(player.id,'endbattle').payload.playerWon,true);
        assert.equal(io.events.find(e=>e.eventName==='battleFieldState').payload.weather.kind,'rain');
        const entries=snapshots.flatMap(s=>s.transitions).filter(e=>e.kind==='enter'&&e.side==='opponent');
        assert.equal(entries.at(-1).uuid,team.__trainerPlan.aceUuid);assert.equal(entries.filter(e=>e.trainerSpeech).length,1);
        assert(snapshots.some(s=>s.wildPokemon.data.id===351&&s.wildPokemon.__battle?.formSpriteId===10014));
        const [[row]]=await pool.execute('SELECT money FROM users WHERE id=?',[userId]);assert(Number(row.money)>0);
        assert.equal((await loadEquipe(userId)).pokemons[0].uuid,lead.uuid);
    } finally {if(userId)await pool.execute('DELETE FROM users WHERE id=?',[userId]);await pool.end();}
});

for (const kind of ['wild','trainer']) for (const levelLead of [0,5]) test(`Multi Exp Aventure ${kind} +${levelLead} : combattant ajusté, réserves à 40 %, K.O. exclu, événements et gains sauvegardés`, {skip:!shouldRun}, async()=>{
    const pool=createTestPool();let userId;
    try {
        const {user,player}=await createPlayer(7);userId=user.id;
        const lead=createPokemon(7,'Actif'),reserve=createPokemon(4,'Réserve'),dead=createPokemon(25,'K.O.');dead.currentHp=0;
        lead.currentAttack=999;lead.currentSpeed=999;player.equipe=createTeam(lead,reserve,dead);
        lead.heldItem='exp_share';
        lead.level += levelLead; lead.experience = lead.getNextLevelExpForLevel(lead.level); lead.recalculateStats();
        lead.currentAttack=999; lead.currentSpeed=999;
        const foe=createPokemon(19,'Cible');foe.currentHp=1;foe.passiveAbility=null;
        const {calculateBattleExperience:xp,BATTLE_EXPERIENCE_MULTIPLIERS:rates}=require('../server/game/models/progression');
        const baseline=[lead,reserve,dead].map(p=>p.experience),full=Math.max(1,Math.floor(xp(foe,rates[kind],lead)*(levelLead>=5?0.7:1))),shared=Math.floor(xp(foe,rates[kind],reserve)*0.4);
        const io=new RecordingIo({[player.id]:new ScriptedSocket([{action:'attack',number:0}])});
        await withFixedRandom(.5,()=>kind==='wild'?startWildBattle(player,foe,io,userId):startTrainerBattle(player,createTeam(foe),io,userId));
        const saved=(await loadEquipe(userId)).pokemons,byId=id=>saved.find(p=>p.uuid===id);
        assert.equal(byId(lead.uuid).experience,baseline[0]+full);assert.equal(byId(reserve.uuid).experience,baseline[1]+shared);assert.equal(byId(dead.uuid).experience,baseline[2]);
        const awards=io.events.filter(e=>e.eventName==='battleExperience');assert.equal(awards.length,2);
        const summary=io.lastEvent(player.id,'endbattle').payload.summary;assert.equal(summary.experience.length,2);
    }finally{if(userId)await pool.execute('DELETE FROM users WHERE id=?',[userId]);await pool.end();}
});

for (const outcome of ['victory','flee','loss']) test(`Butin sauvage Aventure : ${outcome}, vrai combat et tirage contrôlé sans récompense de fuite/défaite`, {skip:!shouldRun}, async()=>{
    const pool=createTestPool();let userId;
    try {
        const {user,player}=await createPlayer(7);userId=user.id;
        const foe=createPokemon(19,'Cible');foe.currentHp=1;foe.passiveAbility=null;
        const lead=player.equipe.pokemons[0];lead.currentAttack=999;lead.currentSpeed=999;
        if(outcome==='loss'){lead.currentHp=1;lead.currentAttack=1;lead.currentSpeed=1;foe.currentHp=foe.maxHp=10000;foe.currentAttack=999;foe.currentSpeed=999;}
        const [[before]]=await pool.execute("SELECT quantity FROM user_items WHERE user_id=? AND item_key='oran_berry'",[userId]);
        const io=new RecordingIo({[player.id]:new ScriptedSocket([{action:outcome==='flee'?'flee':'attack',number:0}])});
        await withFixedRandom(0,()=>startWildBattle(player,foe,io,userId));
        const summary=io.lastEvent(player.id,'endbattle').payload.summary;
        assert.deepEqual(summary.loot,outcome==='victory'?['Baie Oran']:[]);
        const [[after]]=await pool.execute("SELECT quantity FROM user_items WHERE user_id=? AND item_key='oran_berry'",[userId]);assert.equal(after.quantity,before.quantity+(outcome==='victory'?1:0));
        assert.equal(io.events.some(e=>e.eventName==='battleText'&&e.payload.message.includes('Objet trouvé')),outcome==='victory');
    }finally{if(userId)await pool.execute('DELETE FROM users WHERE id=?',[userId]);await pool.end();}
});

test('Hoze Aventure : quatre partenaires réels, as K4 en dernier, réplique unique et gains persistés', {skip:!shouldRun}, async()=>{
    const pool=createTestPool(); let userId;
    try {
        const {user,player}=await createPlayer(7); userId=user.id; player.currentmap='ville_safe1_arene';
        const lead=player.equipe.pokemons[0]; lead.experience=lead.getNextLevelExpForLevel(100); lead.level=100; lead.recalculateStats();
        lead.currentSpecialAttack=999; lead.currentSpeed=999; lead.abilities=['Ice Beam']; lead.movePp=[10];
        const team=require('../server/game/world/pnjTeamFactory').getPnjTeam('hoze');
        const socket=new ScriptedSocket(Array.from({length:10},()=>({action:'attack',number:0})));
        const io=new RecordingIo({[player.id]:socket}), snapshots=[];
        const to=io.to.bind(io); io.to=id=>({emit:(event,payload)=>{if(event==='introAnimation')snapshots.push(JSON.parse(JSON.stringify(payload)));to(id).emit(event,payload);}});
        await withFixedRandom(.5,()=>startTrainerBattle(player,team,io,userId,{experienceKind:'arena',arenaBattleKey:'test_arena'}));
        assert.equal(io.lastEvent(player.id,'endbattle').payload.playerWon,true);
        assert.deepEqual([...new Set(snapshots.map(s=>s.wildPokemon.data.id))].sort((a,b)=>a-b),[7,253,445,448]);
        const entries=snapshots.flatMap(s=>s.transitions).filter(e=>e.kind==='enter'&&e.side==='opponent');
        assert.equal(entries.at(-1).uuid,team.__trainerPlan.aceUuid);
        assert.equal(entries.filter(e=>e.trainerSpeech).length,1);
        assert.equal(entries.at(-1).trainerSpeech.name,'Hoze');
        const ace=snapshots.find(s=>s.wildPokemon.data.id===445).wildPokemon;
        assert.equal(ace.k,4); assert(Object.values(ace.iv).every(v=>v===31)); assert.equal(ace.ev.attack,252);
        assert.equal((await loadEquipe(userId)).pokemons[0].uuid,lead.uuid);
        const [[row]]=await pool.execute('SELECT money FROM users WHERE id=?',[userId]);assert(Number(row.money)>0);
    } finally {if(userId)await pool.execute('DELETE FROM users WHERE id=?',[userId]);await pool.end();}
});
test('Raphael Aventure : cinq partenaires réels, as K4 en dernier, réplique unique et gains persistés', {skip:!shouldRun}, async()=>{
    const pool=createTestPool(); let userId;
    try {
        const {user,player}=await createPlayer(7); userId=user.id; player.currentmap='gen_arene5';
        const lead=player.equipe.pokemons[0]; lead.experience=lead.getNextLevelExpForLevel(100); lead.level=100; lead.recalculateStats();
        lead.currentSpecialAttack=999; lead.currentSpeed=999; lead.abilities=['Flamethrower']; lead.movePp=[15];
        const team=require('../server/game/world/pnjTeamFactory').getPnjTeam('raphael');
        const socket=new ScriptedSocket(Array.from({length:10},()=>({action:'attack',number:0})));
        const io=new RecordingIo({[player.id]:socket}), snapshots=[];
        const to=io.to.bind(io); io.to=id=>({emit:(event,payload)=>{if(event==='introAnimation')snapshots.push(JSON.parse(JSON.stringify(payload)));to(id).emit(event,payload);}});
        await withFixedRandom(.5,()=>startTrainerBattle(player,team,io,userId,{experienceKind:'arena',arenaBattleKey:'test_arena'}));
        assert.equal(io.lastEvent(player.id,'endbattle').payload.playerWon,true);
        assert.deepEqual([...new Set(snapshots.map(s=>s.wildPokemon.data.id))].sort((a,b)=>a-b),[55,158,212,330,359]);
        const entries=snapshots.flatMap(s=>s.transitions).filter(e=>e.kind==='enter'&&e.side==='opponent');
        assert.equal(entries.at(-1).uuid,team.__trainerPlan.aceUuid);
        assert.equal(entries.filter(e=>e.trainerSpeech).length,1);
        assert.equal(entries.at(-1).trainerSpeech.name,'Raphael');
        const ace=snapshots.find(s=>s.wildPokemon.data.id===212).wildPokemon;
        assert.equal(ace.k,4); assert(Object.values(ace.iv).every(v=>v===31)); assert.equal(ace.ev.attack,252);
        assert.equal((await loadEquipe(userId)).pokemons[0].uuid,lead.uuid);
        const [[row]]=await pool.execute('SELECT money FROM users WHERE id=?',[userId]);assert(Number(row.money)>0);
    } finally {if(userId)await pool.execute('DELETE FROM users WHERE id=?',[userId]);await pool.end();}
});

test('Ana Aventure : six partenaires réels, as K4 en dernier, réplique unique et gains persistés', {skip:!shouldRun}, async()=>{
    const pool=createTestPool(); let userId;
    try {
        const {user,player}=await createPlayer(7); userId=user.id; player.currentmap='ville3_arene';
        const lead=player.equipe.pokemons[0]; lead.experience=lead.getNextLevelExpForLevel(100); lead.level=100; lead.recalculateStats();
        lead.currentSpecialAttack=9999;lead.maxHp=lead.currentHp=1000; lead.currentSpeed=999; lead.abilities=['Surf']; lead.movePp=[15];
        const team=require('../server/game/world/pnjTeamFactory').getPnjTeam('ana');
        const socket=new ScriptedSocket(Array.from({length:10},()=>({action:'attack',number:0})));
        const io=new RecordingIo({[player.id]:socket}), snapshots=[];
        const to=io.to.bind(io); io.to=id=>({emit:(event,payload)=>{if(event==='introAnimation')snapshots.push(JSON.parse(JSON.stringify(payload)));to(id).emit(event,payload);}});
        await withFixedRandom(.5,()=>startTrainerBattle(player,team,io,userId,{experienceKind:'arena',arenaBattleKey:'test_arena'}));
        assert.equal(io.lastEvent(player.id,'endbattle').payload.playerWon,true);
        assert.deepEqual([...new Set(snapshots.map(s=>s.wildPokemon.data.id))].sort((a,b)=>a-b),[53,78,148,154,282,407]);
        const entries=snapshots.flatMap(s=>s.transitions).filter(e=>e.kind==='enter'&&e.side==='opponent');
        assert.equal(entries.at(-1).uuid,team.__trainerPlan.aceUuid);
        assert.equal(entries.filter(e=>e.trainerSpeech).length,1);
        assert.equal(entries.at(-1).trainerSpeech.name,'Ana');
        const ace=snapshots.find(s=>s.wildPokemon.data.id===282).wildPokemon;
        assert.equal(ace.k,4); assert(Object.values(ace.iv).every(v=>v===31)); assert.equal(ace.ev.specialAttack,252);
        assert.equal((await loadEquipe(userId)).pokemons[0].uuid,lead.uuid);
        const [[row]]=await pool.execute('SELECT money FROM users WHERE id=?',[userId]);assert(Number(row.money)>0);
    } finally {if(userId)await pool.execute('DELETE FROM users WHERE id=?',[userId]);await pool.end();}
});

test('Wanda Aventure : six partenaires réels, IV distincts, aucun as réservé et gains persistés', {skip:!shouldRun}, async()=>{
    const pool=createTestPool(); let userId;
    try {
        const {user,player}=await createPlayer(7); userId=user.id; player.currentmap='ville4_arene';
        const lead=player.equipe.pokemons[0]; lead.experience=lead.getNextLevelExpForLevel(100); lead.level=100; lead.recalculateStats();
        lead.currentSpecialAttack=9999;lead.maxHp=lead.currentHp=1000; lead.currentSpeed=999; lead.abilities=['Ice Beam']; lead.movePp=[15];
        const team=require('../server/game/world/pnjTeamFactory').getPnjTeam('wanda');
        const socket=new ScriptedSocket(Array.from({length:20},()=>({action:'attack',number:0})));
        const io=new RecordingIo({[player.id]:socket}), snapshots=[];
        const to=io.to.bind(io); io.to=id=>({emit:(event,payload)=>{if(event==='introAnimation')snapshots.push(JSON.parse(JSON.stringify(payload)));to(id).emit(event,payload);}});
        await withFixedRandom(.5,()=>startTrainerBattle(player,team,io,userId,{experienceKind:'arena',arenaBattleKey:'test_arena'}));
        assert.equal(io.lastEvent(player.id,'endbattle').payload.playerWon,true);
        assert.deepEqual([...new Set(snapshots.map(s=>s.wildPokemon.data.id))].sort((a,b)=>a-b),[6,65,68,73,373,376]);
        const entries=snapshots.flatMap(s=>s.transitions).filter(e=>e.kind==='enter'&&e.side==='opponent');
        assert.equal(team.__trainerPlan.ai,'expert');assert.equal(team.__trainerPlan.aceUuid,undefined);
        assert.equal(entries.filter(e=>e.trainerSpeech).length,0);
        assert.equal(snapshots[0].wildPokemon.data.id,373);
        for(const id of [373,68,73,65,6,376]){const p=snapshots.find(s=>s.wildPokemon.data.id===id).wildPokemon;assert(Object.values(p.iv).every(n=>id===376?n===31:n>=24&&n<=30));assert.equal(Object.values(p.ev).reduce((s,n)=>s+n,0),508);}
        assert.equal((await loadEquipe(userId)).pokemons[0].uuid,lead.uuid);
        const [[row]]=await pool.execute('SELECT money FROM users WHERE id=?',[userId]);assert(Number(row.money)>0);
    } finally {if(userId)await pool.execute('DELETE FROM users WHERE id=?',[userId]);await pool.end();}
});

for (const kind of ['wild','trainer']) test(`Aventure ${kind} : Tunnel utilise son dernier PP, évite le premier tour et poursuit automatiquement sans nouvelle demande`, {skip:!shouldRun}, async()=>{
    const pool=createTestPool();let userId;
    try {
        const {user,player}=await createPlayer(7);userId=user.id;player.currentmap='ville1_arene';
        const lead=player.equipe.pokemons[0];lead.abilities=['Dig','Tackle'];lead.movePp=[1,35];lead.currentHp=lead.maxHp=1000;lead.currentSpeed=999;
        const enemy=createPokemon(19,'Rattata',['Tackle']);enemy.currentHp=enemy.maxHp=1000;enemy.currentAttack=1;
        const socket=new ScriptedSocket([{action:'attack',number:0},{action:'flee'}]),io=new RecordingIo({[player.id]:socket});
        await withFixedRandom(.5,()=>kind==='wild'?startWildBattle(player,enemy,io,userId):startTrainerBattle(player,createTeam(enemy),io,userId));
        assert.equal(socket.outgoing.filter(e=>e.eventName==='requestAction').length,2);
        const frames=io.events.filter(e=>e.eventName==='battleMoveResult');const own=frames.filter(e=>e.payload.actor==='player');
        assert.deepEqual(own.map(e=>e.payload.phase),['prepare','strike']);assert.equal(own[0].payload.damage,0);assert(own[1].payload.damage>0);
        assert(frames.find(e=>e.payload.actor==='opponent').payload.missed);
        const saved=(await loadEquipe(userId)).pokemons[0];assert.equal(saved.movePp[0],0);assert.equal(saved.movePp[1],35);assert(!saved.__battle?.chargeMove);
        assert.equal(io.lastEvent(player.id,'endbattle').payload.reason,'fled');
    } finally {if(userId)await pool.execute('DELETE FROM users WHERE id=?',[userId]);await pool.end();}
});

test('Aventure PvP : Vol poursuit sans second choix, le rival agit normalement et les PP des deux comptes sont sauvegardés', {skip:!shouldRun}, async()=>{
    const pool=createTestPool(),ids=[];
    try {
        const a=await createPlayer(7),b=await createPlayer(1);ids.push(a.user.id,b.user.id);
        const lead=a.player.equipe.pokemons[0],target=b.player.equipe.pokemons[0];lead.abilities=['Fly'];lead.movePp=[1];lead.currentSpeed=999;
        for(const p of [lead,target]){p.currentHp=p.maxHp=1000;p.currentAttack=1;}
        target.abilities=['Tackle'];target.movePp=[35];
        const sa=new ScriptedSocket([{action:'attack',number:0},{action:'flee'}]),sb=new ScriptedSocket([{action:'attack',number:0},{action:'attack',number:0},{action:'attack',number:0}]);
        const io=new RecordingIo({[a.player.id]:sa,[b.player.id]:sb});
        await withFixedRandom(.5,()=>startPvpBattle(a.player,b.player,io));
        assert.equal(sa.outgoing.filter(e=>e.eventName==='requestAction').length,2);assert.equal(sb.outgoing.filter(e=>e.eventName==='requestAction').length,3);
        const frames=io.events.filter(e=>e.targetId===a.player.id&&e.eventName==='battleMoveResult');
        assert.deepEqual(frames.filter(e=>e.payload.actor==='player').map(e=>e.payload.phase),['prepare','strike']);assert(frames.find(e=>e.payload.actor==='opponent').payload.missed);
        assert.equal((await loadEquipe(a.user.id)).pokemons[0].movePp[0],0);assert.equal((await loadEquipe(b.user.id)).pokemons[0].movePp[0],33);
    } finally {for(const id of ids)await pool.execute('DELETE FROM users WHERE id=?',[id]);await pool.end();}
});

for (const kind of ['wild','trainer','arena']) test(`Aventure ${kind} : partage par adversaire, entrants vivants, affichage et persistance`, {skip:!shouldRun}, async()=>{
 const pool=createTestPool();let userId;
 try{
  const {user,player}=await createPlayer(1);userId=user.id;
  const lead=createPokemon(1,'Premier',['Growl']),reserve=createPokemon(7,'Relais'),bench=createPokemon(25,'Banc');reserve.currentAttack=999;reserve.currentSpeed=999;
  player.equipe=createTeam(lead,reserve,bench);const first=createPokemon(19,'Premier adverse',['Growl']),last=createPokemon(19,'Second adverse',['Growl']);for(const p of [first,last]){p.currentHp=1;p.passiveAbility=null;p.__battle={ingrain:true};} // Isolate XP distribution from trainer switching.
  const {calculateBattleExperience:xp,BATTLE_EXPERIENCE_MULTIPLIERS:rates}=require('../server/game/models/progression');const factor=rates[kind],share=Math.floor(xp(first,factor,lead)/2),baseline=lead.experience;
  const expectedReserve=createPokemon(7,'Calcul');expectedReserve.gainExperience(share);const second=kind==='wild'?0:xp(last,factor,expectedReserve);
  const actions=[{action:'attack',number:0},{action:'change',number:1},{action:'attack',number:0},...(kind==='wild'?[]:[{action:'attack',number:0}])],socket=new ScriptedSocket(actions),io=new RecordingIo({[player.id]:socket});
  if(kind==='wild')await withFixedRandom(.5,()=>startWildBattle(player,first,io,userId));else await withFixedRandom(.5,()=>startTrainerBattle(player,createTeam(first,last),io,userId,{experienceKind:kind,arenaBattleKey:kind==='arena'?'test_arena':null}));
  const saved=(await loadEquipe(userId)).pokemons,byId=id=>saved.find(p=>p.uuid===id);
  assert.equal(byId(lead.uuid).experience,baseline+share);assert.equal(byId(reserve.uuid).experience,baseline+share+second);assert.equal(byId(bench.uuid).experience,baseline);
  assert.deepEqual(saved.map(p=>p.uuid),[lead.uuid,reserve.uuid,bench.uuid],'combat switches and XP must preserve party order');
  assert.equal(byId(lead.uuid).ev.speed,1);assert.equal(byId(reserve.uuid).ev.speed,kind==='wild'?1:2);assert.equal(byId(bench.uuid).ev.speed,0);
  const awards=io.events.filter(e=>e.eventName==='battleExperience');assert.equal(awards.length,kind==='wild'?2:3);assert(awards.every(e=>e.targetId===player.id));
  const summary=io.lastEvent(player.id,'endbattle').payload.summary;assert.equal(summary.experience.find(p=>p.uuid===lead.uuid).xpGained,share);assert.equal(summary.experience.find(p=>p.uuid===reserve.uuid).xpGained,share+second);assert(!summary.experience.some(p=>p.uuid===bench.uuid));
 }finally{if(userId)await pool.execute('DELETE FROM users WHERE id=?',[userId]);await pool.end();}
});

for(const opponentMove of ['Growl','Tackle']) test(`Aventure sauvage : Coup Bas contre ${opponentMove}`, {skip:!shouldRun}, async()=>{
 const pool=createTestPool();let userId;
 try{
  const {user,player}=await createPlayer(1);userId=user.id;const lead=createPokemon(19,'Coup Bas',['Sucker Punch']);lead.maxHp=lead.currentHp=500;player.equipe=createTeam(lead);
  const foe=createPokemon(19,'Cible',[opponentMove]);foe.maxHp=foe.currentHp=500;const socket=new ScriptedSocket([{action:'attack',number:0},{action:'flee'}]),io=new RecordingIo({[player.id]:socket});
  await withFixedRandom(.5,()=>startWildBattle(player,foe,io,userId));const result=io.events.find(e=>e.eventName==='battleMoveResult'&&e.payload.actor==='player');assert.equal(result.payload.damage>0,opponentMove==='Tackle');assert.equal((await loadEquipe(userId)).pokemons[0].movePp[0],4);
 }finally{if(userId)await pool.execute('DELETE FROM users WHERE id=?',[userId]);await pool.end();}
});

for(const opponentMove of ['Growl','Tackle']) test(`Aventure dresseur : Coup Bas contre ${opponentMove}`, {skip:!shouldRun}, async()=>{
 const pool=createTestPool();let userId;
 try{
  const {user,player}=await createPlayer(1);userId=user.id;const lead=createPokemon(19,'Coup Bas',['Sucker Punch']);lead.maxHp=lead.currentHp=500;player.equipe=createTeam(lead);
  const foe=createPokemon(19,'Cible',[opponentMove]);foe.maxHp=foe.currentHp=500;const socket=new ScriptedSocket([{action:'attack',number:0},{action:'flee'}]),io=new RecordingIo({[player.id]:socket});
  await withFixedRandom(.5,()=>startTrainerBattle(player,createTeam(foe),io,userId));const result=io.events.find(e=>e.eventName==='battleMoveResult'&&e.payload.actor==='player');assert.equal(result.payload.damage>0,opponentMove==='Tackle');assert.equal((await loadEquipe(userId)).pokemons[0].movePp[0],4);
 }finally{if(userId)await pool.execute('DELETE FROM users WHERE id=?',[userId]);await pool.end();}
});

test('Aventure capture : les EV de tous les entrants sont persistés, sans gain pour le banc ni la capture', {skip:!shouldRun}, async()=>{
 const pool=createTestPool();let userId;
 try{
  const {user,player}=await createPlayer(1);userId=user.id;
  const lead=createPokemon(1,'Premier',['Splash']),relay=createPokemon(7,'Relais',['Splash']),bench=createPokemon(25,'Banc',['Splash']),wild=createPokemon(19,'Capture',['Splash']);
  player.equipe=createTeam(lead,relay,bench);wild.currentHp=1;wild.passiveAbility=null;
  const socket=new ScriptedSocket([{action:'change',number:1},{action:'bag',itemKey:'hyperball'}]),io=new RecordingIo({[player.id]:socket});
  await withFixedRandom(0,()=>startWildBattle(player,wild,io,userId));
  assert.equal(io.lastEvent(player.id,'endbattle').payload.reason,'captured');
  const saved=(await loadEquipe(userId)).pokemons;
  assert.deepEqual([lead,relay,bench,wild].map(p=>saved.find(q=>q.uuid===p.uuid).ev.speed),[1,1,0,0]);
 }finally{if(userId)await pool.execute('DELETE FROM users WHERE id=?',[userId]);await pool.end();}
});

for(const trainer of [false,true])for(const simultaneous of [false,true])test(`Destruction Aventure ${trainer?'dresseur':'sauvage'} : ${simultaneous?'double K.O. sans fausse victoire':'choix du remplaçant et sauvegarde'}`,{skip:!shouldRun},async()=>{
 const pool=createTestPool();let id;
 try{
  const {user,player}=await createPlayer(4);id=user.id;
  const lead=player.equipe.pokemons[0];lead.passiveAbility=null;lead.abilities=['Self-Destruct'];lead.movePp=[5];lead.currentSpeed=999;
  const enemy=createPokemon(7,'Cible',['Splash']);enemy.passiveAbility=null;enemy.currentSpeed=1;
  if(simultaneous){enemy.currentHp=1;lead.currentAttack=999;}
  else {enemy.currentHp=enemy.maxHp=999;player.equipe.ajouterPokemon(createPokemon(4,'Réserve'));}
  const socket=new ScriptedSocket(simultaneous?[{action:'attack',number:0}]:[{action:'attack',number:0},{action:'change',number:1},{action:'flee'}]);
  const io=new RecordingIo({[player.id]:socket});
  await withFixedRandom(.5,()=>trainer?startTrainerBattle(player,createTeam(enemy),io,id):startWildBattle(player,enemy,io,id));
  assert.equal(lead.currentHp,0);assert.equal(lead.movePp[0],4);
  const saved=(await loadEquipe(id)).pokemons.find(p=>p.uuid===lead.uuid);assert.equal(saved.currentHp,0);assert.equal(saved.movePp[0],4);
  const end=io.lastEvent(player.id,'endbattle').payload;assert.equal(end.playerWon,false);
  assert.equal(io.events.filter(e=>e.eventName==='endbattle').length,1);
  assert(io.events.some(e=>e.eventName==='introAnimation'&&e.payload.transitions?.some(t=>t.kind==='faint'&&t.uuid===lead.uuid)));
  if(simultaneous){assert.equal(enemy.currentHp,0);assert.equal(end.summary.money,0);}
  else {assert.equal(end.reason,'fled');assert.equal(socket.outgoing.filter(e=>e.eventName==='requestAction'&&e.payload.replacement).length,1);}
 }finally{if(id)await pool.execute('DELETE FROM users WHERE id=?',[id]);await pool.end();}
});
for(const kind of ['wild','trainer'])test(`Recharge Aventure ${kind}: tour automatique sans nouvelle saisie ni PP, puis retour des commandes`,{skip:!shouldRun},async()=>{
 const pool=createTestPool();let id;
 try{
  const {user,player}=await createPlayer(4);id=user.id;
  const lead=player.equipe.pokemons[0];lead.passiveAbility=null;lead.abilities=['Hyper Beam'];lead.movePp=[1];lead.currentSpeed=999;lead.currentHp=lead.maxHp=1000;
  const enemy=createPokemon(7,'Recharge',['Splash']);enemy.passiveAbility=null;enemy.currentHp=enemy.maxHp=9999;enemy.currentSpeed=1;
  const socket=new ScriptedSocket([{action:'attack',number:0},{action:'flee'}]),io=new RecordingIo({[player.id]:socket});
  await withFixedRandom(.5,()=>kind==='wild'?startWildBattle(player,enemy,io,id):startTrainerBattle(player,createTeam(enemy),io,id));
  assert.equal(lead.movePp[0],0);assert.equal(socket.outgoing.filter(e=>e.eventName==='requestAction').length,2);
  assert.equal(io.events.filter(e=>e.eventName==='battleMoveAnimation'&&e.payload.actor==='player').length,1,'Recharge must not replay the attack');
  assert(io.events.some(e=>JSON.stringify(e.payload).includes('recharger son énergie')));assert.equal(io.lastEvent(player.id,'endbattle').payload.reason,'fled');
  assert.equal((await loadEquipe(id)).pokemons.find(p=>p.uuid===lead.uuid).movePp[0],0);
 }finally{if(id)await pool.execute('DELETE FROM users WHERE id=?',[id]);await pool.end();}
});

test('wild Adventure: enemy six levels higher allows escape from Arena Trap in one action, preserving the saved team and XP', {skip:!shouldRun}, async()=>{
 const pool=createTestPool();let userId;
 try {
  const fixture=await createPlayer(7);userId=fixture.user.id;const player=fixture.player;
  const factory=require('../server/game/drift/pokemonFactory'),lead=factory.create(7,20,true),foe=factory.create(50,26,true);
  lead.passiveAbility=null;foe.passiveAbility='Arena Trap';foe.abilities=['Scratch'];player.equipe=createTeam(lead);
  const xp=lead.experience,hp=lead.currentHp,socket=new ScriptedSocket([{action:'flee'}]),io=new RecordingIo({[player.id]:socket});
  assert.equal(await startWildBattle(player,foe,io,userId),true);
  assert.equal(socket.outgoing.filter(e=>e.eventName==='requestAction').length,1);
  assert.equal(io.lastEvent(player.id,'endbattle').payload.reason,'fled');
  assert.equal(lead.experience,xp);assert.equal(lead.currentHp,hp);
  const saved=(await loadEquipe(userId)).pokemons[0];assert.equal(saved.uuid,lead.uuid);assert.equal(saved.experience,xp);assert.equal(saved.currentHp,hp);
 }finally{if(userId)await pool.execute('DELETE FROM users WHERE id=?',[userId]);await pool.end();}
});

for (const [champion,species] of [['hoze',445],['raphael',330]]) for(const ability of ['Blaze','Iron Fist']) for(const entry of ['lead','switch','ko'])
test(`Bluff Simiabraz ${ability} contre ${champion} (${entry}) : équipe réelle, talent et objet conservés`,{skip:!shouldRun},async()=>{
 const pool=createTestPool();let userId;
 try{
  const{user,player}=await createPlayer(7);userId=user.id;
  const active=require('../server/game/drift/pokemonFactory').create(392,39,true);
  active.abilities=['Fake Out','Splash'];active.movePp=[10,40];active.passiveAbility=ability;active.heldItem=null;
  const team=require('../server/game/world/pnjTeamFactory').getPnjTeam(champion);
  team.pokemons=team.pokemons.filter(p=>p.data.id===species);
  player.equipe=entry!=='lead'?createTeam(createPokemon(143,'Relais',['Splash']),active):createTeam(active);
  if(entry!=='lead')active.currentHp=active.maxHp=1000;
  if(entry==='ko')player.equipe.pokemons[0].currentHp=1;
  const io=new RecordingIo({[player.id]:new ScriptedSocket([...(entry==='ko'?[{action:'attack',number:0},{action:'change',number:1}]:entry==='switch'?[{action:'change',number:1}]:[]),{action:'attack',number:0},{action:'flee'}])});
  await withFixedRandom(.5,()=>startTrainerBattle(player,team,io,userId));
  const events=io.events.filter(e=>e.targetId===player.id),results=events.filter(e=>e.eventName==='battleMoveResult').slice(entry!=='lead'?1:0);
  assert.equal(results[0].payload.actor,'player');assert(results[0].payload.damage>0);
  assert.equal(results[1].payload.actor,'opponent');assert.equal(results[1].payload.damage,0);
  assert(events.some(e=>e.eventName==='battleText'&&/apeuré/.test(e.payload.message)));
  assert.equal(events.filter(e=>e.eventName==='battleMoveAnimation'&&e.payload.actor==='opponent').length,entry!=='lead'?1:0);
 }finally{if(userId)await pool.execute('DELETE FROM users WHERE id=?',[userId]);await pool.end();}
});

test('Lucie: defeat speech precedes the result and cannot trigger victory', {skip:!shouldRun},async()=>{
 const pool=createTestPool();let userId;
 try{
  const{user,player}=await createPlayer(7);userId=user.id;
  player.equipe.pokemons[0].currentHp=1;player.equipe.pokemons[0].abilities=['Splash'];player.equipe.pokemons[0].movePp=[40];
  const team=require('../server/game/world/pnjTeamFactory').getPnjTeam('lucie_corrupted');
  const io=new RecordingIo({[player.id]:new ScriptedSocket([{action:'attack',number:0}])});let wins=0;
  await withFixedRandom(.5,()=>startTrainerBattle(player,team,io,userId,{experienceKind:'trainer',arenaBattleKey:'story_lucie_corrupted',onVictory:async()=>{wins++;}}));
  assert.equal(wins,0);assert.equal(io.lastEvent(player.id,'endbattle').payload.summary.outcome,'defeat');
  const speech=io.events.findIndex(e=>e.eventName==='battleText'&&e.payload.message===team.__trainerPlan.defeatLine);
  assert(speech>=0&&speech<io.events.findIndex(e=>e.eventName==='endbattle'));
 }finally{if(userId)await pool.execute('DELETE FROM users WHERE id=?',[userId]);await pool.end();}
});
test('Lucie trainer experience is persistent per opponent slot across retries', {skip:!shouldRun},async()=>{
 const pool=createTestPool();let userId;
 try{
  const{user,player}=await createPlayer(7);userId=user.id;
  const lead=player.equipe.pokemons[0];lead.experience=lead.getNextLevelExpForLevel(100);lead.level=100;lead.recalculateStats();
  const run=async()=>{const team=require('../server/game/world/pnjTeamFactory').getPnjTeam('lucie_corrupted');team.pokemons.forEach(p=>{p.currentHp=1;p.passiveAbility=null;p.heldItem=null;});
   const io=new RecordingIo({[player.id]:new ScriptedSocket([{action:'attack',number:0},{action:'flee'}])});
   await withFixedRandom(.5,()=>startTrainerBattle(player,team,io,userId,{experienceKind:'trainer',arenaBattleKey:'story_lucie_corrupted'}));return io;};
  const before=lead.experience;await run();const gained=(await loadEquipe(userId)).pokemons[0].experience;assert(gained>before);
  const io=await run();assert.equal((await loadEquipe(userId)).pokemons[0].experience,gained);assert(!io.events.some(e=>e.eventName==='battleExperience'));
 }finally{if(userId)await pool.execute('DELETE FROM users WHERE id=?',[userId]);await pool.end();}
});

for (const command of [{action:'attack',number:0},{action:'change',number:1},{action:'change',number:2}])
test(`Human AI commits before the Adventure prompt and cannot retarget ${command.action}:${command.number}`,{skip:!shouldRun},async()=>{
 const pool=createTestPool();let userId;const tactics=require('../server/game/battle/trainerTactics'),original=tactics.chooseAction;const choices=[];
 try{
  const {user,player}=await createPlayer(7);userId=user.id;
  const factory=require('../server/game/drift/pokemonFactory');
  const roster=[factory.create(9,40,true),factory.create(6,40,true),factory.create(3,40,true)];
  for(const [i,p]of roster.entries()){p.uuid='human-ai-player-'+i;p.abilities=['Splash'];p.movePp=[40];p.passiveAbility=null;p.heldItem=null;}
  const enemy=factory.create(25,40,true);enemy.uuid='human-ai-npc';enemy.abilities=['Thunderbolt','Iron Tail'];enemy.movePp=[15,15];enemy.passiveAbility=null;enemy.heldItem=null;
  player.equipe=createTeam(...roster);const team=createTeam(enemy);
  tactics.chooseAction=function(...args){const action=original(...args);choices.push({action,active:args[1].uuid});return action;};
  class PromptSocket extends ScriptedSocket{emit(event,payload){if(event==='requestAction')assert(choices.length>0,'AI must already be committed');return super.emit(event,payload);}}
  const io=new RecordingIo({[player.id]:new PromptSocket([{action:'change',number:99},command,{action:'flee'}])});
  await withFixedRandom(.5,()=>startTrainerBattle(player,team,io,userId));
  assert.equal(choices.length,2,'invalid command must not reroll the AI; next valid round gets one decision');
  assert.equal(choices[0].active,'human-ai-player-0');
  const action=choices[0].action;assert.equal(action.action,'attack');
  const results=io.events.filter(e=>e.eventName==='battleMoveAnimation'&&e.payload.actor==='opponent');
  assert.equal(results.length,1);assert.equal(results[0].payload.moveName,enemy.abilities[action.number]);
  assert.equal(enemy.movePp[action.number],14,'Only the committed move was used');
  assert.equal(enemy.movePp[1-action.number],15);
 }finally{tactics.chooseAction=original;if(userId)await pool.execute('DELETE FROM users WHERE id=?',[userId]);await pool.end();}
});

test('Human AI Adventure preserves a committed NPC switch when the player also switches',{skip:!shouldRun},async()=>{
 const pool=createTestPool();let userId;const tactics=require('../server/game/battle/trainerTactics'),original=tactics.chooseAction;let count=0;
 try{
  const {user,player}=await createPlayer(7);userId=user.id;
  const factory=require('../server/game/drift/pokemonFactory');
  const lead=factory.create(9,40,true),reserve=factory.create(6,40,true),rock=factory.create(112,40,true),grass=factory.create(3,40,true);
  for(const p of [lead,reserve,rock,grass]){p.passiveAbility=null;p.heldItem=null;}
  lead.abilities=['Surf'];reserve.abilities=['Flamethrower'];rock.abilities=['Rock Slide'];grass.abilities=['Razor Leaf'];
  for(const p of [lead,reserve,rock,grass])p.movePp=[20];
  player.equipe=createTeam(lead,reserve);const team=createTeam(rock,grass);
  tactics.chooseAction=(...args)=>{const d=original(...args);if(!count++)assert.deepEqual(d,{action:'change',number:1});return d;};
  const io=new RecordingIo({[player.id]:new ScriptedSocket([{action:'change',number:1},{action:'flee'}])});
  await withFixedRandom(.5,()=>startTrainerBattle(player,team,io,userId));
  assert.equal(team.pokemons[0].uuid,grass.uuid);assert(!io.events.some(e=>e.eventName==='battleMoveAnimation'),'Both committed switches spend the round');
 }finally{tactics.chooseAction=original;if(userId)await pool.execute('DELETE FROM users WHERE id=?',[userId]);await pool.end();}
});

for(const command of [{action:'attack',number:0},{action:'change',number:1}])
test(`Human AI finishing pressure Adventure: effective move locked before ${command.action}, no immunity gamble or late retarget`,{skip:!shouldRun},async()=>{
 const pool=createTestPool();let userId;const tactics=require('../server/game/battle/trainerTactics'),original=tactics.chooseAction,choices=[];
 try{
  const {user,player}=await createPlayer(7);userId=user.id;
  const factory=require('../server/game/drift/pokemonFactory');
  const lead=factory.create(51,50,true),reserve=factory.create(130,50,true),npc=factory.create(26,50,true);
  for(const p of [lead,reserve,npc]){p.passiveAbility=null;p.heldItem=null;}
  lead.abilities=['Earthquake'];lead.movePp=[10];reserve.abilities=['Tackle'];reserve.movePp=[35];
  npc.abilities=['Thunderbolt','Surf'];npc.movePp=[15,15];npc.currentHp=40;
  player.equipe=createTeam(lead,reserve);const team=createTeam(npc);
  tactics.chooseAction=function(...args){const d=original(...args);choices.push({...d});return d;};
  class PromptSocket extends ScriptedSocket{emit(event,payload){if(event==='requestAction'&&!payload.replacementId)assert(choices.length,'Decision made before asking the player');return super.emit(event,payload);}}
  const io=new RecordingIo({[player.id]:new PromptSocket([{action:'change',number:99},command,{action:'flee'}])});
  await withFixedRandom(.5,()=>startTrainerBattle(player,team,io,userId));
  assert.deepEqual(choices[0],{action:'attack',number:1},'Surf targets the current Ground Pokemon instead of guessing Thunderbolt into a switch');
  const moves=io.events.filter(e=>e.eventName==='battleMoveAnimation'&&e.payload.actor==='opponent');
  if(command.action==='change'){assert.equal(moves.length,1);assert.equal(moves[0].payload.moveName,'Surf');assert.equal(npc.movePp[1],14);assert.equal(npc.movePp[0],15);}
  else {assert.equal(moves.length,0,'The player really can finish the trainer before it acts');assert.equal(choices.length,1,'Invalid input did not reroll the decision');}
 }finally{tactics.chooseAction=original;if(userId)await pool.execute('DELETE FROM users WHERE id=?',[userId]);await pool.end();}
});

test('Piège Sable Aventure : changement refusé, décision IA conservée et victoire sauvegardée', {skip:!shouldRun}, async()=>{
    const pool=createTestPool();let userId;
    const policy=require('../server/game/battle/humanTrainerAI'),original=policy.chooseAction,decisions=[];
    try {
        const {user,player}=await createPlayer(7);userId=user.id;
        const lead=player.equipe.pokemons[0];lead.abilities=['Tackle'];lead.movePp=[35];lead.currentAttack=9999;lead.currentSpeed=999;
        player.equipe.ajouterPokemon(createPokemon(130,'Relève',['Waterfall']));
        const enemy=require('../server/game/world/pnjTeamFactory').getPnjTeam('sevenp').pokemons[0];
        enemy.currentHp=1;enemy.heldItem=null;
        policy.chooseAction=options=>{const analysis=policy.analyse(options);decisions.push(analysis);return original(options);};
        const socket=new ScriptedSocket([{action:'change',number:1},{action:'attack',number:0}]);
        const io=new RecordingIo({[player.id]:socket});
        const result=await withFixedRandom(.5,()=>startTrainerBattle(player,createTeam(enemy),io,userId));
        assert.equal(result,true);assert.equal(io.lastEvent(player.id,'endbattle')?.payload.reason,'victory');
        assert(io.events.some(e=>e.eventName==='battleText'&&/piege.*ne peut pas changer/.test(e.payload.message)));
        assert.equal(decisions.length,1,'invalid escape must not cause a new trainer decision');
        assert(!decisions[0].predictions.some(p=>p.action==='change'));
        assert.equal((await loadEquipe(userId)).pokemons[0].uuid,lead.uuid);
    }finally{policy.chooseAction=original;if(userId)await pool.execute('DELETE FROM users WHERE id=?',[userId]);await pool.end();}
});
