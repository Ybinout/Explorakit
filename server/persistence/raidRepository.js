const {
    dbPool,
    withTransaction
  } = require('../config/database'),
  codec = require('../game/drift/checkpointCodec'),
  teams = require('./teamRepository');
async function world(day) {
  const [[r]] = await dbPool.execute('SELECT snapshot FROM corruption_raid_world WHERE day_key=?', [day]);
  return r ? codec.decode(r.snapshot) : null;
}
async function latestWorld(){const [[r]]=await dbPool.execute('SELECT snapshot FROM corruption_raid_world ORDER BY day_key DESC LIMIT 1');return r?codec.decode(r.snapshot):null;}
async function saveWorld(value) {
  await dbPool.execute('INSERT INTO corruption_raid_world(day_key,snapshot) VALUES(?,?) ON DUPLICATE KEY UPDATE snapshot=VALUES(snapshot)', [value.day, await codec.encodeAsync(value)]);
}
async function loadActive() {
  const [rows] = await dbPool.execute("SELECT id,version,snapshot FROM corruption_raids WHERE phase IN ('lobby','active')");
  return rows.map(r => ({
    ...codec.decode(r.snapshot),
    version: Number(r.version)
  }));
}
async function membership(id) {
  const [[r]] = await dbPool.execute('SELECT raid_id FROM corruption_raid_members WHERE user_id=?', [id]);
  return r?.raid_id || null;
}
async function member(id, name) {
  const team = await teams.loadEquipe(id);
  if (!team?.pokemons?.some(p => p.currentHp > 0)) throw Error('Présente au moins un Pokémon apte.');
  return {
    id,
    name,
    team,
    selected: [],
    ready: false,
    joinedAt: Date.now(),
    reserved: false
  };
}
async function tutorialSeen(id) {
  const [[r]] = await dbPool.execute("SELECT flag_value FROM player_story_flags WHERE user_id=? AND flag_key='corruption_raid_tutorial'", [id]);
  return r?.flag_value === 'true';
}
async function acknowledgeTutorial(id) {
  await dbPool.execute("INSERT INTO player_story_flags(user_id,flag_key,flag_value) VALUES(?,'corruption_raid_tutorial','true') ON DUPLICATE KEY UPDATE flag_value='true'", [id]);
}
async function save(run, {
  expected = run.version || 0,
  settle = false,
  partyChanged = true,
  worldAfter = null,
  random = require('../game/raids/content').secureRandom
} = {}) {
  return withTransaction(async c => {
    const ids = run.members.map(m => m.id).sort((a, b) => a - b);
    for (const id of ids) await c.execute('SELECT id FROM users WHERE id=? FOR UPDATE', [id]);
    const [[old]] = await c.execute('SELECT version FROM corruption_raids WHERE id=? FOR UPDATE', [run.id]);
    if (Number(old?.version || 0) !== expected) throw Error('Le raid a été actualisé ailleurs. Reconnecte-toi.');
    const next = expected + 1;
    if (!old) await c.execute('INSERT INTO corruption_raids(id,phase,version,snapshot) VALUES(?,?,?,?)', [run.id, run.phase, next, codec.encode({})]);
    if (run.phase === 'active' && partyChanged || settle) {
      for (const m of run.members.filter(m => !m.reserved)) {
        const eligible = new Set(run.combat.models.filter(p => p.ownerId === m.id).map(p => p.pokemon.uuid));
        const player = {
          id: String(m.id),
          equipe: m.team
        };
        await require('./darkContinentRepository').persistFaints(m.id, player, {
          to: () => ({
            emit: () => {}
          })
        }, eligible, c);
        m.casualties ||= [];
        for (const p of m.team.pokemons) if ((p.__darkContinentDead || p.__darkSurvivalSettled) && !m.casualties.some(v => v.uuid === p.uuid)) m.casualties.push({
          uuid: p.uuid,
          name: p.truename || p.data.name.french,
          protected: !!p.__darkSurvivalSettled
        });
        m.team.pokemons = m.team.pokemons.filter(p => !p.__darkContinentDead);
        await teams.editEquipe(m.id, m.team, c);
      }
    }
    if (settle && run.won) {
      for (const m of run.members.filter(m => !m.reserved)) {
        const [[previous]] = await c.execute('SELECT receipt_json FROM corruption_raid_rewards WHERE raid_id=? AND user_id=?', [run.id, m.id]);
        if (previous) {
          m.reward = typeof previous.receipt_json === 'string' ? JSON.parse(previous.receipt_json) : previous.receipt_json;
          continue;
        }
        const reward = require('../game/raids/content').rewards(run.rift.difficulty, random),
          [[wallet]] = await c.execute('SELECT money FROM users WHERE id=?', [m.id]);
        reward.money = Math.min(reward.money, Math.max(0, Number.MAX_SAFE_INTEGER - Number(wallet.money)));
        await c.execute('UPDATE users SET money=money+? WHERE id=?', [reward.money, m.id]);
        for (const item of reward.items) await c.execute('INSERT INTO user_items(user_id,item_key,quantity) VALUES(?,?,?) ON DUPLICATE KEY UPDATE quantity=quantity+VALUES(quantity)', [m.id, item.key, item.quantity]);
        await c.execute('INSERT INTO corruption_raid_rewards(raid_id,user_id,receipt_json) VALUES(?,?,?)', [run.id, m.id, JSON.stringify(reward)]);
        m.reward = reward;
      }
    }
    await c.execute('DELETE FROM corruption_raid_members WHERE raid_id=?', [run.id]);
    if (['lobby', 'active'].includes(run.phase)) for (const id of ids) {
      const [[occupied]] = await c.execute('SELECT raid_id FROM corruption_raid_members WHERE user_id=? FOR UPDATE', [id]);
      if (occupied && occupied.raid_id !== run.id) throw Error('Ce dresseur a déjà rejoint un autre raid.');
      await c.execute('INSERT INTO corruption_raid_members(user_id,raid_id) VALUES(?,?)', [id, run.id]);
    }
    const snapshot = {
      ...run,
      version: next
    };
    await c.execute('UPDATE corruption_raids SET phase=?,version=?,snapshot=? WHERE id=?', [run.phase, next, await codec.encodeAsync(snapshot), run.id]);
    if(worldAfter) await c.execute('INSERT INTO corruption_raid_world(day_key,snapshot) VALUES(?,?) ON DUPLICATE KEY UPDATE snapshot=VALUES(snapshot)',[worldAfter.day,await codec.encodeAsync(worldAfter)]);
    return next;
  });
}
module.exports = {
  world,
  saveWorld,
  latestWorld,
  loadActive,
  membership,
  member,
  tutorialSeen,
  acknowledgeTutorial,
  save
};
