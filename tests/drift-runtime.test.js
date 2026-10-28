const test = require('node:test');
const assert = require('node:assert/strict');
const { createLobbyStore, RECONNECT_MS } = require('../server/game/drift/lobbyStore');
const { createRunManager } = require('../server/game/drift/runManager');
const factory = require('../server/game/drift/pokemonFactory');
const economy = require('../server/game/drift/economy');
const effects = require('../server/game/drift/driftEffects');
const { DriftBattle } = require('../server/game/drift/driftBattle');

function fixture(size = 2, random = () => .2) {
    let time = 1000;
    const messages=[];
    const store=createLobbyStore({now:()=>time});
    const namespace={to:id=>({emit:(event,payload)=>messages.push({id,event,payload:JSON.parse(JSON.stringify(payload))})})};
    const runtime=createRunManager({ starterChoiceMs:0,store,namespace,now:()=>time,random,paceMs:0});
    const users=Array.from({length:size},(_,i)=>({id:i+1,username:`Dresseur ${i+1}`}));
    const sockets=users.map(u=>({id:`s${u.id}`}));
    users.forEach((u,i)=>store.connect(u,sockets[i].id));
    const {code}=store.create(users[0],{capacity:size,durationMinutes:20});
    for(const u of users.slice(1))store.join(u,code);
    users.forEach(u=>store.ready(u,true));
    runtime.start(users[0]); users.forEach((u,i)=>runtime.enter(u,sockets[i]));
    const run=store.getLobby(users[0]).run;
    return {store,runtime,run,users,sockets,messages,advance:ms=>{time+=ms;runtime.tick();},now:()=>time};
}
function fight(battle) {
    for(let turn=0;turn<500&&!battle.finished;turn++) {
        for(const p of [battle.a,battle.b]) if(!p.npc&&battle.awaiting) battle.action(p,{...battle.defaultAction(p),turnId:battle.token});
        battle.tick();
    }
    assert.equal(battle.finished,true,'le combat doit se terminer');
}
function addDrift(p,number,rarity='mythic') {
    const d={uuid:`${number}-${p.userId}`,definitionId:`DRF-${String(number).padStart(3,'0')}`,rarity,element:'Grass'};
    p.drifts.push(d);return d;
}

for(const mode of ['rift','colosseum'])test(`${mode}: Lucie departure is personal, blocks actions during the vortex and survives checkpoints`,()=>{
 const f=fixture(),p=f.run.players.get(1),other=f.run.players.get(2);f.run.mode=mode;
 p.currentmap='route2_maison';p.x=432;p.y=208;p.defeated.add('lucie_route2');
 f.runtime.enter(f.users[0],f.sockets[0]);assert.equal(p.dialogue.name,'lucie_route2_after');
 f.runtime.endDialogue(p,'lucie_route2_after');assert(p.lucieDepartureSeen);assert(p.lucieDeparture);
 const origin={x:p.x,y:p.y};f.runtime.move(p,'move_d');assert.deepEqual({x:p.x,y:p.y},origin);
 assert(!f.messages.some(m=>m.id===other.socketId&&m.event==='lucieDeparture'));
 const saved=require('../server/game/drift/checkpointCodec').decode(require('../server/game/drift/checkpointCodec').encode(p));assert(saved.lucieDepartureSeen);
 f.advance(4300);assert.equal(p.lucieDeparture,null);
 const npcs=f.messages.filter(m=>m.id===p.socketId&&m.event==='pnjsList').at(-1).payload.pnjs;assert(!npcs.some(n=>n.name==='lucie_route2'));
 f.runtime.move(p,'move_z');assert.equal(p.y,176,'the vanished NPC no longer blocks the tile');
});

test('Rift battle animation identifies physical, special and status moves for visuals and sounds', () => {
    for (const [name, damageClass] of [['Tackle','physical'],['Water Gun','special'],['Growl','status']]) {
        const f=fixture(), p=f.run.players.get(1);
        p.equipe.pokemons=[factory.create(7,5)];
        p.equipe.pokemons[0].abilities=[name];p.equipe.pokemons[0].movePp=[30];
        const enemy={npc:true,equipe:{pokemons:[factory.create(1,50)]},drifts:[],equipped:[]};
        enemy.equipe.pokemons[0].abilities=['Growl'];enemy.equipe.pokemons[0].movePp=[40];
        const battle=new DriftBattle(p,enemy,{emit:(_,event,payload)=>f.messages.push({event,payload}),random:()=>.5,paceMs:0});
        battle.action(p,{action:'attack',number:0,turnId:battle.token});
        const animation=f.messages.find(m=>m.event==='battleMoveAnimation'&&m.payload.actor==='player');
        assert.equal(animation.payload.damageClass,damageClass);
        assert.equal(animation.payload.moveName,name);
        assert(animation.payload.moveType);
    }
});

test('la mère soigne aussi l’équipe Rift et le rapport distingue ce soin du Centre', () => {
    const f = fixture(), p = f.run.players.get(1);
    const mother = f.run.pnjs.getPnjsForMap('start').find(npc => npc.name === 'mere_clara');
    p.x = mother.x * 32 + 16;
    p.y = (mother.y + 1) * 32 + 16;
    const pokemon = p.equipe.pokemons[0];
    pokemon.currentHp = 1;
    pokemon.status = 'poison';
    pokemon.movePp = pokemon.abilities.map(() => 0);
    f.runtime.interact(p);
    assert.equal(p.dialogue.name, 'dia0');
    f.runtime.endDialogue(p, 'dia0');
    assert.equal(pokemon.currentHp, pokemon.maxHp);
    assert.equal(pokemon.status, 'normal');
    const { getMaxMovePp } = require('../server/game/battle/battleResources');
    assert.deepEqual(pokemon.movePp, pokemon.abilities.map(getMaxMovePp));
    assert.equal(p.runReport.stats.centerHeals, 0);
    assert(p.runReport.events.some(entry => entry.type === 'heal' && entry.text.includes('Maman')));
    assert.throws(() => f.runtime.endDialogue(p, 'dia0'), /Dialogue expiré/);
});

