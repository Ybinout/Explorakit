const { generationStandard } = require('../battle/twoTurnMoves');
const engine = require('../battle/battleEngine');
const { getMoveFlags } = require('../abilities/abilityEngine');
const { chooseSpeciesAbility, createDeterministicRandom, getSpeciesAbilitySlots } = require('../abilities/abilityDex');
const { getItemDefinition } = require('../battle/battleResources');
const dex = new Map(require('../../../data/game/pokedex.json').map(p => [p.id, p]));
const learnsets = require('../../../data/game/pokemonData.json');
const moves = require('../../../data/game/moves.json');
const traits = require('../../../data/game/ability_move_traits.gen7.json').moves;
const evolvable = new Set(require('../../../data/game/stone_evolutions.json').evolvable);
const cache = new Map();
const slug = name => name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
// These moves need conditions the planner does not yet model. Do not equip a
// powerful-looking move that cannot actually be used in the intended role.
const conditional = new Set(['Snore', 'Fake Out', 'Last Resort', 'Dream Eater', 'Rollout', 'Ice Ball', 'Fury Cutter', 'Belch', 'Focus Punch', 'Sucker Punch', 'Synchronoise']);
const physical = move => move.combat?.damage_class === 'physical';

function itemFor(species, selected, ability, wave, index) {
    const base = species.base, supports = selected.some(m => m.combat.damage_class === 'status');
    const damage = selected.filter(m => m.power > 0);
    const physicalCount = damage.filter(physical).length, specialCount = damage.length - physicalCount;
    const bulky = base.HP + base.Defense + base['Sp. Defense'] >= 260;
    const heal = selected.some(m => m.combat.effects.some(e => e.kind === 'heal'));
    const coverage = new Set(damage.map(m => m.type)).size;
    if (wave <= 2) return ['oran_berry', 'Endurance', 'Récupère des PV pour prolonger les premiers échanges.'];
    if (evolvable.has(species.id) && (base.Speed < 80 || bulky))
        return ['eviolite', 'Résistance', 'Renforce les deux défenses de cette espèce encore capable d’évoluer.'];
    if (wave >= 6 && ['Magic Guard', 'Sheer Force'].includes(ability))
        return ['life_orb', 'Pression offensive', 'Renforce les dégâts et profite de son talent offensif ou protecteur.'];
    if (supports) return heal || bulky
        ? ['leftovers', 'Soutien durable', 'Régénération régulière pour accompagner les soins ou la préparation.']
        : ['sitrus_berry', 'Préparation', 'Une réserve de PV pour placer une capacité de soutien.'];
    if (wave >= 11 && base.Speed >= 60 && base.Speed < 100 && index % 3 === 2 && Math.max(physicalCount, specialCount) >= 3)
        return ['choice_scarf', 'Revanche rapide', 'Gagne en vitesse, mais reste verrouillé sur son attaque.'];
    if (wave >= 6 && !bulky && index % 2 === 0 && physicalCount >= 3)
        return ['choice_band', 'Attaquant physique', 'Renforce ses attaques physiques, avec un verrou d’attaque.'];
    if (wave >= 6 && !bulky && index % 2 === 0 && specialCount >= 3)
        return ['choice_specs', 'Attaquant spécial', 'Renforce ses attaques spéciales, avec un verrou d’attaque.'];
    if (wave >= 6 && bulky && base.Defense >= 100 && index % 2 === 1)
        return ['rocky_helmet', 'Mur physique', 'Punit les attaques de contact reçues.'];
    if (wave >= 6 && bulky)
        return ['assault_vest', 'Résistance spéciale', 'Renforce la défense spéciale ; ses quatre capacités sont offensives.'];
    if (wave >= 6 && base.Speed >= 100 && !bulky)
        return ['focus_sash', 'Dernière chance', 'Peut survivre à un coup fatal lorsque ses PV sont pleins.'];
    if (coverage >= 3) return ['expert_belt', 'Couverture', 'Récompense son choix d’attaques super efficaces de types variés.'];
    return ['sitrus_berry', 'Endurance', 'Récupère des PV quand le combat se prolonge.'];
}

