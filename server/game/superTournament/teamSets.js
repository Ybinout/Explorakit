// Tower-only sets. Adventure teams retain their authored species and training.
// Defensive answers have ordinary weaknesses: Grass beats Gastrodon, while
// Ice/Fire pressure the new Grass pivots. No blanket type or damage modifiers.
const sets={
 470:{nature:'Jolly',ev:{hp:4,attack:252,speed:252},passiveAbility:'Leaf Guard',heldItem:'yache_berry',abilities:['Leaf Blade','Knock Off','Synthesis','Swords Dance']},
 171:{nature:'Calm',ev:{hp:252,specialAttack:4,specialDefense:252},passiveAbility:'Volt Absorb',heldItem:'leftovers',abilities:['Scald','Thunderbolt','Ice Beam','Volt Switch']},
 254:{nature:'Timid',ev:{hp:4,specialAttack:252,speed:252},passiveAbility:'Overgrow',heldItem:'yache_berry',abilities:['Giga Drain','Dragon Pulse','Focus Blast','Leaf Storm']},
 423:{nature:'Calm',ev:{hp:252,defense:4,specialDefense:252},passiveAbility:'Storm Drain',heldItem:'rindo_berry',abilities:['Scald','Earth Power','Ice Beam','Recover']},
 3:{nature:'Modest',ev:{hp:252,specialAttack:252,specialDefense:4},passiveAbility:'Overgrow',heldItem:'sitrus_berry',abilities:['Giga Drain','Sludge Bomb','Sleep Powder','Synthesis']},
 346:{nature:'Calm',ev:{hp:252,defense:4,specialDefense:252},passiveAbility:'Storm Drain',heldItem:'leftovers',abilities:['Giga Drain','Ancient Power','Earth Power','Recover']},
 479:{nature:'Timid',ev:{hp:4,specialAttack:252,speed:252},passiveAbility:'Levitate',heldItem:'leftovers',abilities:['Thunderbolt','Shadow Ball','Will-O-Wisp','Volt Switch']},
 465:{nature:'Impish',ev:{hp:252,defense:252,specialDefense:4},passiveAbility:'Regenerator',heldItem:'rocky_helmet',abilities:['Power Whip','Earthquake','Knock Off','Sleep Powder']},
 473:{nature:'Jolly',ev:{hp:4,attack:252,speed:252},passiveAbility:'Thick Fat',heldItem:'life_orb',abilities:['Earthquake','Icicle Crash','Ice Shard','Knock Off']},
 174:{nature:'Calm',ev:{hp:252,defense:128,specialDefense:128},passiveAbility:'Cute Charm',heldItem:'eviolite'},
 184:{nature:'Adamant',ev:{hp:252,attack:252,specialDefense:4},passiveAbility:'Huge Power',heldItem:'sitrus_berry'},
 // Their existing moves are special, despite the old primary-type heuristic.
 448:{nature:'Timid',ev:{hp:4,specialAttack:252,speed:252}},
 474:{nature:'Timid',ev:{hp:4,specialAttack:252,speed:252}},
 // Hoze's Leaf Blade set needs Attack, not Special Attack.
 253:{nature:'Jolly',ev:{hp:4,attack:252,speed:252}}
};
module.exports=Object.freeze(Object.fromEntries(Object.entries(sets).map(([id,set])=>[id,Object.freeze({...set,ev:Object.freeze(set.ev),...(set.abilities?{abilities:Object.freeze(set.abilities)}:{})})])));