test('Drift démarre avec un seul petit compagnon, reprend sa session et conserve les limites du salon',()=>{
    const f=fixture(4),p=f.run.players.get(1);
    assert.equal(f.run.endsAt-f.now(),1200000);
    assert.equal(p.currentmap,'start');assert.equal(p.equipe.pokemons.length,1);assert.equal(p.equipe.pokemons[0].level,5);
    assert.ok(factory.STARTERS.includes(p.equipe.pokemons[0].data.id));
    const uuid=p.equipe.pokemons[0].uuid;
    f.runtime.disconnect(f.users[0],f.sockets[0]);f.advance(10000);
    f.runtime.enter(f.users[0],{id:'reconnected'});
    assert.equal(p.equipe.pokemons[0].uuid,uuid);
    assert.throws(()=>f.runtime.guard(f.users[0],f.sockets[0]),/autre onglet/);
    assert.throws(()=>f.store.configure(f.users[0],{capacity:8,durationMinutes:60}),/verrouillées/);
    assert.throws(()=>f.runtime.start(f.users[0]),/déjà commencé/);
    f.advance(RECONNECT_MS+1);assert.equal(p.alive,true,'le compte reconnecté reste vivant');
});

test('les 49 compagnons initiaux sont distincts, faibles et sans légendaire, avec une attaque utilisable',()=>{
    assert.equal(new Set(factory.STARTERS).size,49);
    for(const id of factory.STARTERS){for(const folder of ['dp2','back'])assert.ok(require('node:fs').existsSync(require('node:path').resolve(__dirname,`../vue-explorakit/src/assets/${folder}/${id}.png`)),`sprite ${folder}/${id}`);const p=factory.create(id,5,true);assert.equal(factory.legendary.has(id),false);assert.equal(p.k,2);assert.ok(p.abilities.length>=2);assert.ok(p.currentHp>0);assert.ok(Object.values(p.data.base).reduce((s,n)=>s+n,0)<=440);}
});

test('cinq Drifts maximum, UUID propriétaire, doublons, suppression et revente atomique en boutique',()=>{
    const f=fixture(),p=f.run.players.get(1);
    for(let n=1;n<=6;n++)addDrift(p,n);
    for(const d of p.drifts.slice(0,5))economy.equip(p,d.uuid,true);
    assert.throws(()=>economy.equip(p,p.drifts[5].uuid,true),/cinq/);
    assert.throws(()=>economy.equip(p,'étranger',true),/introuvable/);
    assert.throws(()=>economy.remove(p,p.drifts[0].uuid,true),/Retire/);
    economy.equip(p,p.drifts[0].uuid,false);
    const duplicate={...p.drifts[1],uuid:'duplicate',rarity:'common'};p.drifts.push(duplicate);
    assert.throws(()=>economy.equip(p,duplicate.uuid,true),/autre rareté/);
    assert.throws(()=>economy.remove(p,p.drifts[0].uuid,true),/boutique/);
    p.currentmap='ville1_shop';const uuid=p.drifts[0].uuid,before=p.money;
    economy.remove(p,uuid,true);assert.equal(p.money,before+2000);
    assert.throws(()=>economy.remove(p,uuid,true),/introuvable/);assert.equal(p.money,before+2000);
    p.inbattle=true;assert.throws(()=>economy.remove(p,'duplicate'),/indisponible/);
});

test('K.O. sauvage définitif, pas de soin/blackout, purge de session et aucun drop après une défaite',()=>{
    const f=fixture(4),p=f.run.players.get(1),enemy={npc:true,equipe:{pokemons:[factory.create(150,100)]},drifts:[],equipped:[]};
    p.equipe.pokemons[0].currentHp=1; const uuid=p.equipe.pokemons[0].uuid;
    fight(f.runtime.battle(p,enemy,'wild'));
    assert.equal(p.alive,false);assert.equal(p.equipe.pokemons.length,0);assert.equal(p.drifts.length,0);assert.deepEqual(p.items,{});assert.equal(p.money,0);
    assert.ok(!f.messages.some(m=>m.event==='blackout'));
    assert.ok(!f.runtime.state(p).team.some(a=>a.uuid===uuid));
    const summary=f.messages.find(m=>m.id===p.socketId&&m.event==='endbattle').payload.summary;
    assert.equal(summary.outcome,'defeat');assert.equal(summary.mode,'drift');
    assert.equal(summary.lostPokemon[0].uuid,uuid);assert.equal(summary.money,0);assert.deepEqual(summary.loot,[]);
});

