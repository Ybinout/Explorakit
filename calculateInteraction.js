const typeEffectiveness = {
    Normal: { Ghost: 0 },
    Fire: { Fire: 0.5, Water: 0.5, Grass: 2, Ice: 2, Bug: 2, Rock: 0.5, Steel: 2 },
    Water: { Fire: 2, Water: 0.5, Grass: 0.5, Ground: 2, Rock: 2 },
    Electric: { Water: 2, Electric: 0.5, Ground: 0, Flying: 2 },
    Grass: { Fire: 0.5, Water: 2, Grass: 0.5, Poison: 0.5, Ground: 2, Rock: 2, Bug: 0.5 },
    Ice: { Fire: 0.5, Water: 0.5, Grass: 2, Ice: 0.5, Ground: 2, Flying: 2, Dragon: 2 },
    Fighting: { Normal: 2, Ice: 2, Rock: 2, Dark: 2, Steel: 2, Fairy: 0.5, Flying: 0.5, Psychic: 0.5, Bug: 0.5, Poison: 0.5 },
    Poison: { Grass: 2, Fairy: 2, Poison: 0.5, Ground: 0.5, Rock: 0.5, Ghost: 0.5, Steel: 0 },
    Ground: { Fire: 2, Electric: 2, Poison: 2, Rock: 2, Steel: 2, Grass: 0.5, Ice: 0.5, Bug: 0.5 },
    Flying: { Grass: 2, Fighting: 2, Bug: 2, Electric: 0.5, Rock: 0.5, Steel: 0.5 },
    Psychic: { Fighting: 2, Poison: 2, Psychic: 0.5, Dark: 0, Steel: 0.5 },
    Bug: { Grass: 2, Psychic: 2, Dark: 2, Fire: 0.5, Fighting: 0.5, Poison: 0.5, Flying: 0.5, Ghost: 0.5, Steel: 0.5 },
    Rock: { Fire: 2, Ice: 2, Flying: 2, Bug: 2, Steel: 0.5, Fighting: 0.5, Ground: 0.5 },
    Ghost: { Psychic: 2, Ghost: 2, Dark: 0.5, Normal: 0 },
    Dragon: { Dragon: 2, Steel: 0.5, Fairy: 0 },
    Dark: { Psychic: 2, Ghost: 2, Fighting: 0.5, Dark: 0.5, Fairy: 0.5 },
    Steel: { Ice: 2, Rock: 2, Fairy: 2, Fire: 0.5, Water: 0.5, Electric: 0.5, Steel: 0.5 },
    Fairy: { Fighting: 2, Dragon: 2, Dark: 2, Poison: 0.5, Steel: 0.5 }
};

function getEffectiveness(attackingType, defendingType) {
    return typeEffectiveness[attackingType][defendingType] || 1;
}

function calculateDamage(pokemonATK, PokemonDFS, ATK) {
    // console.log(ATK ,'dada');
    let Efficacite = getEffectiveness(ATK.type, PokemonDFS.type1) * getEffectiveness(ATK.type, PokemonDFS.type2);
    NivATKan = pokemonATK.level
    Puissanceatk = ATK.power
    STAB = 1;
    if (ATK.type == pokemonATK.type1 || ATK.type == pokemonATK.type2) {
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
    // console.log('les dgts',damage);
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


function upStat(pokemon, stat) {

}


function downStat(pokemon, stat) {

}

function useattack(attaque, pokemon1, pokemon2) {
    
    const fs = require('fs');
    const loadData = () => {

        const data = fs.readFileSync('source_Json/moves.json', 'utf8');
        return JSON.parse(data);
    };

    const findAttack = (attaque) => {

        const moves = loadData();
        
        for (let move of moves) {

            if (move.ename === attaque) {
                return move;
            }
        }
    
        return null;
    };
    
    const correspondingMove = findAttack(attaque);

    // console.log('correspjndingt move',correspondingMove);
    //gerer le si attaque est spe ou dmg


    //gerer burn elec glace para

    //inflige dmg , creer putdmg dans pokemon

   
    
    pokemon2.putdmg(calculateDamage(pokemon1, pokemon2, correspondingMove))
}

module.exports = {
    getEffectiveness,
    useattack
};