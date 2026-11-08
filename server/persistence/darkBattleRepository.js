const {dbPool,withTransaction}=require('../config/database');
const codec=require('../game/drift/checkpointCodec');
const dark=require('./darkContinentRepository');
const teams=require('./teamRepository');
const {adventureMoneyReward}=require('../game/battle/wildReward');
const encounters=require('../game/world/darkEncounters');

async function load(userId) {
    const [[row]]=await dbPool.execute('SELECT version,snapshot FROM dark_battle_checkpoints WHERE user_id=?',[userId]);
    return {version:Number(row?.version)||0,run:row?.snapshot?codec.decode(row.snapshot):null};
}
async function assertInactive(userId,c=dbPool) {
    const [[draft]]=await c.execute('SELECT table_id FROM draft_members WHERE user_id=?',[userId]);
    if(draft)throw Object.assign(Error('Termine ou quitte ta draft avant de modifier ton équipe ou ton sac.'),{statusCode:409});
    const [[raid]]=await c.execute('SELECT raid_id FROM corruption_raid_members WHERE user_id=?',[userId]);
    if(raid)throw Object.assign(Error('Termine ou quitte ton raid avant de modifier ton équipe ou ton sac.'),{statusCode:409});
    const [[row]]=await c.execute('SELECT snapshot IS NOT NULL AS active FROM dark_battle_checkpoints WHERE user_id=?',[userId]);
    if(row?.active)throw Object.assign(Error('Reprends ton combat du Dark Continent avant de modifier ton équipe.'),{statusCode:409});
}
async function loadBalls(userId){return Object.fromEntries((await require('./itemRepository').loadUserItems(userId)).filter(i=>i.category==='ball').map(i=>[i.key,i.quantity]));}

// Account -> checkpoint -> party/inventory: the same lock order as other account writes.
// No outcome is emitted before this transaction commits. Repeating a stale turn
// cannot delete another Pokémon, return equipment twice or pay another reward.
async function save(userId,run,version,{emit=()=>{},random=Math.random}={}) {
    return withTransaction(async c=>{
        const [[user]]=await c.execute('SELECT id,money FROM users WHERE id=? FOR UPDATE',[userId]);
        if(!user)throw Error('Dresseur introuvable.');
        await c.execute('INSERT IGNORE INTO dark_battle_checkpoints(user_id) VALUES(?)',[userId]);
        const [[row]]=await c.execute('SELECT version FROM dark_battle_checkpoints WHERE user_id=? FOR UPDATE',[userId]);
        if(Number(row.version)!==version)throw Error('Ce combat a changé. Reconnecte-toi pour le reprendre.');
        const b=run.battle,original=b.originalTeams.get(b.a);
        if(!run.persisted){
            // An HTTP equipment update racing the initial encounter must not
            // overwrite its newer inventory state with a cached world party.
            const [owned]=await c.execute('SELECT p.uuid,p.held_item FROM pokemons p JOIN teams t ON t.id=p.team_id WHERE t.user_id=?',[userId]);
            if(owned.length!==run.initialHeld.size||owned.some(p=>!run.initialHeld.has(p.uuid)||run.initialHeld.get(p.uuid)!==(p.held_item||null)))throw Error('Ton équipe a changé. Reconnecte-toi pour la retrouver.');
            run.persisted=true;
        }
        if(!run.seen){await require('./progressionRepository').markPokemonSeen(userId,run.enemy,c);run.seen=true;emit('pokedexChanged',{reason:'wild_seen',pokemonId:run.enemy.data.id});}
        while(!run.chargeComplete&&(run.chargedActions||0)<(b.electricActions||0)){
            run.chargedActions=(run.chargedActions||0)+1;
            const charged=await require('./voidEndingRepository').charge(userId,`${b.id}:${run.chargedActions}`,c);
            if(!charged.available||!charged.found||charged.charge>=5)run.chargeComplete=true;
            if(charged.changed){emit('progressionNotice',{type:'teleporter_charge',charge:charged.charge,message:`Téléporteur chargé à ${charged.charge}/5`});emit('bagUpdated',{items:await require('./itemRepository').loadUserItems(userId,c)});}
        }
        const losses=await dark.persistFaints(userId,{id:run.player.id,equipe:{pokemons:original}}, {to:()=>({emit})},run.started,c);
        const team={pokemons:run.player.equipe.pokemons.filter(p=>!p.__darkContinentDead)};
        await teams.editEquipe(userId,team,c);
        let spentBall=false;
        for(const [key,previous]of Object.entries(run.balls)){
            const quantity=run.player.items[key],spent=previous-quantity;
            if(!Number.isInteger(spent)||spent<0)throw Error('Stock de Balls incohérent.');
            if(!spent)continue;
            const [changed]=await c.execute('UPDATE user_items SET quantity=quantity-? WHERE user_id=? AND item_key=? AND quantity>=?',[spent,userId,key,spent]);
            if(changed.affectedRows!==1)throw Error('Tu ne possèdes plus cette Ball.');
            run.balls[key]=quantity;spentBall=true;
        }
        if(spentBall)emit('bagUpdated',{items:await require('./itemRepository').loadUserItems(userId,c)});
        let money=0,loot=[];
        if(b.finished && b.b.equipe.pokemons.every(p=>p.currentHp<=0) && team.pokemons.some(p=>p.currentHp>0)) {
            const enemy=run.enemy;
            money=encounters.money(enemy,run.map,adventureMoneyReward(enemy));
            await c.execute('UPDATE users SET money=money+? WHERE id=?',[money,userId]);
            loot=await dark.grantLoot(userId,enemy,random,run.map,c);
        }
        const snapshot=b.finished?null:await codec.encodeAsync(run);
        const [updated]=await c.execute('UPDATE dark_battle_checkpoints SET snapshot=?,version=version+1 WHERE user_id=? AND version=?',[snapshot,userId,version]);
        if(updated.affectedRows!==1)throw Error('Sauvegarde du combat interrompue.');
        return {version:version+1,money,loot,losses,balance:Number(user.money)+money};
    });
}
module.exports={load,save,assertInactive,loadBalls};