test('capture Rift : compagnon, Drift et objet sauvage gagnés une seule fois, petite prime sans XP',()=>{
    const f=fixture(4,()=>0),p=f.run.players.get(1),wild=factory.create(19,5),enemy={npc:true,equipe:{pokemons:[wild]},drifts:[],equipped:[]};
    const b=f.runtime.battle(p,enemy,'wild');
    assert.equal(b.action(p,{action:'bag',itemKey:'pokeball',turnId:b.token}),true);
    assert.equal(b.finished,true);assert.equal(p.items.pokeball,9);assert.equal(p.items.drift_potion,3);
    assert.equal(p.equipe.pokemons.length,2);assert.equal(p.equipe.pokemons[1].uuid,wild.uuid);assert.equal(p.drifts.length,1);
    const summary=f.messages.find(m=>m.id===p.socketId&&m.event==='endbattle').payload.summary;
    assert.equal(summary.outcome,'captured');assert.equal(summary.capturedPokemon.uuid,wild.uuid);
    const definition=require('../data/game/drifts.json').definitions.find(d=>d.id===p.drifts[0].definitionId);
    assert.equal(summary.capturedPokemon.pokemonId,19);assert.deepEqual(summary.experience,[]);assert.deepEqual(summary.loot,[definition.name,'Baie Oran',...require('../server/game/items/wildCrystals').crystals.map(i=>i.name)]);assert.equal(p.items.oran_berry,1);
    assert.equal(summary.money,36);assert.equal(p.money,536);
    assert.equal(p.runReport.stats.driftsFound,1);assert.equal(p.runReport.drifts.get(p.drifts[0].uuid).source,'capture');
    b.finish(p,'captured');assert.equal(b.action(p,{action:'bag',itemKey:'pokeball',turnId:b.token}),false);
    assert.equal(p.drifts.length,1);assert.equal(p.runReport.stats.driftsFound,1);assert.equal(p.items.pokeball,9);assert.equal(p.items.oran_berry,1);assert.equal(p.money,536);
    assert.equal(f.messages.filter(m=>m.id===p.socketId&&m.event==='endbattle').length,1);
});

test('capture Rift : seuil de 15 %, bonus collectionneur et même rareté que les victoires sauvages',()=>{
    for (const [roll,collector,expected] of [[.1499,false,1],[.15,false,0],[.19,false,0],[.19,true,1],[.21,true,0]]) {
        const f=fixture(4),p=f.run.players.get(1),wild=factory.create(19,5);
        if(collector) {const d=addDrift(p,44);p.equipped=[d.uuid];}
        const b=f.runtime.battle(p,{npc:true,equipe:{pokemons:[wild]},drifts:[],equipped:[]},'wild');
        const draws=[0,roll,.9,.2];b.random=()=>draws.shift() ?? .9;
        b.action(p,{action:'bag',itemKey:'pokeball',turnId:b.token});
        assert.equal(b.finished,true);assert.equal(p.equipe.pokemons.length,2);
        assert.equal(p.drifts.length,Number(collector)+expected,`tirage ${roll}, collectionneur ${collector}`);
        if(expected)assert.equal(p.drifts.at(-1).rarity,'epic');
        const summary=f.messages.find(m=>m.id===p.socketId&&m.event==='endbattle').payload.summary;
        assert.equal(summary.loot.filter(name=>!require('../server/game/items/wildCrystals').crystals.some(i=>i.name===name)).length,expected);assert.deepEqual(summary.experience,[]);assert.equal(summary.money,36);
        assert.equal(p.items.pokeball,9);assert.equal(p.items.drift_potion,3);
    }
});

test('une capture ratée ou refusée ne tire aucun Drift',()=>{
    const f=fixture(4),p=f.run.players.get(1),wild=factory.create(19,5);
    wild.abilities=['Growl'];wild.movePp=[40];
    const b=f.runtime.battle(p,{npc:true,equipe:{pokemons:[wild]},drifts:[],equipped:[]},'wild');
    b.random=()=>.99;
    assert.equal(b.action(p,{action:'bag',itemKey:'pokeball',turnId:b.token}),true);
    assert.equal(b.finished,false);assert.equal(p.items.pokeball,9);assert.equal(p.drifts.length,0);
    b.tick();
    while(p.equipe.pokemons.length<6)p.equipe.pokemons.push(factory.create(1,5));
    p.storage=Array.from({length:require('../server/game/storage/pokemonStorage').CAPACITY},(_,i)=>({box:Math.floor(i/30),slot:i%30,pokemon:factory.create(7,5)}));
    b.random=()=>{throw new Error('Aucun tirage ne doit être effectué pour une capture refusée');};
    assert.equal(b.action(p,{action:'bag',itemKey:'pokeball',turnId:b.token}),false);
    assert.equal(p.items.pokeball,9);assert.equal(p.drifts.length,0);
    b.finish(null,'timer');
    const summary=f.messages.find(m=>m.id===p.socketId&&m.event==='endbattle').payload.summary;
    assert.deepEqual(summary.loot,[]);
});

test('victoire arène, butin rare, XP, monnaie et traitement unique de fin de combat',()=>{
    const f=fixture(4,()=>.999),p=f.run.players.get(1);
    p.equipe.pokemons=[factory.create(1,100)];
    const enemy={npc:true,equipe:{pokemons:[factory.create(19,2)]},drifts:[],equipped:[]};
    const xp=p.equipe.pokemons[0].experience;
    const b=f.runtime.battle(p,enemy,'arena','champion_test');fight(b);
    assert.ok(p.equipe.pokemons[0].experience>xp);assert.equal(p.drifts.length,1);assert.equal(p.drifts[0].rarity,'mythic');assert.ok(p.money>500);
    const summary=f.messages.find(m=>m.id===p.socketId&&m.event==='endbattle').payload.summary;
    assert.equal(summary.outcome,'victory');assert.equal(summary.money,p.money-500);
    assert.equal(summary.experience[0].xpGained,p.equipe.pokemons[0].experience-xp);
    const definition=require('../data/game/drifts.json').definitions.find(d=>d.id===p.drifts[0].definitionId);
    assert.ok(summary.loot.includes(definition.name));
    const before=JSON.stringify(f.runtime.state(p));b.finish(p,'finished');assert.equal(JSON.stringify(f.runtime.state(p)),before);
});

