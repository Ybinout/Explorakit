const { calculateBattleExperience, reduceActiveOverlevelExperience } = require('../models/progression');
const { adventureReserveShare } = require('../../../data/game/experience_balance.json');
const { grantParticipantEffort, rewardTraining } = require('../models/training');

class AdventureExperience {
    constructor({expShare = false} = {}) { this.participants = new Map(); this.rewarded = new Set(); this.effortRewarded = new Set(); this.expShare = expShare; }
    enter(pokemon, opponent) {
        if (!(pokemon?.currentHp > 0) || !(opponent?.currentHp > 0) || pokemon.isEgg) return;
        if (!this.participants.has(opponent)) this.participants.set(opponent, new Set());
        this.participants.get(opponent).add(pokemon.uuid);
    }
    rewardEffort(player, opponent) {
        if (this.effortRewarded.has(opponent)) return new Map();
        this.effortRewarded.add(opponent);
        return grantParticipantEffort(player.equipe.pokemons, opponent, this.participants.get(opponent));
    }
    reward(player, defeated, multiplier, io, { grantExperience = true, captured = false } = {}) {
        if ((defeated.currentHp > 0 && captured !== true) || this.rewarded.has(defeated)) return [];
        this.rewarded.add(defeated);
        const team = player.equipe.pokemons, participants = this.participants.get(defeated) || new Set();
        const expShare = this.expShare === 'equipped' ? require('../items/expShare').hasEquippedExpShare(team) : this.expShare;
        const eligible = team.filter(p => p.uuid !== defeated.uuid && (expShare ? participants.size > 0 : participants.has(p.uuid)) && p.currentHp > 0 && !p.isEgg);
        // Calculate every share before levelling anyone. Each recipient retains
        // its level scaling/overlevel penalty; untouched reserves get nothing.
        const awards = (grantExperience ? eligible : []).map(pokemon => {
            const xp = Math.max(1, Math.floor(calculateBattleExperience(defeated, multiplier, pokemon)
                * (expShare ? (pokemon === team[0] ? 1 : adventureReserveShare) : 1 / eligible.length)));
            return { pokemon, xp: pokemon === team[0] ? reduceActiveOverlevelExperience(xp, defeated, pokemon) : xp };
        });
        const effort = this.rewardEffort(player, defeated);
        for (const {pokemon, xp} of awards) rewardTraining(pokemon, defeated, xp, io, player.id,
            { effortGained: effort.get(pokemon.uuid) || {} });
        return awards;
    }
}
module.exports = { AdventureExperience };
