// House simulations only: one corrupted member, six distinct items, legal
// natural moves except the explicitly installed corrupted CS.
const sets = [
 {key:'practice_clay_clock',name:'Horlogers d’argile',role:'Distorsion et artillerie',portrait:'nrv-noz-v1.png',lead:437,members:[
  {id:224,nature:'Quiet',ability:'Sniper',item:'corrupted_choice_specs',modules:['cmod_ability_tintedlens'],iv:{speed:0},ev:{hp:252,specialAttack:252,specialDefense:4},moves:['Water Spout','Surf','Energy Ball','Ice Beam']},
  {id:437,nature:'Sassy',ability:'Levitate',item:'leftovers',iv:{speed:0},ev:{hp:252,defense:128,specialDefense:128},moves:['Trick Room','Stealth Rock','Gyro Ball','Earthquake']},
  {id:579,nature:'Quiet',ability:'Magic Guard',item:'life_orb',iv:{speed:0},ev:{hp:252,specialAttack:252,defense:4},moves:['Trick Room','Psychic','Focus Blast','Recover']},
  {id:589,nature:'Brave',ability:'Shell Armor',item:'choice_band',iv:{speed:0},ev:{hp:252,attack:252,specialDefense:4},moves:['Megahorn','Iron Head','Knock Off','Pursuit']},
  {id:464,nature:'Brave',ability:'Solid Rock',item:'expert_belt',iv:{speed:0},ev:{hp:252,attack:252,specialDefense:4},moves:['Earthquake','Stone Edge','Ice Punch','Hammer Arm']},
  {id:563,nature:'Relaxed',ability:'Mummy',item:'rocky_helmet',iv:{speed:0},ev:{hp:252,defense:252,specialDefense:4},moves:['Trick Room','Will-O-Wisp','Shadow Ball','Pain Split']}
 ]},
 {key:'practice_cotton_relay',name:'Relais de coton',role:'Relais et couvertures croisées',portrait:'nrv-tom-v1.png',lead:203,members:[
  {id:203,nature:'Calm',ability:'Inner Focus',item:'corrupted_leftovers',modules:['cmod_ability_prankster'],ev:{hp:252,defense:128,specialDefense:128},moves:['Agility','Amnesia','Baton Pass','Psychic']},
  {id:171,nature:'Modest',ability:'Volt Absorb',item:'assault_vest',ev:{hp:252,specialAttack:252,defense:4},moves:['Scald','Thunderbolt','Ice Beam','Volt Switch']},
  {id:103,nature:'Bold',ability:'Harvest',item:'sitrus_berry',ev:{hp:252,defense:252,specialDefense:4},moves:['Sleep Powder','Giga Drain','Psychic','Synthesis']},
  {id:346,nature:'Calm',ability:'Storm Drain',item:'leftovers',ev:{hp:252,specialDefense:252,defense:4},moves:['Giga Drain','Ancient Power','Recover','Toxic']},
  {id:277,nature:'Jolly',ability:'Guts',item:'flame_orb',ev:{attack:252,speed:252,hp:4},moves:['Facade','Brave Bird','Quick Attack','U-turn']},
  {id:237,nature:'Adamant',ability:'Intimidate',item:'expert_belt',ev:{hp:252,attack:252,defense:4},moves:['Rapid Spin','Close Combat','Mach Punch','Sucker Punch']}
 ]},
 {key:'practice_flying_fortress',name:'Forteresse volante',role:'Usure et contre-pression',portrait:'nrv-cry-v1.png',lead:31,members:[
  {id:416,nature:'Bold',ability:'Pressure',item:'corrupted_leftovers',modules:['cmod_ability_magicguard'],ev:{hp:252,defense:252,specialDefense:4},moves:['Attack Order','Defend Order','Heal Order','Toxic']},
  {id:31,nature:'Modest',ability:'Sheer Force',item:'life_orb',ev:{hp:252,specialAttack:252,defense:4},moves:['Stealth Rock','Earth Power','Ice Beam','Thunderbolt']},
  {id:178,nature:'Bold',ability:'Magic Bounce',item:'rocky_helmet',ev:{hp:252,defense:252,speed:4},moves:['Roost','U-turn','Heat Wave','Psychic']},
  {id:463,nature:'Careful',ability:'Own Tempo',item:'leftovers',ev:{hp:252,specialDefense:252,defense:4},moves:['Wish','Protect','Body Slam','Knock Off']},
  {id:62,nature:'Impish',ability:'Water Absorb',item:'chesto_berry',ev:{hp:252,defense:252,specialDefense:4},moves:['Rest','Sleep Talk','Circle Throw','Waterfall']},
  {id:625,nature:'Adamant',ability:'Defiant',item:'black_glasses',ev:{hp:252,attack:252,speed:4},moves:['Sucker Punch','Iron Head','Knock Off','Swords Dance']}
 ]},
 {key:'practice_night_tide',name:'Marée nocturne',role:'Pluie et résistances atypiques',portrait:'nrv-noz-v1.png',lead:457,members:[
  {id:457,nature:'Bold',ability:'Storm Drain',item:'corrupted_leftovers',modules:['cmod_ability_drizzle','cmod_defense_grass'],ev:{hp:252,defense:252,specialDefense:4},moves:['Scald','U-turn','Tailwind','Ice Beam']},
  {id:348,nature:'Adamant',ability:'Swift Swim',item:'expert_belt',ev:{attack:252,speed:252,hp:4},moves:['Rapid Spin','Stone Edge','X-Scissor','Aqua Jet']},
  {id:454,nature:'Adamant',ability:'Dry Skin',item:'life_orb',ev:{attack:252,speed:252,hp:4},moves:['Drain Punch','Sucker Punch','Ice Punch','Bulk Up']},
  {id:346,nature:'Calm',ability:'Storm Drain',item:'leftovers',ev:{hp:252,specialDefense:252,defense:4},moves:['Giga Drain','Ancient Power','Toxic','Recover']},
  {id:171,nature:'Modest',ability:'Volt Absorb',item:'choice_specs',ev:{hp:252,specialAttack:252,defense:4},moves:['Thunder','Surf','Ice Beam','Volt Switch']},
  {id:89,nature:'Careful',ability:'Sticky Hold',item:'black_sludge',ev:{hp:252,specialDefense:252,attack:4},moves:['Curse','Poison Jab','Shadow Sneak','Rest']}
 ]},
 {key:'practice_steel_revenants',name:'Revenants d’acier',role:'Pivots et démantèlement défensif',portrait:'nrv-tom-v1.png',lead:473,members:[
  {id:429,nature:'Calm',ability:'Levitate',item:'corrupted_leftovers',modules:['cmod_ability_regenerator','cmod_move_575'],ev:{hp:248,defense:160,specialDefense:100},moves:['Shadow Ball','Taunt','Will-O-Wisp','Pain Split']},
  {id:473,nature:'Jolly',ability:'Thick Fat',item:'expert_belt',ev:{attack:252,speed:252,hp:4},moves:['Stealth Rock','Ice Shard','Earthquake','Icicle Crash']},
  {id:604,nature:'Modest',ability:'Levitate',item:'assault_vest',ev:{hp:252,specialAttack:252,defense:4},moves:['Volt Switch','Giga Drain','Flamethrower','Thunderbolt']},
  {id:573,nature:'Jolly',ability:'Skill Link',item:'choice_band',ev:{attack:252,speed:252,hp:4},moves:['Tail Slap','Bullet Seed','Rock Blast','U-turn']},
  {id:452,nature:'Jolly',ability:'Battle Armor',item:'black_sludge',ev:{hp:252,speed:252,attack:4},moves:['Toxic Spikes','Knock Off','Earthquake','Taunt']},
  {id:560,nature:'Careful',ability:'Shed Skin',item:'leftovers',ev:{hp:252,specialDefense:252,attack:4},moves:['Bulk Up','Drain Punch','Crunch','Rest']}
 ]}
];
module.exports = sets;