test('fin du chrono ferme le combat en attente, soigne uniquement les survivants et prépare les duels',()=>{
    const f=fixture(4),p=f.run.players.get(1);
    const b=f.runtime.battle(p,{npc:true,equipe:{pokemons:[factory.create(19,5)]},drifts:[],equipped:[]},'wild');
    p.equipe.pokemons[0].currentHp=2;
    const token=b.token;f.advance(1200000);
    assert.equal(b.finished,true);assert.equal(f.run.phase,'preparation');assert.equal(f.run.matches.length,2);
    assert.equal(p.currentmap,'ville1_arene');assert.equal(p.equipe.pokemons[0].currentHp,p.equipe.pokemons[0].maxHp);
    assert.equal(b.action(p,{action:'attack',number:0,turnId:token}),false);
    assert.ok(f.run.matches.every(m=>m.status==='waiting'));
    assert.equal(f.messages.find(m=>m.id===p.socketId&&m.event==='endbattle').payload.summary.outcome,'interrupted');
});

test('la fuite Drift présente un bilan sans capture, XP ou butin et conserve le compagnon vivant',()=>{
    const f=fixture(4),p=f.run.players.get(1),uuid=p.equipe.pokemons[0].uuid;
    const battle=f.runtime.battle(p,{npc:true,equipe:{pokemons:[factory.create(19,5)]},drifts:[],equipped:[]},'wild');
    battle.action(p,{action:'flee',turnId:battle.token});
    const summary=f.messages.find(m=>m.id===p.socketId&&m.event==='endbattle').payload.summary;
    assert.equal(summary.outcome,'fled');assert.equal(summary.capturedPokemon,null);assert.equal(summary.money,0);
    assert.deepEqual(summary.experience,[]);assert.deepEqual(summary.loot,[]);assert.deepEqual(summary.lostPokemon,[]);
    assert.equal(p.equipe.pokemons[0].uuid,uuid);assert.equal(p.alive,true);
});

for(const size of Array.from({length:15},(_,i)=>i+2))test(`tournoi ${size} : placement, vrais duels, morts permanentes, soins par round et vainqueur`,()=>{
    const f=fixture(size);f.runtime.beginTournament(f.run);
    assert.equal(f.run.matches.filter(m=>m.status==='bye').length,size%2);
    const seeded=f.run.matches.flatMap(m=>m.players).filter(Boolean);
    assert.equal(new Set(seeded).size,size,'chaque participant reçoit exactement une place au tirage');
    assert.notDeepEqual(seeded, f.users.map(u=>u.id),'le tirage modifie l’ordre des inscriptions');
    let rounds=0;
    while(f.run.phase!=='results'&&rounds++<5){
        const alive=[...f.run.players.values()].filter(p=>p.alive);
        const byes=f.run.matches.filter(m=>m.round===f.run.round&&m.status==='bye');
        assert.equal(byes.length,alive.length%2,'une seule exemption par round impair');
        if(byes.length){
            const exempt=f.run.players.get(byes[0].winnerId);
            assert.ok(alive.every(p=>(p.byeCount||0)>=exempt.byeCount-1),'l’exemption revient à un joueur moins souvent exempté');
        }
        const current=f.run.matches.filter(m=>m.round===f.run.round&&m.status==='waiting');
        for(const match of current){
            const [a,b]=match.players.map(id=>f.run.players.get(id));
            a.equipe.pokemons=[factory.create(1,80)];b.equipe.pokemons=[factory.create(19,5)];
            f.runtime.ready(a);f.runtime.ready(b);fight(a.battle);
            assert.equal(b.alive,false);assert.equal(b.equipe.pokemons.length,0);
        }
    }
    assert.equal(f.run.phase,'results');assert.ok(f.run.winnerId);
    assert.equal(f.run.matches.filter(m=>m.status==='finished').length,size-1,'les exemptions ne deviennent pas des duels fictifs');
    for(const p of f.run.players.values()){assert.equal(p.equipe.pokemons.length,0);assert.equal(p.drifts.length,0);}
});

test('trois survivants ont une exemption ; absents non prêts et déconnexions ne bloquent pas le tournoi',()=>{
    const f=fixture(4);f.runtime.abandon(f.run.players.get(4));f.runtime.beginTournament(f.run);
    assert.equal(f.run.matches.filter(m=>m.status==='bye').length,1);
    f.advance(90000);assert.equal(f.run.phase,'results');assert.ok(f.run.winnerId);
    const g=fixture(2);g.runtime.disconnect(g.users[0],g.sockets[0]);g.advance(RECONNECT_MS+1);
    assert.equal(g.run.phase,'results');assert.equal(g.run.winnerId,2);
});

test('les déconnexions simultanées ne créent aucun vainqueur parmi les comptes déjà expirés',()=>{
    for(const size of [2,3,5]) for(const tournament of [false,true]) {
        const f=fixture(size);
        if(tournament) {
            f.runtime.beginTournament(f.run);
            for(const match of f.run.matches.filter(m=>m.status==='waiting'))
                for(const id of match.players)f.runtime.ready(f.run.players.get(id));
        }
        f.users.forEach((user,index)=>f.runtime.disconnect(user,f.sockets[index]));
        f.advance(RECONNECT_MS+1);
        assert.equal(f.run.phase,'results');assert.equal(f.run.winnerId,null);
        assert.ok([...f.run.players.values()].every(p=>p.eliminationReason==='disconnected'));
    }
    const g=fixture(3);
    g.users.slice(0,2).forEach((user,index)=>g.runtime.disconnect(user,g.sockets[index]));
    g.advance(RECONNECT_MS+1);
    assert.equal(g.run.winnerId,3,'le seul participant encore connecté conserve sa victoire');
});

