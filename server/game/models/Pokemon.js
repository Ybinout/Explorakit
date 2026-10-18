    const fs = require('fs');
    const { v4: uuidv4 } = require('uuid');
    const path = require('node:path');
    const {
        getExperienceRate,
        getLevelFromExperience,
        getTotalExperienceForLevel,
        normalizeK,
        rollK
    } = require('./progression');
    const { getMaxMovePp } = require('../battle/battleResources');
    const { chooseSpeciesAbility, evolveSpeciesAbility } = require('../abilities/abilityDex');
    const pokemonData = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', '..', '..', 'data', 'game', 'pokedex.json'), 'utf8'));

    const perfectIVs = {
        attack: 31,
        defense: 31,
        hp: 31,
        specialDefense: 31,
        speed: 31,
        specialAttack: 31
    };

    // List of Natures and their effects
    const NATURES = {
        "Adamant": { increase: "attack", decrease: "specialAttack" },
        "Bashful": { increase: "specialAttack", decrease: "specialAttack" },
        "Bold": { increase: "defense", decrease: "attack" },
        "Brave": { increase: "attack", decrease: "speed" },
        "Calm": { increase: "specialDefense", decrease: "attack" },
        "Careful": { increase: "specialDefense", decrease: "specialAttack" },
        "Docile": { increase: "defense", decrease: "defense" },
        "Gentle": { increase: "specialDefense", decrease: "defense" },
        "Hardy": { increase: "attack", decrease: "attack" },
        "Hasty": { increase: "speed", decrease: "defense" },
        "Impish": { increase: "defense", decrease: "specialAttack" },
        "Jolly": { increase: "speed", decrease: "specialAttack" },
        "Lax": { increase: "defense", decrease: "specialDefense" },
        "Lonely": { increase: "attack", decrease: "defense" },
        "Mild": { increase: "specialAttack", decrease: "defense" },
        "Modest": { increase: "specialAttack", decrease: "attack" },
        "Naive": { increase: "speed", decrease: "specialDefense" },
        "Naughty": { increase: "attack", decrease: "specialDefense" },
        "Quiet": { increase: "specialAttack", decrease: "speed" },
        "Quirky": { increase: "specialDefense", decrease: "specialDefense" },
        "Rash": { increase: "specialAttack", decrease: "specialDefense" },
        "Relaxed": { increase: "defense", decrease: "speed" },
        "Sassy": { increase: "specialDefense", decrease: "speed" },
        "Serious": { increase: "speed", decrease: "speed" },
        "Timid": { increase: "speed", decrease: "attack" }
    };
    const { normalizeEffort } = require('./training');
    class Pokemon {
        static randomTraits(random = Math.random) {
            const iv = Object.fromEntries(['attack', 'defense', 'hp', 'specialDefense', 'speed', 'specialAttack']
                .map(stat => [stat, Math.min(31, Math.max(0, Math.floor(random() * 32)))]));
            return { iv, nature: Pokemon.randomNature(random), k: rollK(random) };
        }
        static randomNature(random = Math.random) {
            const names = Object.keys(NATURES);
            return names[Math.min(names.length - 1, Math.floor(random() * names.length))];
        }
        constructor(id, name, level, experience, givenIv, nature = "Bashful", k = null, ev = {}, savedExperienceRate = null) {
            const data = pokemonData.find(p => p.id === id);
            if (!data) {
                throw new Error("No Pokémon found with the given ID!");
            }
            this.uuid = uuidv4();
            this.data = data;
            this.name = name;
            this.status = "normal";
            this.dodge = 0;
            this.accuracy = 100;
            this.experience = Math.max(0, Math.floor(Number(experience) || 0));
            this.abilities = [];
            this.movePp = [];
            this.pendingMoves = [];
            this.passiveAbility = chooseSpeciesAbility(id);
            this.heldItem = null;
            this.type1 = data.type[0];
            this.type2 = data.type[1];
            this.k = normalizeK(k) || this.randomK();
            this.nature = NATURES[nature] ? nature : "Bashful";
            this.ev = normalizeEffort(ev);
            
            this.iv = givenIv || {
                attack: this.randomIV(),
                defense: this.randomIV(),
                hp: this.randomIV(),
                specialDefense: this.randomIV(),
                speed: this.randomIV(),
                specialAttack: this.randomIV()
            };
            this.truename = data.name.french;

            this.determineExpGroup(data);
            if (Number.isFinite(Number(savedExperienceRate)) && Number(savedExperienceRate) > 0) this.experienceRate = Number(savedExperienceRate);
            this.level = this.calculateLevelFromExperience(this.experience); // Calculer le niveau basé sur l'expérience

            // Recalculer les stats après avoir déterminé le niveau correct
            this.recalculateStats();
        }

        calculateLevelFromExperience(experience) {
            return getLevelFromExperience(experience, this.experienceRate);
        }

        getNextLevelExpForLevel(level) {
            return getTotalExperienceForLevel(level, this.experienceRate);
        }

        calculateStat(base, iv, statType) {
            let natureMultiplier = 1.0;

            if (NATURES[this.nature].increase !== NATURES[this.nature].decrease && NATURES[this.nature].increase === statType) {
                natureMultiplier = 1.1;
            } else if (NATURES[this.nature].increase !== NATURES[this.nature].decrease && NATURES[this.nature].decrease === statType) {
                natureMultiplier = 0.9;
            }

            return Math.floor((((2 * base + (this.k * iv) + Math.floor(this.ev[statType] / 4)) * this.level) / 100 + 5) * natureMultiplier);
        }

        randomIV() {
            return Math.floor(Math.random() * 32);
        }

        addAbility(abilityName) {
            if (this.abilities.length < 4) {
                this.abilities.push(abilityName);
                this.movePp.push(getMaxMovePp(abilityName));
            } else {
                console.error("Maximum of 4 abilities reached!");
            }
        }

        randomK(random = Math.random) {
            return rollK(random);
        }

        determineExpGroup(data) {
            const expMax = data.exp;
            let expGroup = "Standard";
            switch (expMax) {
                case 600000:
                    expGroup = "VeryFast";
                    break;
                case 800000:
                    expGroup = "Fast";
                    break;
                case 1000000:
                    expGroup = "Standard";
                    break;
                case 1059860:
                    expGroup = "Steady";
                    break;
                case 1250000:
                    expGroup = "Slow";
                    break;
                case 1640000:
                    expGroup = "VerySlow";
                    break;
                default:
                    expGroup = "Standard";
            }
            this.expGroup = expGroup;
            this.experienceRate = getExperienceRate(expMax);
        }

        recalculateStats(preserveCombat = false) {
            const previousHp = this.currentHp;
            const previousMax = this.maxHp;
            const ratios = {};
            for (const stat of ['Attack', 'Defense', 'SpecialAttack', 'SpecialDefense', 'Speed']) {
                const base = stat[0].toLowerCase() + stat.slice(1);
                ratios[stat] = this[base] ? this['current' + stat] / this[base] : 1;
            }
            this.attack = this.calculateStat(this.data.base.Attack, this.iv.attack, "attack");
            this.specialAttack = this.calculateStat(this.data.base["Sp. Attack"], this.iv.specialAttack, "specialAttack");
            this.defense = this.calculateStat(this.data.base.Defense, this.iv.defense, "defense");
            this.specialDefense = this.calculateStat(this.data.base["Sp. Defense"], this.iv.specialDefense, "specialDefense");
            this.speed = this.calculateStat(this.data.base.Speed, this.iv.speed, "speed");
            this.maxHp = Math.floor((((2 * this.data.base.HP + (this.k * this.iv.hp) + Math.floor(this.ev.hp / 4)) * this.level) / 100 + this.level + 10));
            this.currentHp = this.maxHp;
            this.currentAttack = this.attack;
            this.currentSpecialAttack = this.specialAttack;
            this.currentDefense = this.defense;
            this.currentSpecialDefense = this.specialDefense;
            this.currentSpeed = this.speed;
            if (preserveCombat && Number.isFinite(previousHp)) {
                this.currentHp = previousHp <= 0 ? 0 : Math.max(1, Math.min(this.maxHp, previousHp + this.maxHp - previousMax));
                for (const stat of Object.keys(ratios)) {
                    const base = stat[0].toLowerCase() + stat.slice(1);
                    this['current' + stat] = Math.max(1, Math.floor(this[base] * ratios[stat] + 1e-9));
                }
            }
        }

        resetCombatStats() {
            for (const stat of ['Attack', 'Defense', 'SpecialAttack', 'SpecialDefense', 'Speed']) {
                this['current' + stat] = this[stat[0].toLowerCase() + stat.slice(1)];
            }
        }

        gainEffort(yieldStats) {
            const before = this.ev;
            this.ev = { ...before };
            let remaining = 510 - Object.values(before).reduce((sum, value) => sum + value, 0);
            for (const key of Object.keys(before)) {
                const gain = Math.min(252 - before[key], remaining, Math.max(0, Math.floor(Number(yieldStats[key]) || 0)));
                this.ev[key] += gain;
                remaining -= gain;
            }
            this.recalculateStats(true);
            return Object.fromEntries(Object.keys(before).map(key => [key, this.ev[key] - before[key]]));
        }

        putdmg(nbr) {
            this.currentHp -= nbr;
        }

        getAtkName(nbr) {
            return this.abilities[nbr];
        }

        getNextLevelExp() {
            const nextLevel = this.level + 1;
            return this.getNextLevelExpForLevel(nextLevel);
        }

        gainExperience(expGained) {
            const gain = Number.isFinite(Number(expGained)) ? Math.max(0, Math.floor(Number(expGained))) : 0;
            this.experience += gain;
            const targetLevel = this.calculateLevelFromExperience(this.experience);
            // Resolve each crossed level in order so intermediate species learn their own moves.
            // Levels above 100 have no new species thresholds or learnset entries.
            while (this.level < Math.min(targetLevel, 100)) {
                const previousLevel = this.level++;
                require('./moveLearning').queueLevelMoves(this, previousLevel);
                this.recalculateStats(true);
                this.checkEvolution();
            }
            if (targetLevel > this.level) {
                const previousLevel = this.level;
                this.level = targetLevel;
                require('./moveLearning').queueLevelMoves(this, previousLevel);
                this.recalculateStats(true);
            }
            if (gain > 0) this.checkEvolution();
        }

        checkEvolution() {
            const evolution = require('./evolution');
            // Also catches up old companions already above a threshold. Branch choices
            // remain available in the companion sheet, never selected by iteration order.
            for (let step = 0; step < 4; step++) {
                const rule = evolution.automatic(this);
                if (!rule) break;
                evolution.apply(this, rule);
            }
        }

        updatePokemon(newId) {
            const oldName = this.truename;
            const rate = this.experienceRate;
            const baseAbility = Object.hasOwn(this, '__passiveAbilityBeforeBattle') ? this.__passiveAbilityBeforeBattle : this.passiveAbility;
            const evolvedAbility = evolveSpeciesAbility(this.data.id, newId, baseAbility);
            this.data = pokemonData.find(p => p.id === newId);
            this.type1 = this.data.type[0];
            this.type2 = this.data.type[1];
            this.truename = this.data.name.french;
            if (this.name === oldName || this.name === pokemonData.find(p => p.name.french === oldName)?.name.english) this.name = this.truename;
            this.determineExpGroup(this.data);
            this.experienceRate = rate; // Evolution must not change earned XP or level.
            if (Object.hasOwn(this, '__passiveAbilityBeforeBattle')) this.__passiveAbilityBeforeBattle = evolvedAbility;
            this.passiveAbility = evolvedAbility;
            this.recalculateStats(true);
            require('./moveLearning').queueLevelMoves(this, this.level, true);
        }
    }

    module.exports = Pokemon;
