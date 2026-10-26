// Disposable Pokémon for the catalogue audit and browser/SQL recipes.
const {items}=require('../../data/game/items.json');
const factory=require('../../server/game/drift/pokemonFactory');
const stones=require('../../server/game/items/stoneEvolution');
const {machines}=require('../../data/game/machines.json');
const {rules}=require('../../data/game/stone_evolutions.json');
const {STAT_KEYS}=require('../../server/game/models/training');
function targetFor(item) {
    let pokemon;
    if(item.category==='evolution') {
        const rule=rules.find(rule=>rule.item===item.key);
        if(!rule)throw Error(`No evolution rule: ${item.key}`);
        do {pokemon=factory.create(rule.from,30,true);} while(!stones.target(pokemon,item.key));
        return pokemon;
    }
    pokemon=factory.create(item.category==='machine'?machines[item.key].species[0]:7,30,true);
    pokemon.abilities=item.category==='machine'?[]:['Tackle'];pokemon.movePp=item.category==='machine'?[]:[35];
    pokemon.pendingMoves=[];
    const effect=item.fieldUse||item;
    if(effect.effort||effect.effortReset) {for(const key of STAT_KEYS)pokemon.ev[key]=20;pokemon.recalculateStats();}
    if(effect.ivReroll) {pokemon.iv[effect.ivReroll]=1;pokemon.recalculateStats();}
    if(effect.restorePp)pokemon.movePp=[0];
    if(effect.heal||effect.healFraction||item.category==='heal')pokemon.currentHp=1;
    if(effect.cure)pokemon.status=effect.cure[0];
    if(effect.revive)pokemon.currentHp=0;
    return pokemon;
}
function usage(item) {
    if(item.category==='evolution')return 'stone';
    if(item.category==='machine')return 'machine';
    if(item.category==='medicine'||item.category==='heal'||item.fieldUse)return 'medicine';
    if(item.repelSteps)return 'repel';
    if(item.category==='held')return 'equip';
    if(item.category==='ball')return 'capture';
    if(item.key==='fishing_rod')return 'fish';
    if(item.key==='fly_module')return 'fly';
    if(item.key==='exp_share')return 'passive';
    if(['clara_registry','clara_reunion_letter','route2_house_key','gwenn_house_key','professor_lab_key'].includes(item.key))return 'story';
    throw Error(`Unrouted item: ${item.key}`);
}
module.exports={items,targetFor,usage};