test('propriétés de deux parties simultanées, positions et butin ne sont pas partagés',()=>{
    const a=fixture(2),b=fixture(2);const pa=a.run.players.get(1),pb=b.run.players.get(1);
    addDrift(pa,1);pa.x+=32;
    assert.equal(pb.drifts.length,0);assert.equal(pb.x,80);assert.notEqual(pa.equipe.pokemons[0].uuid,pb.equipe.pokemons[0].uuid);
});

test('les PNJ Drift se déplacent avec leurs collisions sans modifier une autre partie ou l’Aventure',()=>{
    const a=fixture(),b=fixture(),map='gen_ville5';
    const adventure=require('../server/game/world/pnjStore');
    const original=adventure.getPnjsForMap(map),other=b.run.pnjs.getPnjsForMap(map);
    const player=a.run.players.get(1);player.currentmap=map;player.x=25*32+16;player.y=17*32+16;
    for(let n=0;n<10;n++)a.advance(6000);
    const moved=a.run.pnjs.getPnjsForMap(map);
    assert.ok(moved.some(p=>p.x!==p.anchorX||p.y!==p.anchorY));
    for(const p of moved){assert.equal(a.run.pnjs.getPnjAtTile(map,p.x,p.y).name,p.name);assert.equal(a.run.pnjs.isPnjBlockingTile(map,p.x,p.y),true);}
    assert.deepEqual(adventure.getPnjsForMap(map),original);assert.deepEqual(b.run.pnjs.getPnjsForMap(map),other);
    assert.ok(a.messages.some(m=>m.event==='pnjsList'&&m.payload.walking));
});

test('une perte partielle reste définitive au round suivant, les survivants récupèrent leurs PV',()=>{
    const f=fixture(4);f.runtime.beginTournament(f.run);
    const [first,second]=f.run.matches;
    const [a,b]=first.players.map(id=>f.run.players.get(id));
    a.equipe.pokemons=[factory.create(19,2),factory.create(1,80)];b.equipe.pokemons=[factory.create(19,30)];
    const lost=a.equipe.pokemons[0].uuid,survivor=a.equipe.pokemons[1].uuid;
    f.runtime.ready(a);f.runtime.ready(b);fight(a.battle);
    assert.equal(a.alive,true);assert.equal(a.equipe.pokemons.length,1);assert.equal(a.equipe.pokemons[0].uuid,survivor);
    a.equipe.pokemons[0].currentHp=1;
    const [c,d]=second.players.map(id=>f.run.players.get(id));c.equipe.pokemons=[factory.create(1,80)];d.equipe.pokemons=[factory.create(19,2)];
    f.runtime.ready(c);f.runtime.ready(d);fight(c.battle);
    assert.equal(f.run.round,2);assert.equal(a.equipe.pokemons.length,1);assert.notEqual(a.equipe.pokemons[0].uuid,lost);
    assert.equal(a.equipe.pokemons[0].currentHp,a.equipe.pokemons[0].maxHp);
});

test('un double K.O. total clôt le tournoi sans inventer de vainqueur',()=>{
    const f=fixture(2);f.runtime.beginTournament(f.run);const [a,b]=[...f.run.players.values()];
    f.runtime.ready(a);f.runtime.ready(b);const battle=a.battle;
    for(const p of [a,b])effects.damage(p.equipe.pokemons[0],p.equipe.pokemons[0].currentHp);
    battle.prune();battle.checkEnd();
    assert.equal(f.run.phase,'results');assert.equal(f.run.winnerId,null);assert.equal(f.run.matches[0].winnerId,null);
    assert.ok([...f.run.players.values()].every(p=>!p.alive&&!p.equipe.pokemons.length));
    const summaries=f.messages.filter(m=>m.event==='endbattle').map(m=>m.payload.summary);
    assert.equal(summaries.length,2);assert.ok(summaries.every(s=>s.outcome==='draw'&&s.lostPokemon.length===1));
});

test('un vainqueur peut suivre le duel voisin puis quitte le spectacle pour préparer son prochain round',()=>{
    const f=fixture(4);f.runtime.beginTournament(f.run);
    const [first,second]=f.run.matches;
    for(const match of [first,second])for(const id of match.players)f.runtime.ready(f.run.players.get(id));
    const [a,b]=first.players.map(id=>f.run.players.get(id));
    a.battle.finish(a,'forfeit');
    assert.equal(a.ready,false);
    f.runtime.spectate(a,second.id);
    assert.equal(a.watchingMatchId,second.id);
    f.runtime.spectate(b,second.id);
    const [c]=second.players.map(id=>f.run.players.get(id));
    c.battle.finish(c,'forfeit');
    assert.equal(f.run.round,2);
    assert.equal(a.watchingMatchId,null);assert.equal(b.watchingMatchId,null);
    assert.ok(f.messages.some(m=>m.id===a.socketId&&m.event==='drift:spectator'&&m.payload.reason==='finished'));
    assert.equal(f.run.matches.filter(m=>m.round===2).length,1);
});

