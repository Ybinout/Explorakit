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
    class Pokemon {
        constructor(id, name, level, experience, givenIv, nature = "Bashful", k = null) {
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
            this.passiveAbility = chooseSpeciesAbility(id);
            this.heldItem = null;
            this.type1 = data.type[0];
            this.type2 = data.type[1];
            this.k = normalizeK(k) || this.randomK();
            this.nature = nature;
            
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

            if (NATURES[this.nature].increase === statType) {
                natureMultiplier = 1.1;
            } else if (NATURES[this.nature].decrease === statType) {
                natureMultiplier = 0.9;
            }

            return Math.floor((((2 * base + (this.k * iv)) * this.level) / 100 + 5) * natureMultiplier);
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

        recalculateStats() {
            this.attack = this.calculateStat(this.data.base.Attack, this.iv.attack, "attack");
            this.specialAttack = this.calculateStat(this.data.base["Sp. Attack"], this.iv.specialAttack, "specialAttack");
            this.defense = this.calculateStat(this.data.base.Defense, this.iv.defense, "defense");
            this.specialDefense = this.calculateStat(this.data.base["Sp. Defense"], this.iv.specialDefense, "specialDefense");
            this.speed = this.calculateStat(this.data.base.Speed, this.iv.speed, "speed");
            this.maxHp = Math.floor((((2 * this.data.base.HP + (this.k * this.iv.hp)) * this.level) / 100 + this.level + 10));
            this.currentHp = this.maxHp;
            this.currentAttack = this.attack;
            this.currentSpecialAttack = this.specialAttack;
            this.currentDefense = this.defense;
            this.currentSpecialDefense = this.specialDefense;
            this.currentSpeed = this.speed;
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
            this.experience += Math.max(0, Math.floor(Number(expGained) || 0));
            const targetLevel = this.calculateLevelFromExperience(this.experience);
            if (targetLevel > this.level) {
                this.level = targetLevel;
                this.recalculateStats();
                this.checkEvolution();
            }
        }

        checkEvolution() {
            if (this.level >= 30 && this.data.evo2) {
                const chance = Math.random();
                if (chance < 0.08) {
                    this.updatePokemon(this.data.evo2);
                }
            }
            if (this.level >= 55 && this.data.evo3) {
                const chance = Math.random();
                if (chance < 0.04) {
                    this.updatePokemon(this.data.evo3);
                }
            }
        }

        updatePokemon(newId) {
            const evolvedAbility = evolveSpeciesAbility(this.data.id, newId, this.passiveAbility);
            const newPokemon = new Pokemon(newId, this.name, this.level, this.experience, this.iv, this.nature, this.k);
            Object.keys(newPokemon).forEach(key => {
                if (!['iv', 'k', 'level', 'experience', 'nature', 'abilities'].includes(key)) {
                    this[key] = newPokemon[key];
                }
            });
            this.data = newPokemon.data;
            this.passiveAbility = evolvedAbility;
            this.recalculateStats();
        }
    }

    module.exports = Pokemon;
