// House-only adaptations of three benchmark archetypes. These are temporary
// opponents, built through the normal stat, corruption and recovery systems.
const Pokemon = require('../models/Pokemon');
const {getTotalExperienceForLevel, getExperienceRate} = require('../models/progression');
const {healTeam} = require('../world/playerRecovery');
const corruption = require('../corruption/pokemon');
const modules = require('../corruption/modules');
const dex = require('../../../data/game/pokedex.json');
const perfectIVs = Object.fromEntries(['hp', 'attack', 'defense', 'specialAttack', 'specialDefense', 'speed'].map(stat => [stat, 31]));

const teams = [
    {
        key: 'practice_spectral_rush', name: 'Pression spectrale', role: 'Offensive rapide', portrait: 'nrv-noz-v1.png',
        members: [
            {id: 94, nature: 'Timid', ability: 'Cursed Body', item: 'death_orb', module: 'cmod_offense_ghost', ev: {hp: 4, specialAttack: 252, speed: 252}, moves: ['Shadow Ball', 'Sludge Bomb', 'Focus Blast', 'Taunt']},
            {id: 142, nature: 'Jolly', ability: 'Pressure', item: 'focus_sash', ev: {hp: 4, attack: 252, speed: 252}, moves: ['Stealth Rock', 'Taunt', 'Stone Edge', 'Earthquake']},
            {id: 212, nature: 'Adamant', ability: 'Technician', item: 'choice_band', ev: {hp: 248, attack: 252, specialDefense: 8}, moves: ['Bullet Punch', 'U-turn', 'Superpower', 'Knock Off']},
            {id: 149, nature: 'Adamant', ability: 'Multiscale', item: 'heavy_duty_boots', ev: {hp: 4, attack: 252, speed: 252}, moves: ['Dragon Dance', 'Dragon Claw', 'Extreme Speed', 'Fire Punch']},
            {id: 121, nature: 'Timid', ability: 'Natural Cure', item: 'life_orb', ev: {hp: 4, specialAttack: 252, speed: 252}, moves: ['Scald', 'Psyshock', 'Ice Beam', 'Rapid Spin']},
            {id: 392, nature: 'Jolly', ability: 'Iron Fist', item: 'choice_scarf', ev: {hp: 4, attack: 252, speed: 252}, moves: ['Close Combat', 'Flare Blitz', 'U-turn', 'Mach Punch']}
        ]
    },
    {
        key: 'practice_rain_current', name: 'Courant spectral', role: 'Équipe pluie', portrait: 'nrv-cry-v1.png',
        members: [
            {id: 94, nature: 'Timid', ability: 'Cursed Body', item: 'death_orb', module: 'cmod_defense_ground', ev: {hp: 4, specialAttack: 252, speed: 252}, moves: ['Shadow Ball', 'Sludge Bomb', 'Thunder', 'Giga Drain']},
            {id: 186, nature: 'Calm', ability: 'Drizzle', item: 'damp_rock', ev: {hp: 252, defense: 4, specialDefense: 252}, moves: ['Scald', 'Encore', 'Toxic', 'Protect']},
            {id: 230, nature: 'Modest', ability: 'Swift Swim', item: 'choice_specs', ev: {hp: 4, specialAttack: 252, speed: 252}, moves: ['Surf', 'Draco Meteor', 'Ice Beam', 'Dragon Pulse']},
            {id: 272, nature: 'Modest', ability: 'Swift Swim', item: 'life_orb', ev: {hp: 4, specialAttack: 252, speed: 252}, moves: ['Hydro Pump', 'Giga Drain', 'Ice Beam', 'Focus Blast']},
            {id: 260, nature: 'Relaxed', ability: 'Torrent', item: 'leftovers', ev: {hp: 252, defense: 252, specialDefense: 4}, moves: ['Stealth Rock', 'Earthquake', 'Waterfall', 'Roar']},
            {id: 212, nature: 'Adamant', ability: 'Technician', item: 'choice_band', ev: {hp: 248, attack: 252, specialDefense: 8}, moves: ['Bullet Punch', 'U-turn', 'Superpower', 'Knock Off']}
        ]
    },
    {
        key: 'practice_sand_balance', name: 'Rempart spectral', role: 'Équilibre défensif', portrait: 'nrv-tom-v1.png',
        members: [
            {id: 94, nature: 'Timid', ability: 'Cursed Body', item: 'corrupted_leftovers', module: 'cmod_defense_dark', ev: {hp: 4, specialAttack: 252, speed: 252}, moves: ['Shadow Ball', 'Sludge Bomb', 'Will-O-Wisp', 'Pain Split']},
            {id: 450, nature: 'Impish', ability: 'Sand Stream', item: 'rocky_helmet', ev: {hp: 252, defense: 252, specialDefense: 4}, moves: ['Stealth Rock', 'Earthquake', 'Slack Off', 'Whirlwind']},
            {id: 227, nature: 'Impish', ability: 'Sturdy', item: 'heavy_duty_boots', ev: {hp: 252, defense: 252, specialDefense: 4}, moves: ['Spikes', 'Roost', 'Whirlwind', 'Brave Bird']},
            {id: 423, nature: 'Calm', ability: 'Storm Drain', item: 'expert_belt', ev: {hp: 252, defense: 4, specialDefense: 252}, moves: ['Scald', 'Earth Power', 'Ice Beam', 'Recover']},
            {id: 36, nature: 'Calm', ability: 'Unaware', item: 'leftovers', ev: {hp: 252, defense: 4, specialDefense: 252}, moves: ['Moonblast', 'Soft-Boiled', 'Heal Bell', 'Thunder Wave']},
            {id: 212, nature: 'Adamant', ability: 'Technician', item: 'choice_band', ev: {hp: 248, attack: 252, specialDefense: 8}, moves: ['Bullet Punch', 'U-turn', 'Superpower', 'Knock Off']}
        ]
    }
].concat(require('./corruptedPracticeSets'));

function list() {
    return teams.map(({key, name, role, portrait, members}) => ({key, name, role, portrait, music: 'trainer', species: members.map(member => member.id)}));
}

function create(key, playerTeam, level) {
    const entry = teams.find(team => team.key === key);
    if (!entry) return null;
    const pokemons = playerTeam.map((own, slot) => {
        const set = entry.members[slot], species = dex.find(p => p.id === set.id), target = level || Math.max(1, own.level);
        const p = new Pokemon(set.id, null, null, getTotalExperienceForLevel(target, getExperienceRate(species.exp)), {...perfectIVs,...set.iv}, set.nature, 4, {...set.ev});
        for (const move of set.moves) p.addAbility(move);
        p.passiveAbility = set.ability;
        p.heldItem = set.item;
        if (set.module) corruption.install(p, modules.get(set.module), {expectedRevision: 0});
        for (const key of set.modules || []) corruption.install(p, modules.get(key), {expectedRevision:p.corruption?.revision || 0,slot:3,expectedMoves:[...p.abilities]});
        return p;
    });
    const team = {pokemons};
    healTeam(team);
    return require('./openingLead').openingLead(team, playerTeam, entry.lead);
}

module.exports = {list, create};