test('XP active/réserve et fortune appliquent les Drifts, récompense de K.O. idempotente',()=>{
    const f=fixture(4),p=f.run.players.get(1);p.equipe.pokemons=[factory.create(19,5),factory.create(19,5)];
    for(const n of [43,50,51,46]){const d=addDrift(p,n);economy.equip(p,d.uuid,true);}
    const target=factory.create(19,6),before=p.equipe.pokemons.map(a=>a.experience);
    const base=require('../server/game/models/progression').calculateBattleExperience(target,1.8,p.equipe.pokemons[0]);
    const battle=f.runtime.battle(p,{npc:true,equipe:{pokemons:[target]},drifts:[],equipped:[]},'trainer','reward_fixture');
    battle.reward(target);battle.reward(target);
    const xp=2*Math.floor(base*2); // XP Rift ×2, puis +40 % apprentissage et +60 % adversaire supérieur.
    assert.equal(p.equipe.pokemons[0].experience,before[0]+xp);
    assert.equal(p.equipe.pokemons[1].experience,before[1]+Math.floor(xp*.35));
    battle.finish(p,'finished');assert.equal(p.money,500+Math.floor(6*20*1.6));
    const summary=f.messages.find(m=>m.id===p.socketId&&m.event==='endbattle').payload.summary;
    assert.deepEqual(summary.experience.map(p=>p.xpGained),[xp,Math.floor(xp*.35)]);
    assert.equal(summary.money,Math.floor(6*20*1.6));
});

test('Soigneur nomade partage le soin effectif par Symbiose avant de libérer le contexte de combat',()=>{
    const f=fixture(4),p=f.run.players.get(1);p.equipe.pokemons=[factory.create(19,20),factory.create(19,20)];
    for(const n of [49,59]){const d=addDrift(p,n);economy.equip(p,d.uuid,true);}
    for(const poke of p.equipe.pokemons){poke.maxHp=100;poke.currentHp=50;}
    const battle=f.runtime.battle(p,{npc:true,equipe:{pokemons:[factory.create(19,2)]},drifts:[],equipped:[]},'trainer','heal_fixture');
    battle.finish(p,'finished');
    assert.deepEqual(p.equipe.pokemons.map(a=>a.currentHp),[62,62]);
    assert.ok(p.equipe.pokemons.every(a=>!effects.states.has(a)));
});

test('Rift uses the new Ocreville doors, Center provenance and safe restored positions',()=>{
 const f=fixture(),p=f.run.players.get(1),set=(map,x,y)=>Object.assign(p,{currentmap:map,x:x*32+16,y:y*32+16,lastMove:0});
 for(const [map,x,y,action,target]of [['route4',18,18,'move_s','gen_route8'],['gen_route8',18,1,'move_z','route4'],['gen_route8',23,18,'move_s','gen_ville5'],['gen_ville5',23,1,'move_z','gen_route8'],['gen_ville5',23,18,'move_s','gen_route7'],['gen_route7',23,1,'move_z','gen_ville5']]){set(map,x,y);f.runtime.move(p,action);assert.equal(p.currentmap,target);}
 for(const [x,y,target]of [[4,4,'gen_maison_ville5_1'],[12,4,'gen_maison_ville5_2'],[16,17,'gen_maison_ville5_3'],[5,12,'gen_arene5'],[23,13,'gen_shop_ville5_1'],[17,7,'centre']]){set('gen_ville5',x,y+1);f.runtime.move(p,'move_z');assert.equal(p.currentmap,target);if(p.dialogue?.arenaEntry)f.runtime.endDialogue(p,p.dialogue.name);p.lastMove=0;f.runtime.move(p,'move_s');assert.equal(p.currentmap,'gen_ville5');assert.deepEqual([p.x,p.y],[x*32+16,(y+1)*32+16]);}
 for(const map of ['gen_route8','gen_ville5']){set(map,0,0);f.runtime.enter(f.users[0],f.sockets[0]);const repo=require('../server/game/world/mapRepository'),x=Math.floor(p.x/32),y=Math.floor(p.y/32);assert.equal(repo.loadCollisionData(map)[y][x],0);assert.equal(repo.changeMapData(map)[y][x],0);}
});

test('Repousse Rift : murs et commandes invalides gratuits, pas réel compté, portail protégé et expiration unique',()=>{
 const f=fixture(2,()=>0),p=f.run.players.get(1);
 p.repelSteps=10;p.currentmap='gen_ville5';p.x=23*32+16;p.y=1*32+16;p.lastMove=0;
 f.runtime.move(p,'teleport');assert.equal(p.repelSteps,10);
 // Northern portal returns to Route 8; transition itself does not consume extra steps.
 f.runtime.move(p,'move_z');assert.equal(p.currentmap,'gen_route8');assert.equal(p.repelSteps,9);
 p.currentmap='start';p.x=16;p.y=16;p.lastMove=0;
 f.runtime.move(p,'move_z');assert.equal(p.repelSteps,9,'outside the map is not a step');
 p.currentmap='gen_route8';p.x=23*32+16;p.y=18*32+16;p.lastMove=0;p.repelSteps=1;
 f.runtime.move(p,'move_s');assert.equal(p.currentmap,'gen_ville5');assert.equal(p.repelSteps,0);
 assert.equal(f.messages.filter(m=>m.event==='progressionNotice'&&/Repousse/.test(m.payload.message)).length,1);
 assert.equal(f.runtime.state(p).repelSteps,0);
});

