const { calculateBattleExperience } = require('../models/progression');
const { grantEffort, rewardTraining } = require('../models/training');

class AdventureExperience {
    constructor() { this.participants = new Map(); this.rewarded = new Set(); }
    enter(pokemon, opponent) {
        if (!(pokemon?.currentHp > 0) || !(opponent?.currentHp > 0) || pokemon.isEgg) return;
        if (!this.participants.has(opponent)) this.participants.set(opponent, new Set());
        this.participants.get(opponent).add(pokemon.uuid);
    }
    reward(player, defeated, multiplier, io) {
        if (defeated.currentHp > 0 || this.rewarded.has(defeated)) return [];
        this.rewarded.add(defeated);
        const team = player.equipe.pokemons, participants = this.participants.get(defeated) || new Set();
        const eligible = team.filter(p => participants.has(p.uuid) && p.currentHp > 0 && !p.isEgg);
        // Calculate every share before levelling anyone. Each recipient retains
        // its level scaling/overlevel penalty; untouched reserves get nothing.
        const awards = eligible.map(pokemon => ({ pokemon,
            xp: Math.max(1, Math.floor(calculateBattleExperience(defeated, multiplier, pokemon) / eligible.length))
        }));
        // This patch shares XP only: keep the existing active-only EV reward.
        const effort = grantEffort(team[0], defeated);
        for (const {pokemon, xp} of awards) rewardTraining(pokemon, defeated, xp, io, player.id,
            { effortGained: pokemon === team[0] ? effort : {} });
        return awards;
    }
}
module.exports = { AdventureExperience };
