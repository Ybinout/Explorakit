const test = require('node:test');
const assert = require('node:assert/strict');
const policy = require('../server/game/world/arenaTests');
const owner = {id:4,username:'binout'};
const {getSentenceForName} = require('../server/game/world/interactionRepository');
function allWon() {
    const flags = {route_guard_defeated:'true',aspha_route2_defeated:'true'};
    for (const c of policy.encounters) Object.assign(flags,c.definition.reward.flags);
    return {flags,completedNpcBattles:policy.encounters.map(c=>({battleKey:c.definition.battleKey}))};
}
test('arena admin is restricted to the exact existing owner identity', () => {
    assert(policy.isOwner(owner));
    for (const user of [null,{}, {id:162,username:'binout'},{id:4,username:'ybinout'},{id:'4',username:'binout'},{id:4,username:'Binout'}]) assert.equal(policy.isOwner(user),false);
});
test('only active, already won story encounters with access are replayable', () => {
    assert.deepEqual(policy.encounters.map(c=>c.name).sort(),['moon','champion_hoze','champion_raphael','champion_ana','champion_wanda','champion_7p','dia1','aspha_route2','gwenn_route8','mathilde_pikapika','gwenn_rochebrume','lucie_route2','nrv_noz','nrv_tom','nrv_cry'].sort());
    const progress = allWon();
    assert.equal(policy.eligible(owner,progress).length,policy.encounters.length);
    assert.equal(policy.eligible(owner,{flags:{},completedNpcBattles:[]}).length,0);
    assert.equal(policy.canReplay(owner,'moon',progress),false);
    for(const c of policy.encounters) progress.flags[c.flag]='ready';
    assert(policy.canReplay(owner,'moon',progress));
    assert.equal(policy.canReplay({id:162,username:'binout'},'moon',progress),false);
    assert.equal(policy.canReplay(owner,'lucie_route2',progress),true);
    assert.deepEqual(policy.publicState(owner,progress),{allowed:true,total:policy.encounters.length,unlocked:policy.encounters.length,ready:policy.encounters.length});
    assert.deepEqual(policy.publicState({id:5,username:'other'},progress),{allowed:false});
});
test('replay dialogue override preserves normal post-victory dialogues and story flags', () => {
    const progress = allWon(), before = structuredClone(progress);
    for (const c of policy.encounters) {
        assert.equal(getSentenceForName(c.name,progress)[1],c.name+'_after');
        assert.equal(getSentenceForName(c.name,progress,{replayArena:true})[1],c.name);
    }
    assert.deepEqual(progress,before);
});
test('real SQL/socket replay: authorization, persistence, victory, no rewards, cancellation', {skip:process.env.RUN_MYSQL_TESTS!=='1',timeout:45000}, async () => {
    assert.match(process.env.DB_NAME||'',/test/i);
    const http=require('node:http'),{once}=require('node:events'),{randomUUID}=require('node:crypto');
    const express=require('express'),{Server}=require('socket.io'),{io:client}=require('../vue-explorakit/node_modules/socket.io-client');
    const {dbPool:db}=require('../server/config/database'),repository=require('../server/persistence/arenaTestRepository');
    const progression=require('../server/persistence/progressionRepository'),teamRepo=require('../server/persistence/teamRepository');
    const app=express(),server=http.createServer(app),io=new Server(server);
    app.use(express.json());app.use('/api',require('../server/http/routes'));io.use(require('../server/http/authMiddleware').authenticateSocket);require('../server/realtime/socketHandler')(io);
    const ids=[],sockets=[],original=policy.isOwner;let base;
    const pause=ms=>new Promise(r=>setTimeout(r,ms));
    const event=(s,name,accept=()=>true)=>new Promise((resolve,reject)=>{const timer=setTimeout(()=>{s.off(name,handler);reject(Error('Missing '+name));},12000);function handler(p){if(!accept(p))return;clearTimeout(timer);s.off(name,handler);resolve(p);}s.on(name,handler);});
    const command=(s,data={})=>new Promise(r=>s.emit('admin:rearmArenas',data,r));
    async function create(){const r=await fetch(base+'/api/users',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'arena_test_'+randomUUID(),password:randomUUID(),starterId:7})});assert.equal(r.status,201);const u=await r.json();ids.push(u.user.id);return u;}
    async function connect(u){await db.execute("UPDATE users SET map='ville1_arene',x=432,y=176 WHERE id=?",[u.user.id]);const s=client(base,{autoConnect:false,auth:{token:u.token},transports:['websocket'],reconnection:false});sockets.push(s);const state=event(s,'adminArenaState');s.connect();return{s,state:await state};}
    async function protectedState(id){
        const progress=await progression.loadProgressState(id);
        const [xp]=await db.execute("SELECT flag_key,flag_value FROM player_story_flags WHERE user_id=? AND flag_key NOT LIKE 'admin_arena_replay:%' AND flag_key NOT LIKE 'arena_entry:%' AND flag_key NOT LIKE 'admin_room_obstacle:%' ORDER BY flag_key",[id]);
        const [items]=await db.execute('SELECT * FROM user_items WHERE user_id=? ORDER BY item_key',[id]);
        return {flags:xp,items,badges:progress.badges,battles:progress.completedNpcBattles,money:progress.money,quests:progress.quests};
    }
    try {
        server.listen(0,'127.0.0.1');await once(server,'listening');base=`http://127.0.0.1:${server.address().port}`;
        const admin=await create(),other=await create();
        // Fixture identity exists only in this isolated test process, never in production configuration.
        policy.isOwner=u=>u?.id===admin.user.id&&u?.username===admin.user.username;
        await assert.rejects(repository.rearm(other.user),/réservé/);
        await assert.rejects(repository.rearm({...admin.user,username:'binout'}),/réservé/);
        for(const key of ['route_guard_defeated','aspha_route2_defeated'])await db.execute('INSERT INTO player_story_flags(user_id,flag_key,flag_value)VALUES(?,?,?)',[admin.user.id,key,'true']);
        for(const c of policy.encounters)await progression.completeNpcBattle(admin.user.id,c.name);
        const lead=require('../server/game/drift/pokemonFactory').create(150,200,true);lead.k=4;lead.recalculateStats();lead.currentHp=lead.maxHp;lead.abilities=[];lead.movePp=[];for(const move of ['Dark Pulse','Aura Sphere','Ice Beam','Recover'])lead.addAbility(move);
        await teamRepo.editEquipe(admin.user.id,{pokemons:[lead]});
        const before=await protectedState(admin.user.id),training=p=>({experience:p.experience,ev:p.ev,level:p.level});
        const beforeTraining=training((await teamRepo.loadEquipe(admin.user.id)).pokemons[0]);
        const stranger=await connect(other);assert.deepEqual(stranger.state,{allowed:false});assert.equal((await command(stranger.s,{userId:admin.user.id,admin:true})).success,false);stranger.s.disconnect();await pause(100);
        let {s,state}=await connect(admin);assert.equal(state.ready,0);
        const results=await Promise.all([command(s),command(s)]);assert(results.some(r=>r.success&&r.count===policy.encounters.length));
        assert.deepEqual(await protectedState(admin.user.id),before);
        s.disconnect();await pause(150);({s,state}=await connect(admin));assert.equal(state.ready,policy.encounters.length);
        let speech=event(s,'dialogue');s.emit('Space');assert.equal((await speech)[1],'moon');
        assert.equal((await command(s)).success,false,'no rearm during dialogue');
        let attack=event(s,'requestAction'),ended=event(s,'endbattle'),followup=event(s,'dialogue',p=>p[1]==='moon_after');s.emit('onEndDialogue','moon');await attack;
        assert.equal((await command(s)).success,false,'no rearm during combat');
        s.on('requestAction',()=>s.emit('actionResponse',{action:'attack',number:0}));s.emit('actionResponse',{action:'attack',number:0});
        const result=await ended;assert.equal(result.summary.outcome,'victory');assert.equal(result.summary.money,0);
        assert.deepEqual(training((await teamRepo.loadEquipe(admin.user.id)).pokemons[0]),beforeTraining);
        assert.deepEqual(await protectedState(admin.user.id),before);
        assert.equal(policy.publicState(admin.user,await progression.loadProgressState(admin.user.id )).ready,policy.encounters.length-1);
        assert.equal((await followup)[2].afterBattle,true);s.emit('onEndDialogue','moon_after');await pause(100);
        assert.equal((await command(s)).count,policy.encounters.length);
        s.removeAllListeners('requestAction');speech=event(s,'dialogue');s.emit('Space');assert.equal((await speech)[1],'moon');attack=event(s,'requestAction');s.emit('onEndDialogue','moon');await attack;s.disconnect();await pause(250);
        assert.equal(policy.publicState(admin.user,await progression.loadProgressState(admin.user.id )).ready,policy.encounters.length,'disconnect retains retry');
        // Fresh database identity is checked under lock, even if the JWT still contains its old username.
        await db.execute('UPDATE users SET username=? WHERE id=?',['renamed_'+randomUUID(),admin.user.id]);
        await assert.rejects(repository.rearm(admin.user),/réservé/);
    } finally {
        for(const s of sockets)s.disconnect();await new Promise(r=>io.close(r));await pause(150);policy.isOwner=original;
        for(const id of ids)await db.execute('DELETE FROM users WHERE id=?',[id]);await db.end();
    }
});
