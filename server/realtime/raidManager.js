const {
    randomUUID,
    randomInt
  } = require('node:crypto'),
  content = require('../game/raids/content'),
  repo = require('../persistence/raidRepository'),
  codec = require('../game/drift/checkpointCodec'),
  {
    RaidBattle
  } = require('../game/raids/RaidBattle'),
  locks = require('../game/social/tradeLocks'),
  motion = require('../game/raids/worldMotion'),
  {
    trackAccountTask
  } = require('./accountConnection');
const managers = new WeakMap();
const fail = message => {
  throw Object.assign(Error(message), {
    statusCode: 409
  });
};
const quota = (count, i, extra) => count === 1 ? 4 : count === 2 ? 2 : count === 3 ? i === extra ? 2 : 1 : 1;
function createRaidManager({
  store = repo,
  now = Date.now,
  tickMs = 500,
  random = content.secureRandom
} = {}) {
  const previews=new Map();
  const contexts = new Map(),
    runs = new Map(),
    active = new Map();
  let world,
    queue = Promise.resolve(),
    closed = false,
    ticking = false;
  const ready = (async () => {
    world = await store.world(content.dayKey(now()));
    if (!world) {
      world = content.createDay(now());
      await store.saveWorld(world);
    }
    for (const run of await store.loadActive()) {
      runs.set(run.id, run);
      for (const m of run.members) {
        active.set(m.id, run.id);
        if (!m.reserved) locks.acquire([m.id], 'raid:' + run.id);
      }
    }
  })();
  const finishedCallbacks = new Map();
  const context = id => contexts.get(id),
    player = id => context(id)?.getPlayer();
  function battleOf(run) {
    return run.combat ? RaidBattle.restore(run.combat, now) : null;
  }
  // No private party state is sent outside a raid. The four selected allies are shared deliberately.
  function preview(r) {
    const key=r.id+':'+r.bossIndex;
    if(previews.has(key))return previews.get(key);
    const d = content.DIFFICULTIES.find(d => d.id === r.difficulty),
      boss = content.bossFor(r);
    const value = {
      id: r.id,
      map: r.map,
      difficulty: d,
      name: d.name,
      level: d.level,
      boss: {
        pokemonId: boss.data.id,
        name: boss.truename || boss.data.name.french,
        level: boss.level,
        types: boss.data.type,
        k: 4,
        corrupted: true
      },
      reward: {
        money: d.reward,
        pearl: d.pearl,
        platesGuaranteed: d.id === 'extreme'
      }
    };
    if(previews.size>10)previews.clear();previews.set(key,value);return value;
  }
  function view(id, run = runs.get(active.get(id)), battle = null) {
    if (!run || !run.members.some(m => m.id === id)) return null;
    const b = battle || battleOf(run);
    return {
      id: run.id,
      phase: run.phase,
      hostId: run.hostId,
      version: run.version,
      rift: preview(run.rift),
      serverNow: now(),
      extraOwner: run.extraOwner,
      members: run.members.map((m, i) => ({
        id: m.id,
        name: m.name,
        ready: m.ready,
        reserved: m.reserved,
        casualties: m.casualties || [],
        quota: quota(run.members.length, i, run.extraOwner),
        selected: m.selected.map(uuid => require('../game/storage/pokemonStorage').view([m.team.pokemons.find(p => p.uuid === uuid)].filter(Boolean), []).team[0]).filter(Boolean),
        online: !!context(m.id)?.socket.connected
      })),
      chat: run.chat || [],
      combat: b ? b.view(id) : null,
      reward: run.members.find(m => m.id === id)?.reward || null,
      won: run.won,
      expiresAt: run.expiresAt,
      needsTutorial: !context(id)?.tutorialSeen
    };
  }
  function emit(run) {
    const battle = battleOf(run);
    for (const m of run.members) {
      const c = context(m.id);
      if (c?.socket.connected) c.socket.emit('raid:state', view(m.id, run, battle));
    }
  }
  function sync(run) {
    for (const m of run.members) {
      const c = context(m.id),
        p = player(m.id);
      if (p && !m.reserved) {
        p.equipe = m.team;
        p.inbattle = run.phase === 'active';
        p.inventoryBusy = ['lobby', 'active'].includes(run.phase);
        p.raidActive = ['lobby', 'active'].includes(run.phase);
        c.socket.emit('teamStateChanged', {
          equipe: p.equipe,
          reason: 'raid'
        });
      }
      if (!['lobby', 'active'].includes(run.phase)) {
        locks.release([m.id], 'raid:' + run.id);
        if (c && p && !m.reserved) {
          p.inbattle = false;
          p.inventoryBusy = false;
          p.raidActive = false;
          if (!finishedCallbacks.has(m.id) || finishedCallbacks.get(m.id) !== run.id) {
            finishedCallbacks.set(m.id, run.id);
            p.inventoryBusy = true;
            const finish = Promise.resolve().then(() => c.afterFinish?.()).catch(e => console.error('Fin de raid :', e.message)).finally(() => {
              p.inventoryBusy = false;
            });
            trackAccountTask(c.socket, finish);
          }
        }
      }
    }
  }
  function serial(fn) {
    const task = queue.then(async () => {
      await ready;
      if (closed) throw Error('Serveur en cours de fermeture.');
      return fn();
    });
    queue = task.catch(() => {});
    return task;
  }
  async function atomic(run, fn) {
    const before = codec.encode(run),
      oldToken = run.combat?.token;
    let battle = battleOf(run),
      committed = false;
    const task = (async () => {
      try {
        await fn(run, battle);
        if (battle) {
          battle.applyModels();
          run.combat = battle.snapshot();
          if (battle.finished) {
            run.phase = battle.won ? 'won' : 'lost';
            run.won = battle.won;
            run.expiresAt = now() + 1800000;
          }
        }
        run.version = await store.save(run, {
          expected: run.version || 0,
          settle: ['won', 'lost'].includes(run.phase),
          partyChanged: oldToken !== run.combat?.token,
          random
        });
        committed = true;
        runs.set(run.id, run);
        sync(run);
        emit(run);
        return run;
      } catch (e) {
        if (!committed) {
          const restored = codec.decode(before);
          runs.set(run.id, restored);
          sync(restored);
        }
        throw e;
      }
    })();
    for (const m of run.members) {
      const c = context(m.id);
      if (c) trackAccountTask(c.socket, task);
    }
    return task;
  }
  function requireRun(id, phase) {
    const r = runs.get(active.get(id));
    if (!r || !r.members.some(m => m.id === id) || phase && r.phase !== phase) fail('Ce raid n’est plus disponible.');
    return r;
  }
  function available(id) {
    const c = context(id),
      p = player(id);
    return c?.socket.connected && c.supported && p && !p.inbattle && !p.inventoryBusy && c.canUse();
  }
  function reset(run) {
    for (const m of run.members) {
      m.ready = false;
      m.selected = [];
    }
    run.extraOwner = 0;
    run.expiresAt = now() + 15 * 60000;
  }
  function near(id, r, distance = 2) {
    const p = player(id);
    const pos=motion.position(r,now());
    return p?.currentmap === r.map && Math.hypot(p.x - pos.x, p.y - pos.y) <= distance * 32;
  }
  async function open(id, riftId) {
    return serial(async () => {
      if (!available(id)) fail('Termine ton action avant d’approcher la faille.');
      const r = world.rifts.find(r => r.id === riftId);
      if (!r || !near(id, r)) fail('Approche-toi de la faille.');
      return {
        preview: preview(r),
        tutorial: !(await store.tutorialSeen(id))
      };
    });
  }
  async function enter(id, riftId) {
    return serial(async () => {
      if (!available(id)) fail('Termine ton action avant de rejoindre un raid.');
      const old = runs.get(active.get(id));
      if (old && ['lobby', 'active'].includes(old.phase)) fail('Tu participes déjà à un raid.');
      const r = world.rifts.find(r => r.id === riftId);
      if (!r || !near(id, r)) fail('Cette faille n’est plus à portée.');
      const c = context(id),
        m = await store.member(id, c.username),
        run = {
          id: randomUUID(),
          rift: {
            ...r
          },
          hostId: id,
          phase: 'lobby',
          members: [m],
          extraOwner: 0,
          chat: [],
          invitations: [],
          version: 0,
          expiresAt: now() + 15 * 60000
        };
      locks.acquire([id], 'raid:' + run.id);
      active.set(id, run.id);
      try {
        await atomic(run, () => {});
      } catch (e) {
        active.delete(id);
        locks.release([id], 'raid:' + run.id);
        throw e;
      }
      return view(id, run);
    });
  }
  function inventory(id) {
    const r = requireRun(id, 'lobby'),
      m = r.members.find(m => m.id === id);
    return require('../game/storage/pokemonStorage').view(m.team.pokemons, []).team;
  }
  async function select(id, data) {
    return serial(async () => {
      const r = requireRun(id, 'lobby');
      if (!Array.isArray(data.uuids) || data.uuids.length > 4 || new Set(data.uuids).size !== data.uuids.length) fail('Composition invalide.');
      const m = r.members.find(m => m.id === id),
        i = r.members.indexOf(m);
      if (m.reserved) fail('Termine ton combat pour préparer l’équipe.');
      const count = quota(r.members.length, i, r.extraOwner);
      if (data.uuids.length > count) fail('Tu peux proposer ' + count + ' Pokémon.');
      if (data.uuids.some(uuid => !m.team.pokemons.some(p => p.uuid === uuid && p.currentHp > 0 && !p.isEgg))) fail('Choisis des Pokémon aptes de ton équipe actuelle.');
      return atomic(r, run => {
        run.members.find(m => m.id === id).selected = [...data.uuids];
        for (const m of run.members) m.ready = false;
        run.expiresAt = now() + 15 * 60000;
      });
    });
  }
  async function extra(id, ownerId) {
    return serial(async () => {
      const r = requireRun(id, 'lobby');
      if (r.hostId !== id || r.members.length !== 3) fail('Le quatrième emplacement est choisi à trois dresseurs.');
      const i = r.members.findIndex(m => m.id === ownerId);
      if (i < 0) fail('Choisis un participant.');
      return atomic(r, run => {
        reset(run);
        run.extraOwner = i;
      });
    });
  }
  async function readyPlayer(id) {
    return serial(async () => {
      const r = requireRun(id, 'lobby'),
        m = r.members.find(m => m.id === id),
        i = r.members.indexOf(m);
      if (m.reserved || m.selected.length !== quota(r.members.length, i, r.extraOwner)) fail('Complète les emplacements qui te sont attribués.');
      return atomic(r, run => {
        run.members.find(m => m.id === id).ready = true;
      });
    });
  }
  async function start(id) {
    return serial(async () => {
      const r = requireRun(id, 'lobby');
      if (r.hostId !== id) fail('Seul l’organisateur peut lancer le raid.');
      if (r.members.some((m, i) => m.reserved || !m.ready || m.selected.length !== quota(r.members.length, i, r.extraOwner))) fail('Tous les dresseurs doivent être prêts.');
      const selected = r.members.flatMap(m => m.selected.map(uuid => ({
        ownerId: m.id,
        ownerName: m.name,
        pokemon: m.team.pokemons.find(p => p.uuid === uuid)
      })));
      if (selected.length !== 4) fail('Il faut exactement quatre Pokémon.');
      if (selected.filter(v => v.pokemon.corruption?.permanent).length > 1) fail('Un seul Pokémon corrompu peut participer dans l’équipe du raid.');
      return atomic(r, run => {
        const d = content.DIFFICULTIES.find(d => d.id === r.rift.difficulty),
          b = new RaidBattle(selected, content.bossFor(r.rift), {
            now,
            hpMultiplier: d.hp
          });
        run.phase = 'active';
        run.combat = b.snapshot();
      });
    });
  }
  async function action(id, data) {
    return serial(async () => {
      const r = requireRun(id, 'active');
      return atomic(r, (_run, b) => {
        b.action(id, data);
      });
    });
  }
  async function chat(id, text) {
    return serial(async () => {
      const r = requireRun(id);
      if (!['lobby', 'active'].includes(r.phase)) fail('Ce raid est terminé.');
      text = String(text || '').trim();
      if (!text || text.length > 240) fail('Écris un message de 1 à 240 caractères.');
      const last = r.chat.at(-1);
      if (last?.userId === id && now() - last.at < 700) fail('Patiente un instant.');
      return atomic(r, run => {
        run.chat.push({
          id: randomUUID(),
          userId: id,
          name: context(id).username,
          text,
          at: now()
        });
        run.chat = run.chat.slice(-40);
      });
    });
  }
  async function leave(id) {
    return serial(async () => {
      const r = requireRun(id);
      if (r.phase === 'active') fail('Retire tes Pokémon depuis les commandes du raid.');
      if (r.phase !== 'lobby') {
        active.delete(id);
        context(id)?.socket.emit('raid:state', null);
        return;
      }
      const m = r.members.find(m => m.id === id);
      await atomic(r, run => {
        run.members = run.members.filter(m => m.id !== id);
        run.phase = run.members.length ? 'lobby' : 'closed';
        if (run.hostId === id) run.hostId = run.members[0]?.id || null;
        reset(run);
      });
      locks.release([id], 'raid:' + r.id);
      active.delete(id);
      const p = player(id);
      if (p && !m.reserved) {
        p.inventoryBusy = false;
        p.raidActive = false;
      }
      context(id)?.socket.emit('raid:state', null);
      return m;
    });
  }
  async function remove(id, target) {
    return serial(async () => {
      const r = requireRun(id, 'lobby');
      if (r.hostId !== id || target === id) fail('Action réservée à l’organisateur.');
      const m = r.members.find(m => m.id === target);
      if (!m) fail('Participant introuvable.');
      await atomic(r, run => {
        run.members = run.members.filter(m => m.id !== target);
        reset(run);
      });
      locks.release([target], 'raid:' + r.id);
      active.delete(target);
      const p = player(target);
      if (p && !m.reserved) {
        p.inventoryBusy = false;
        p.raidActive = false;
      }
      context(target)?.socket.emit('raid:state', null);
    });
  }
  async function invite(id, target) {
    return serial(async () => {
      const r = requireRun(id, 'lobby');
      if (r.members.length >= 4) fail('Le raid est complet.');
      if (!Number.isInteger(target) || target === id) fail('Choisis un ami.');
      const c = context(target);
      if (!c?.socket.connected || !c.supported) fail('Ton ami doit être connecté avec la version actuelle du jeu.');
      if ((await require('../persistence/trainerRepository').relationship(id, target)) !== 'friends') fail('Ce dresseur ne fait pas partie de tes amis.');
      if (!(await require('../persistence/darkContinentRepository').loadState(target)).owned) fail('Ton ami doit posséder la Carte du Dresseur Professionnel.');
      if (r.invitations.some(v => v.target === target && v.expiresAt > now() && v.status === 'pending')) fail('Une invitation est déjà en cours.');
      const invitation = {
        id: randomUUID(),
        target,
        sender: id,
        senderName: context(id).username,
        raidId: r.id,
        expiresAt: now() + 60000,
        status: 'pending',
        rift: preview(r.rift)
      };
      await atomic(r, run => {
        run.invitations.push(invitation);
        run.invitations = run.invitations.slice(-20);
      });
      c.socket.emit('raid:invitation', invitation);
      return invitation;
    });
  }
  async function accept(id, invitationId, accept) {
    return serial(async () => {
      let r, inv;
      for (const candidate of runs.values()) {
        const v = candidate.invitations?.find(v => v.id === invitationId && v.target === id && v.status === 'pending');
        if (v) {
          r = candidate;
          inv = v;
          break;
        }
      }
      if (!inv || inv.expiresAt <= now() || r.phase !== 'lobby') fail('Cette invitation a expiré.');
      if (!accept) {
        await atomic(r, () => {
          inv.status = 'declined';
        });
        context(id)?.socket.emit('raid:invitation', null);
        return;
      }
      const previous = runs.get(active.get(id));
      if (previous && ['lobby', 'active'].includes(previous.phase)) fail('Tu participes déjà à un autre raid.');
      if (r.members.length >= 4) fail('Le raid est complet.');
      if (!(await require('../persistence/darkContinentRepository').loadState(id)).owned) fail('La Carte du Dresseur Professionnel est nécessaire pour rejoindre ce raid.');
      const m = {
        id,
        name: context(id).username,
        reserved: true,
        selected: [],
        ready: false
      };
      await atomic(r, run => {
        inv.status = 'accepted';
        run.members.push(m);
        reset(run);
      });
      active.set(id, r.id);
      context(id)?.socket.emit('raid:invitation', null);
      await joinReserved(r, m);
      return view(id, r);
    });
  }
  async function joinReserved(r, m) {
    if (!available(m.id)) return;
    const c = context(m.id);
    if (r.phase !== 'lobby') return;
    const terrain = require('../game/world/mapRepository'),
      grid = terrain.loadCollisionData(r.rift.map),
      change = terrain.changeMapData(r.rift.map);
    let destination;
    const x = Math.floor(r.rift.x / 32),
      y = Math.floor(r.rift.y / 32);
    for (let radius = 1; radius <= 4 && !destination; radius++) for (let dx = -radius; dx <= radius; dx++) for (const dy of [-radius, radius]) if (grid[y + dy]?.[x + dx] === 0 && !change[y + dy]?.[x + dx] && !content.blockedByNpc(r.rift.map,x+dx,y+dy) && ![...contexts.values()].some(c => {
      const p = c.getPlayer();
      return p?.currentmap === r.rift.map && Math.floor(p.x / 32) === x + dx && Math.floor(p.y / 32) === y + dy;
    })) destination = {
      map: r.rift.map,
      x: (x + dx) * 32 + 16,
      y: (y + dy) * 32 + 16
    };
    if (!destination) fail('Aucune place sûre près de la faille.');
    const p = player(m.id);
    p.inventoryBusy = true;
    try {
      await c.travel(destination);
      const full = await store.member(m.id, c.username);
      locks.acquire([m.id], 'raid:' + r.id);
      await atomic(r, run => {
        Object.assign(run.members.find(v => v.id === m.id), full, {
          reserved: false
        });
        reset(run);
      });
    } catch (e) {
      p.inventoryBusy = false;
      throw e;
    }
  }
  async function attach(c) {
    await ready;
    c.tutorialSeen = await store.tutorialSeen(c.id);
    contexts.set(c.id, c);
    const run = runs.get(active.get(c.id));
    if (run) {
      const m = run.members.find(m => m.id === c.id);
      if (!m.reserved) {
        locks.acquire([c.id], 'raid:' + run.id);
        sync(run);
      }
      c.socket.emit('raid:state', view(c.id, run));
    }
    for (const r of runs.values()) for (const inv of r.invitations || []) if (inv.target === c.id && inv.status === 'pending' && inv.expiresAt > now()) c.socket.emit('raid:invitation', inv);
    sendWorld(c);
  }
  function sendWorld(c) {
    const p = c.getPlayer();
    c.lastRaidMap = p?.currentmap;
    c.socket.emit('raid:world', {
      map: p?.currentmap,
      day: world.day,
      renewsAt: world.renewsAt,
      serverNow: now(),
      rifts: world.rifts.filter(r => r.map === p?.currentmap).map(r => ({
        ...r,
        scale: content.DIFFICULTIES.find(d => d.id === r.difficulty).scale,
        level: content.DIFFICULTIES.find(d => d.id === r.difficulty).level
      }))
    });
  }
  function nearby(id) {
    return world?.rifts.find(r => near(id, r, 1.8)) || null;
  }
  async function tick() {
    if (ticking || closed) return;
    ticking = true;
    try {
      await serial(async () => {
        if (world.day !== content.dayKey(now())) {
          world = (await store.world(content.dayKey(now()))) || content.createDay(now());
          await store.saveWorld(world);
        }
        let moved = false;
        const nearbyPlayers=[...contexts.values()].filter(c=>c.socket.connected).map(c=>c.getPlayer()).filter(Boolean);
        const choices=(map,x,y)=>{
          const terrain=require('../game/world/mapRepository'),grid=terrain.loadCollisionData(map),change=terrain.changeMapData(map);
          return [[1,0],[-1,0],[0,1],[0,-1]].map(([dx,dy])=>({x:x+dx,y:y+dy})).filter(p=>grid[p.y]?.[p.x]===0&&!change[p.y]?.[p.x]&&!content.blockedByNpc(map,p.x,p.y)).map(p=>({x:p.x*32+16,y:p.y*32+16}));
        };
        for(const r of world.rifts)if(motion.step(r,now(),nearbyPlayers,choices,randomInt))moved=true;
        if (moved) await store.saveWorld(world);
        for (const c of contexts.values()) if (c.socket.connected && (moved || c.lastRaidMap !== c.getPlayer()?.currentmap)) sendWorld(c);
        for (const r of [...runs.values()]) {
          if (r.phase === 'active') {
            if (now() >= r.combat.deadline) await atomic(r, (_run, battle) => {
              battle.tick();
            });
          } else if (r.phase === 'lobby') {
            for (const m of r.members.filter(m => m.reserved)) await joinReserved(r, m);
            if (r.expiresAt <= now() || r.rift.id.split(':')[0] !== world.day) {
              await atomic(r, run => {
                run.phase = 'closed';
              });
              for (const m of r.members) active.delete(m.id);
            }
          } else if (r.expiresAt <= now()) {
            runs.delete(r.id);
            for (const m of r.members) if (active.get(m.id) === r.id) active.delete(m.id);
          }
        }
      });
    } catch (e) {
      console.error('Raids :', e.message);
    } finally {
      ticking = false;
    }
  }
  const timer = tickMs ? setInterval(() => void tick(), tickMs) : null;
  timer?.unref();
  return {
    ready,
    attach,
    async tutorial(id) {
      await store.acknowledgeTutorial(id);
      if (context(id)) context(id).tutorialSeen = true;
    },
    view,
    preview,
    open,
    enter,
    inventory,
    select,
    extra,
    readyPlayer,
    start,
    action,
    chat,
    leave,
    remove,
    invite,
    accept,
    nearby,
    sendWorld,
    tick,
    contexts,
    runs,
    world: () => world,
    detach(c) {
      if (context(c.id) === c) contexts.delete(c.id);
    },
    async stop() {
      closed = true;
      if (timer) clearInterval(timer);
      await queue;
      for (const r of runs.values()) for (const m of r.members) locks.release([m.id], 'raid:' + r.id);
      contexts.clear();
    }
  };
}
function getRaidManager(io) {
  const root = io.server || io;
  if (!managers.has(root)) {
    const m = createRaidManager();
    managers.set(root, m);
    root.httpServer?.once('close', () => void m.stop());
  }
  return managers.get(root);
}
module.exports = {
  createRaidManager,
  getRaidManager,
  quota
};
