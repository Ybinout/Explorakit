const typeEffectiveness = {
    normal: { ghost: 0 },
    fire: { fire: 0.5, water: 0.5, grass: 2, ice: 2, bug: 2, rock: 0.5, steel: 2 },
    water: { fire: 2, water: 0.5, grass: 0.5, ground: 2, rock: 2 },
    electric: { water: 2, electric: 0.5, ground: 0, flying: 2 },
    grass: { fire: 0.5, water: 2, grass: 0.5, poison: 0.5, ground: 2, rock: 2, bug: 0.5 },
    ice: { fire: 0.5, water: 0.5, grass: 2, ice: 0.5, ground: 2, flying: 2, dragon: 2 },
    fighting: { normal: 2, ice: 2, rock: 2, dark: 2, steel: 2, fairy: 0.5, flying: 0.5, psychic: 0.5, bug: 0.5, poison: 0.5 },
    poison: { grass: 2, fairy: 2, poison: 0.5, ground: 0.5, rock: 0.5, ghost: 0.5, steel: 0 },
    ground: { fire: 2, electric: 2, poison: 2, rock: 2, steel: 2, grass: 0.5, ice: 0.5, bug: 0.5 },
    flying: { grass: 2, fighting: 2, bug: 2, electric: 0.5, rock: 0.5, steel: 0.5 },
    psychic: { fighting: 2, poison: 2, psychic: 0.5, dark: 0, steel: 0.5 },
    bug: { grass: 2, psychic: 2, dark: 2, fire: 0.5, fighting: 0.5, poison: 0.5, flying: 0.5, ghost: 0.5, steel: 0.5 },
    rock: { fire: 2, ice: 2, flying: 2, bug: 2, steel: 0.5, fighting: 0.5, ground: 0.5 },
    ghost: { psychic: 2, ghost: 2, dark: 0.5, normal: 0 },
    dragon: { dragon: 2, steel: 0.5, fairy: 0 },
    dark: { psychic: 2, ghost: 2, fighting: 0.5, dark: 0.5, fairy: 0.5 },
    steel: { ice: 2, rock: 2, fairy: 2, fire: 0.5, water: 0.5, electric: 0.5, steel: 0.5 },
    fairy: { fighting: 2, dragon: 2, dark: 2, poison: 0.5, steel: 0.5 }
};

function getEffectiveness(attackingType, defendingType) {
    return typeEffectiveness[attackingType][defendingType] || 1;
}

function calculateDamage(pokemonATK, PokemonDFS, ATK) {
    let Efficacite = getEffectiveness(ATK.type, PokemonDFS.type[0]) * getEffectiveness(ATK.type, PokemonDFS.type[1]);
    NivATKan = pokemonATK.level
    Puissanceatk = ATK.power
    STAB = 1;
    if (ATK.type == pokemonATK.type[0] || ATK.type == pokemonATK.type[1]) {
        STAB = 1.5;
    }
    if (ATK.category == 'phy') {
        AttaqueATKan = pokemonATK.currentAttack
        DefenseDFS = PokemonDFS.currentDefense
    } else if (ATK.category == 'spe') {
        AttaqueATKan = pokemonATK.currentSpecialAttack
        DefenseDFS = PokemonDFS.currentSpecialDefense
    }
    let damage = ((((((2 * NivATKan / 5) + 2) * AttaqueATKan * Puissanceatk) / DefenseDFS) / 50) + 2) * STAB * Efficacite;
    return Math.round(damage);
}

function burnDamage(pokemon) {
    let damage = pokemon.currentHp * (1 / 8)
    return Math.round(damage);
}

function poisonDamage(pokemon) {
    let damage = pokemon.currentHp * (1 / 8)
    return Math.round(damage);
}


function upStat(pokemon , stat){

}


function downStat(pokemon , stat){

}