test('Rift et Colosseum réduisent les rencontres de 20 % sur les vrais pas dans les herbes',()=>{
 for(const mode of ['rift','colosseum'])for(const roll of [.05,.06]){
  const f=fixture(2,()=>roll),p=f.run.players.get(1);f.run.mode=mode;
  const maps=require('../server/game/world/mapRepository'),map='route1',c=maps.loadCollisionData(map),b=maps.battleMapData(map),changes=maps.changeMapData(map);
  let pair;
  for(let y=1;y<c.length&&!pair;y++)for(let x=1;x<c[y].length-1;x++)if(c[y][x]===0&&c[y][x+1]===0&&b[y]?.[x+1]&&!changes[y]?.[x+1]&&!f.run.pnjs.isPnjBlockingTile(map,x+1,y)){pair={x,y};break;}
  assert(pair);Object.assign(p,{currentmap:map,x:pair.x*32+16,y:pair.y*32+16,lastMove:0});
  f.runtime.move(p,'move_d');
  assert.equal(p.x,(pair.x+1)*32+16,'le déplacement est réellement accepté');
  assert.equal(Boolean(p.inbattle),roll===.05,`${mode}: tirage ${roll}`);
  assert.equal(f.messages.some(m=>m.event==='battletrigger'),roll===.05);
 }
});

test('Repousse filtre une vraie rencontre Rift sur le dernier pas, le pas suivant déclenche le combat',()=>{
 const f=fixture(2,()=>0),p=f.run.players.get(1);
 const maps=require('../server/game/world/mapRepository');
 const map='route1',c=maps.loadCollisionData(map),b=maps.battleMapData(map),changes=maps.changeMapData(map);
 let pair;
 for(let y=1;y<c.length&&!pair;y++)for(let x=1;x<c[y].length-1;x++)if(c[y][x]===0&&c[y][x+1]===0&&b[y]?.[x]&&b[y]?.[x+1]&&!changes[y]?.[x]&&!changes[y]?.[x+1]&&!f.run.pnjs.isPnjBlockingTile(map,x,y)&&!f.run.pnjs.isPnjBlockingTile(map,x+1,y)){pair={x,y};break;}
 assert(pair);Object.assign(p,{currentmap:map,x:pair.x*32+16,y:pair.y*32+16,lastMove:0,repelSteps:1});p.equipe.pokemons[0].level=100;
 f.runtime.move(p,'move_d');assert.equal(p.repelSteps,0);assert(!p.inbattle);
 p.lastMove=0;f.runtime.move(p,'move_q');assert(p.inbattle);assert(f.messages.some(m=>m.event==='battletrigger'));
});

test('Rift and Colosseum traverse Routes 9/10 and the shop; Clairfontaine opens south and its west exit reaches Route 11',()=>{
 for(const mode of ['rift','colosseum']){
  const f=fixture(),p=f.run.players.get(1);f.run.mode=mode;
  const set=(map,x,y)=>Object.assign(p,{currentmap:map,x:x*32+16,y:y*32+16,lastMove:0});
  for(const [map,x,y,action,target,xy]of [['gen_ville5',23,18,'move_s','gen_route7',[23,1]],['gen_route7',6,18,'move_s','gen_route6',[6,1]],['gen_route6',6,1,'move_z','gen_route7',[6,18]],['gen_route7',23,1,'move_z','gen_ville5',[23,18]],['gen_route6',20,8,'move_z','gen_shop_route10',[13,15]],['gen_shop_route10',13,15,'move_s','gen_route6',[20,8]]]){set(map,x,y);f.runtime.move(p,action);assert.equal(p.currentmap,target);assert.deepEqual([Math.floor(p.x/32),Math.floor(p.y/32)],xy);}
  set('gen_route6',14,18);f.runtime.move(p,'move_s');assert.equal(p.currentmap,'ville3');assert.deepEqual([p.x,p.y],[14*32+16,48]);p.lastMove=0;f.runtime.move(p,'move_z');assert.equal(p.currentmap,'gen_route6');
  for(const [x,y,target]of [[23,6,'centre'],[5,8,'ville3_arene'],[22,13,'ville3_shop'],[5,16,'ville3_maison1'],[15,16,'ville3_maison2']]){set('ville3',x,y+1);f.runtime.move(p,'move_z');assert.equal(p.currentmap,target);if(p.dialogue?.arenaEntry)f.runtime.endDialogue(p,p.dialogue.name);p.lastMove=0;f.runtime.move(p,'move_s');assert.equal(p.currentmap,'ville3');assert.deepEqual([Math.floor(p.x/32),Math.floor(p.y/32)],[x,y+1]);}
  set('ville3',1,16);f.runtime.move(p,'move_q');assert.equal(p.currentmap,'route11');assert.deepEqual([p.x,p.y],[26*32+16,16*32+16]);p.lastMove=0;f.runtime.move(p,'move_d');assert.equal(p.currentmap,'ville3');assert.equal(p.x,48);set('gen_route6',14,18);
  const {decode,encode}=require('../server/game/drift/checkpointCodec'),restored=decode(encode(f.run));assert.equal(restored.players.get(1).currentmap,'gen_route6');
 }
});

