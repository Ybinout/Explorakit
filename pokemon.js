const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const pokemonData = JSON.parse(fs.readFileSync('./source_Json/pokedex.json', 'utf8'));

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
        this.experience = experience || 0;
        this.abilities = [];
        this.type1 = data.type[0];
        this.type2 = data.type[1];
        this.k = k || this.randomK();
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
        let level = 1;
        while (experience >= this.getNextLevelExpForLevel(level)) {
            level++;
        }
        return level;
    }

    getNextLevelExpForLevel(level) {
        let nextLevelExp;
        switch (this.expGroup) {
            case "Fast":
                nextLevelExp = Math.floor((4 * Math.pow(level, 3)) / 5);
                break;
            case "MediumFast":
                nextLevelExp = Math.pow(level, 3);
                break;
            case "MediumSlow":
                nextLevelExp = Math.floor(((6 / 5) * Math.pow(level, 3)) - 15 * Math.pow(level, 2) + 100 * level - 140);
                break;
            case "Slow":
                nextLevelExp = Math.floor((5 * Math.pow(level, 3)) / 4);
                break;
            default:
                throw new Error("Unknown experience group");
        }
        return nextLevelExp;
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
        } else {
            console.error("Maximum of 4 abilities reached!");
        }
    }

    randomK() {
        const randomValue = Math.random() * 100;
        if (randomValue < 0.2) return 4;
        if (randomValue < 2) return 3;
        if (randomValue < 20) return 2;
        return 1;
    }

    determineExpGroup(data) {
        const expMax = data.exp;
        let expGroup;
        switch (expMax) {
            case 600000:
                expGroup = "Fast";
                break;
            case 800000:
                expGroup = "MediumFast";
                break;
            case 1000000:
            case 1059860:
                expGroup = "MediumSlow";
                break;
            case 1250000:
                expGroup = "Slow";
                break;
            case 1640000:
                expGroup = "Parabolic";
                break;
            default:
                throw new Error("Unknown max experience value");
        }
        this.expGroup = expGroup;
    }

    recalculateStats() {
        this.attack = this.calculateStat(this.data.base.Attack, this.iv.attack, "attack");
        this.specialAttack = this.calculateStat(this.data.base["Sp. Attack"], this.iv.specialAttack, "specialAttack");
        this.defense = this.calculateStat(this.data.base.Defense, this.iv.defense, "defense");
        this.specialDefense = this.calculateStat(this.data.base["Sp. Defense"], this.iv.specialDefense, "specialDefense");
        this.speed = this.calculateStat(this.data.base.Speed, this.iv.speed, "speed");
        this.maxHp = Math.floor((((2 * this.data.base.HP + this.iv.hp) * this.level) / 100 + this.level + 10));
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
        this.experience += expGained;
        while (this.experience >= this.getNextLevelExp()) {
            this.level++;
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
        const newPokemon = new Pokemon(newId, this.name, this.level, this.experience, this.iv, this.nature, this.k);
        Object.keys(newPokemon).forEach(key => {
            if (!['iv', 'k', 'level', 'experience', 'nature', 'abilities'].includes(key)) {
                this[key] = newPokemon[key];
            }
        });
        this.data = newPokemon.data;
        this.recalculateStats();
    }
}

module.exports = Pokemon;