function plan(id, wave, index, tactic = null) {
    const key = `${id}:${wave}:${index}:${tactic?.key || 'legacy'}`;
    if (cache.has(key)) return cache.get(key);
    const species = dex.get(id), base = species.base, legal = new Set(learnsets[id] || []);
    let ability = chooseSpeciesAbility(id, createDeterministicRandom(`colosseum:${wave}:${index}`), 0);
    if (tactic?.abilities.length) ability = tactic.abilities.find(name=>getSpeciesAbilitySlots(id).some(a=>a.name===name&&!a.hidden&&!a.special)) || ability;
    if (ability === 'Klutz') ability = getSpeciesAbilitySlots(id).find(a => !a.hidden && !a.special && a.name !== 'Klutz')?.name || ability;
    const available = moves.filter(m => legal.has(slug(m.ename))).map(m => engine.getMoveByName(m.ename));
    const cap = wave <= 5 ? 60 : wave <= 10 ? 80 : wave <= 15 ? 100 : 120;
    const attacks = available.filter(m => m.power > 0 && m.power <= cap && generationStandard(m)
        && !traits[m.ename]?.multihit && !conditional.has(m.ename) && !getMoveFlags(m).selfdestruct
        && !getMoveFlags(m).charge && !getMoveFlags(m).recharge
        && !traits[m.ename]?.charge && !traits[m.ename]?.recharge
        && !['Future Sight', 'Doom Desire', 'Fly', 'Dig', 'Dive', 'Bounce', 'Sky Attack', 'Solar Beam', 'Solar Blade', 'Skull Bash', 'Razor Wind', 'Phantom Force'].includes(m.ename));
    const selected = [];
    const effectiveAttack=base.Attack*(tactic&&['Huge Power','Pure Power'].includes(ability)?2:1);
    const preferredClass = effectiveAttack >= base['Sp. Attack'] ? 'physical' : 'special';
    const score = m => m.power * (Number(m.accuracy) || 100) / 100
        * (physical(m) ? effectiveAttack : base['Sp. Attack'])
        * (species.type.includes(m.type) ? 1.5 : 1)
        * (selected.some(other => other.type === m.type) ? .35 : 1)
        * (m.combat.damage_class === preferredClass ? 1 : .65)
        * (tactic?.attacks.includes(m.ename) ? 1.9 : 1);
    while (selected.length < 4) {
        const next = attacks.filter(m => !selected.includes(m)).sort((a,b) => score(b)-score(a) || a.id-b.id)[0];
        if (!next) break;
        selected.push(next);
    }
    if (!selected.length) throw Error(`No supported offensive Colosseum set for ${id}`);
    if (tactic) {
        const preferred=tactic.support.filter(name=>!(['Swords Dance','Dragon Dance','Bulk Up'].includes(name)&&preferredClass!=='physical')&&!(['Calm Mind','Nasty Plot'].includes(name)&&preferredClass!=='special'));
        const support=preferred.map(name=>available.find(m=>m.ename===name)).find(Boolean);
        if(support) {selected.length=Math.min(3,selected.length);selected.push(support);}
    } else if (wave >= 11) {
        const boosts = preferredClass === 'physical' ? ['Dragon Dance', 'Swords Dance', 'Bulk Up'] : ['Calm Mind', 'Nasty Plot'];
        const groups = [['Recover', 'Roost', 'Synthesis', 'Slack Off', 'Soft-Boiled'], boosts, ['Will-O-Wisp', 'Thunder Wave', 'Toxic']];
        // Give each team complementary jobs. An attacker without a suitable
        // recovery/setup move keeps coverage rather than inheriting generic Toxic.
        const support = groups[index % 3].map(name => available.find(m => m.ename === name)).find(Boolean);
        if (support) { selected.length = Math.min(3, selected.length); selected.push(support); }
    }
    const [item, role, reason] = itemFor(species, selected, ability, wave, index);
    const result = Object.freeze({ ability, moves: Object.freeze(selected.map(m => m.ename)), item, role, reason });
    if (cache.size >= 512) cache.delete(cache.keys().next().value);
    cache.set(key, result);
    return result;
}

function prepare(pokemon, wave, index, tactic = null) {
    const set = plan(pokemon.data.id, wave, index, tactic);
    pokemon.passiveAbility = set.ability;
    pokemon.gender = require('../items/stoneEvolution').gender({ data: pokemon.data, uuid: `colosseum:${wave}:${index}:${pokemon.data.id}` });
    pokemon.heldItem = set.item;
    pokemon.abilities = []; pokemon.movePp = [];
    set.moves.forEach(name => pokemon.addAbility(name));
}
function preview(id, wave, index, tactic = null) {
    const set = plan(id, wave, index, tactic), item = getItemDefinition(set.item);
    return { heldItem: set.item, itemName: item.name, itemDescription: item.description, role: set.role, itemReason: set.reason, ...(tactic ? {tacticalRole:tactic.role,moves:[...set.moves],moveNames:set.moves.map(name=>moves.find(m=>m.ename===name)?.fname || name)} : {}) };
}
module.exports = { prepare, preview, plan };