test('Rift/Colosseum cross Routes 11/12 and Rochebrume, use all doors and reach both arena champions',()=>{
 for(const mode of ['rift','colosseum']){
  const f=fixture(),p=f.run.players.get(1);f.run.mode=mode;const set=(map,x,y)=>Object.assign(p,{currentmap:map,x:x*32+16,y:y*32+16,lastMove:0});
  for(const [map,x,y,action,target]of [['ville3',1,16,'move_q','route11'],['route11',26,16,'move_d','ville3'],['route11',1,6,'move_q','route12'],['route12',26,6,'move_d','route11'],['route12',1,14,'move_q','ville4'],['ville4',26,14,'move_d','route12']]){set(map,x,y);f.runtime.move(p,action);assert.equal(p.currentmap,target);}
  p.defeated.add('champion_wanda'); // Expeditions retain Wanda-based access; Adventure uses the father's key.
  set('route4',11,18);f.runtime.move(p,'move_z');assert.equal(p.currentmap,'route4_maison');
  p.lastMove=0;f.runtime.move(p,'move_s');assert.equal(p.currentmap,'route4');assert.deepEqual([Math.floor(p.x/32),Math.floor(p.y/32)],[11,18]);
  for(const [x,y,target]of [[4,8,'centre'],[22,8,'ville4_shop'],[14,11,'ville4_arene'],[5,16,'ville4_maison1'],[22,16,'ville4_maison2']]){set('ville4',x,y+1);f.runtime.move(p,'move_z');assert.equal(p.currentmap,target);if(p.dialogue?.arenaEntry)f.runtime.endDialogue(p,p.dialogue.name);p.lastMove=0;f.runtime.move(p,'move_s');assert.equal(p.currentmap,'ville4');assert.deepEqual([Math.floor(p.x/32),Math.floor(p.y/32)],[x,y+1]);}
  set('ville4',13,4);f.runtime.move(p,'move_z');assert.equal(p.currentmap,'cave_rochebrume1');
  for(const n of [1,2])for(const x of [12,13,14]){set(`cave_rochebrume${n}`,x,1);f.runtime.move(p,'move_z');assert.equal(p.currentmap,`cave_rochebrume${n+1}`);assert.deepEqual([Math.floor(p.x/32),Math.floor(p.y/32)],[x,18]);p.lastMove=0;f.runtime.move(p,'move_s');assert.equal(p.currentmap,`cave_rochebrume${n}`);assert.deepEqual([Math.floor(p.x/32),Math.floor(p.y/32)],[x,1]);}
  set('cave_rochebrume3',13,4);f.runtime.move(p,'move_z');assert.equal(p.currentmap,'route13');assert.deepEqual([Math.floor(p.x/32),Math.floor(p.y/32)],[13,18]);
  for(const x of [12,13,14,15,16]){set('route13',x,1);f.runtime.move(p,'move_z');assert.equal(p.currentmap,'route14');assert.deepEqual([Math.floor(p.x/32),Math.floor(p.y/32)],[x,18]);p.lastMove=0;f.runtime.move(p,'move_s');assert.equal(p.currentmap,'route13');assert.deepEqual([Math.floor(p.x/32),Math.floor(p.y/32)],[x,1]);set('route13',x,18);f.runtime.move(p,'move_s');assert.equal(p.currentmap,'cave_rochebrume3');assert.deepEqual([Math.floor(p.x/32),Math.floor(p.y/32)],[13,4]);set('route14',x,1);f.runtime.move(p,'move_z');assert.equal(p.currentmap,'ville5');assert.deepEqual([Math.floor(p.x/32),Math.floor(p.y/32)],[x,18]);p.lastMove=0;f.runtime.move(p,'move_s');assert.equal(p.currentmap,'route14');assert.deepEqual([Math.floor(p.x/32),Math.floor(p.y/32)],[x,1]);}
  set('cave_rochebrume1',13,18);f.runtime.move(p,'move_s');assert.equal(p.currentmap,'ville4');assert.deepEqual([Math.floor(p.x/32),Math.floor(p.y/32)],[13,5]);
  for(const [map,name]of [['ville3_arene','champion_ana'],['ville4_arene','champion_wanda']]){const next=fixture(),a=next.run.players.get(1);next.run.mode=mode;Object.assign(a,{currentmap:map,x:432,y:176});next.runtime.interact(a);assert.equal(a.dialogue.name,name);next.runtime.endDialogue(a,name);assert(a.inbattle);assert.equal(a.battle.type,'arena');assert(next.messages.some(m=>m.event==='battletrigger'));}
 }
});

test('arena welcome is personal per expedition and cannot be bypassed by movement',()=>{
 const f=fixture(),p=f.run.players.get(1);
 Object.assign(p,{currentmap:'ville1_arene',x:432,y:528});
 f.runtime.enter(f.users[0],f.sockets[0]);
 const welcome=f.messages.filter(m=>m.id==='s1'&&m.event==='dialogue').at(-1).payload;
 assert.equal(welcome[1],'arena_entry:moon');
 f.advance(200);f.runtime.move(p,'move_z');assert.equal(p.y,528);
 f.runtime.endDialogue(p,welcome[1]);assert.equal(p.arenaEntriesSeen['arena_entry:moon'],'true');
 const count=f.messages.filter(m=>m.event==='dialogue').length;
 f.runtime.enter(f.users[0],f.sockets[0]);assert.equal(f.messages.filter(m=>m.event==='dialogue').length,count);
 f.advance(200);f.runtime.move(p,'move_z');assert.equal(p.y,496);
 const other=f.run.players.get(2);Object.assign(other,{currentmap:'ville1_arene',x:432,y:528});
 f.runtime.enter(f.users[1],f.sockets[1]);assert.equal(f.messages.filter(m=>m.event==='dialogue').length,count+1);
});

test('champion victory in expedition emits a read-only congratulations without adventure rewards',()=>{
 const f=fixture(),p=f.run.players.get(1);
 Object.assign(p,{currentmap:'ville1_arene',x:432,y:176});
 p.equipe.pokemons=[factory.create(150,200)];
 p.equipe.pokemons[0].abilities=['Psychic'];p.equipe.pokemons[0].movePp=[30];
 f.runtime.interact(p);assert.equal(p.dialogue.name,'moon');f.runtime.endDialogue(p,'moon');fight(p.battle);
 const d=f.messages.filter(m=>m.id==='s1'&&m.event==='dialogue').at(-1).payload;
 assert.equal(d[1],'arena_victory:moon');assert.equal(d[2].afterBattle,true);assert(!d[0][0].text.includes('Badge'));
 f.runtime.endDialogue(p,d[1]);assert.equal(p.dialogue,null);
});
