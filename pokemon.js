const fs = require('fs');
const pokemonData = JSON.parse(fs.readFileSync('./pokemon/pokedex.json', 'utf8'));

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
    constructor(id, name, level, experience, givenIv, nature = "Bashful", k = null) { // Added nature parameter with a default value of "Bashful"
        const data = pokemonData.find(p => p.id === id);
        if (!data) {
            throw new Error("No Pokémon found with the given ID!");
        }
        this.data = data
        this.name = name;
        this.level = level || 1;
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

        // Applying the new formulas with nature multiplier
        this.recalculateStats();
        this.determineExpGroup(data);
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

    addAbility(abilityId) {
        if (this.abilities.length < 4) {
            this.abilities.push(abilityId);
        } else {
            console.error("Maximum of 4 abilities reached!");
        }
    }

    randomK() {
        const randomValue = Math.random() * 100;  // Generate a random value between 0 and 100
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
        this.expGroup = expGroup;  // Assigning the determined exp group to the Pokemon

    }
    recalculateStats() {
        this.attack = this.calculateStat(this.data.base.Attack, this.iv.attack, "attack");
        this.specialAttack = this.calculateStat(this.data.base["Sp. Attack"], this.iv.specialAttack, "specialAttack");
        this.defense = this.calculateStat(this.data.base.Defense, this.iv.defense, "defense");
        this.specialDefense = this.calculateStat(this.data.base["Sp. Defense"], this.iv.specialDefense, "specialDefense");
        this.speed = this.calculateStat(this.data.base.Speed, this.iv.speed, "speed");
        this.maxHp = Math.floor((((2 * this.data.base.HP + this.iv.hp) * this.level) / 100 + this.level + 10));
        this.currentHp = this.maxHp;  // Optional, based on your game logic
        this.currentAttack = this.attack;
        this.currentSpecialAttack = this.specialAttack;
        this.currentDefense = this.defense;
        this.currentSpecialDefense = this.specialDefense;
        this.currentSpeed = this.speed;
    }


    getNextLevelExp() {
        const expGroup = this.expGroup;  // Utilisation de this.expGroup
        const nextLevel = this.level + 1;
        let nextLevelExp;
        switch (expGroup) {
            case "Fast":
                nextLevelExp = Math.floor((4 * Math.pow(nextLevel, 3)) / 5);
                break;
            case "MediumFast":
                nextLevelExp = Math.pow(nextLevel, 3);
                break;
            case "MediumSlow":
                nextLevelExp = Math.floor(((6 / 5) * Math.pow(nextLevel, 3)) - 15 * Math.pow(nextLevel, 2) + 100 * nextLevel - 140);
                // console.log(nextLevelExp);
                break;
            case "Slow":
                nextLevelExp = Math.floor((5 * Math.pow(nextLevel, 3)) / 4);
                break;
            default:
                throw new Error("Unknown experience group");
        }

        return nextLevelExp
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
        // console.log('EVOLUTION REUSSI A VOIR :');
        const newPokemon = new Pokemon(newId, this.name, this.level, this.experience, this.iv, this.nature, this.k);
        // Maintenant, copiez toutes les propriétés sauf iv, k, level, experience, et nature
        Object.keys(newPokemon).forEach(key => {
            if (!['iv', 'k', 'level', 'experience', 'nature'].includes(key)) {
                this[key] = newPokemon[key];
            }
        });
        // Mettez à jour data, id, et d'autres propriétés spécifiques ici si nécessaire
        this.data = newPokemon.data;
        this.recalculateStats();
        // ... et ainsi de suite pour d'autres propriétés
    }
}



// Example usage:
// const test = new Pokemon(1, "test", 0, 0, null, "Timid", null);
// test.addAbility(1);
// test.addAbility(2);
// test.addAbility(3);
// test.addAbility(4);
// console.log(test);
// test.gainExperience(80000);
// console.log(test);

module.exports = Pokemon;
