// Reproducible, actual native raid turns: no substitute damage formula.
const {
  RaidBattle
} = require('../server/game/raids/RaidBattle');
const {
  DIFFICULTIES,
  bossFor,
  SETS
} = require('../server/game/raids/content');
const factory = require('../server/game/drift/pokemonFactory');
function make(id, level, k, moves, ability, offense = false) {
  const p = factory.create(id, level, true);
  p.k = k;
  p.iv = {
    hp: 31,
    attack: 31,
    defense: 31,
    specialAttack: 31,
    specialDefense: 31,
    speed: 31
  };
  p.ev = {
    hp: 252,
    attack: 0,
    defense: offense ? 0 : 252,
    specialAttack: offense ? 252 : 0,
    specialDefense: 6,
    speed: 0
  };
  p.nature = offense ? 'Modest' : 'Bold';
  p.passiveAbility = ability;
  p.abilities = [];
  p.movePp = [];
  for (const name of moves) p.addAbility(name);
  p.heldItem = 'leftovers';
  p.corruption = null;
  p.recalculateStats();
  p.currentHp = p.maxHp;
  return p;
}
function team(level, k, prepared, bossIndex) {
  const strong = bossIndex === 2 ? [9, 'Torrent', 'Hydro Pump'] : bossIndex === 1 ? [448, 'Inner Focus', 'Aura Sphere'] : bossIndex === 3 ? [9, 'Torrent', 'Hydro Pump'] : bossIndex === 4 ? [282, 'Trace', 'Moonblast'] : [65, 'Magic Guard', 'Psychic'];
  return prepared ? [make(36, level, k, ['Follow Me', 'Moonlight', 'Protect', 'Moonblast'], 'Magic Guard'), make(242, level, k, ['Heal Pulse', 'Wish', 'Protect', 'Ice Beam'], 'Natural Cure'), ...Array.from({
    length: 2
  }, () => make(strong[0], level, k, [strong[2], 'Protect', 'Helping Hand', 'Rest'], strong[1], true))] : Array.from({
    length: 4
  }, () => make(9, level, k, ['Hydro Pump', 'Protect', 'Helping Hand', 'Ice Beam'], 'Torrent', true));
}
function simulate(d, {
  seed = 1,
  k = 4,
  prepared = true,
  members = 1,
  bossIndex = 0,
  hp = d.hp
} = {}) {
  let time = 0;
  const allies = team(d.level, k, prepared, bossIndex).map((pokemon, i) => ({
      ownerId: i % members + 1,
      ownerName: 'Test ' + (i % members + 1),
      pokemon
    })),
    b = new RaidBattle(allies, bossFor({
      difficulty: d.id,
      bossIndex
    }), {
      seed: [seed, 17, 29, 43],
      hpMultiplier: hp,
      now: () => time
    });
  let rounds = 0,
    shields = 0,
    saves = 0;
  while (!b.finished && rounds++ < 50) {
    const state = b.view(1),
      roundToken = b.token;
    const living = state.allies.filter(p => p.currentHp > 0 && !p.withdrawn),
      hurt = [...living].sort((a, b) => a.currentHp / a.maxHp - b.currentHp / b.maxHp)[0];
    const choices = state.allies.map((p, slot) => {
      if (!p.currentHp || p.withdrawn) return null;
      const moves = b.moves(slot);
      let index = 0,
        targetLoc = 1;
      if (prepared && slot === 0) {
        index = p.currentHp < p.maxHp * .63 ? 1 : 0;
        targetLoc = undefined;
      } else if (prepared && slot === 1) {
        if (hurt && hurt.uuid !== p.uuid && hurt.currentHp / hurt.maxHp < .8) {
          index = 0;
          targetLoc = -(state.allies.indexOf(hurt) + 1);
        } else {
          index = p.currentHp / p.maxHp < .55 ? 1 : 3;
          targetLoc = index === 1 ? undefined : 1;
        }
      } else if (prepared && p.currentHp / p.maxHp < .5) {
        index = 3;
        targetLoc = undefined;
      }
      const selected = moves[index];
      if (!selected || selected.disabled || !selected.pp && selected.id !== 'struggle') {
        const valid = moves.find(m => !m.disabled && (m.pp > 0 || m.id === 'struggle'));
        if (!valid) return {
          slot,
          action: 'retreat',
          confirm: true,
          token: roundToken
        };
        index = valid.index;
        targetLoc = valid.targets[0]?.loc;
      }
      return {
        slot,
        action: 'attack',
        moveIndex: index,
        targetLoc,
        token: roundToken
      };
    });
    for (const choice of choices.filter(Boolean)) {
      try {
        b.action(allies[choice.slot].ownerId, choice);
      } catch (error) {
        error.message += JSON.stringify({
          difficulty: d.id,
          k,
          prepared,
          bossIndex,
          rounds,
          choice,
          moves: b.moves(choice.slot)
        });
        throw error;
      }
    }
    shields += b.events.filter(e => e.kind === 'shield').length;
    saves += b.events.filter(e => e.kind === 'friendship').length;
    time += 1000;
    b.applyModels();
  }
  return {
    won: b.won,
    rounds: Math.min(rounds, 50),
    remaining: b.sim.sides[0].pokemon.filter(p => p.hp > 0).length,
    shields,
    saves,
    bossRemaining: b.bossPokemon.hp / b.bossPokemon.maxhp
  };
}
if (require.main === module) {
  const rows = [];
  for (const d of DIFFICULTIES) for (const prepared of [false, true]) for (const k of [2, 4]) {
    const outcomes = [];
    for (let seed = 1; seed <= 8; seed++) for (let bossIndex = 0; bossIndex < SETS.length; bossIndex++) outcomes.push(simulate(d, {
      seed,
      k,
      prepared,
      bossIndex,
      members: seed % 4 + 1
    }));
    rows.push({
      difficulty: d.id,
      hp: d.hp,
      k,
      prepared,
      runs: outcomes.length,
      wins: outcomes.filter(x => x.won).length,
      medianTurns: outcomes.map(x => x.rounds).sort((a, b) => a - b)[Math.floor(outcomes.length / 2)],
      meanBossHp: Math.round(outcomes.reduce((s, x) => s + x.bossRemaining, 0) / outcomes.length * 100)
    });
  }
  console.log(JSON.stringify({
    engine: '@pkmn/sim 0.10.15 + RiftMon Raid',
    date: new Date().toISOString(),
    note: 'Equal levels, IV31/EV510, real priority/speed, two boss actions, shields and classic support. Samples are deterministic; no exhaustive balance claim.',
    rows
  }, null, 2));
}
module.exports = {
  simulate,
  make,
  team
};
