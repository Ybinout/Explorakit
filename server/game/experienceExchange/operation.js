const {createHash}=require('node:crypto');
const {PRICE}=require('./laboratory');
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FIELDS=['level','experience','current_hp','current_attack','current_defense','current_special_attack','current_special_defense','current_speed'];
function fingerprint(entry){return createHash('sha256').update(JSON.stringify({source:entry.source,box:entry.box??null,slot:entry.slot??null,raw:entry.raw})).digest('hex');}
function dto(entry){const p=entry.pokemon;return{shiny:p.shiny===true,uuid:p.uuid,name:p.name,speciesName:p.data.name.french,pokemonId:p.data.id,level:p.level,experience:p.experience,k:p.k,types:[p.type1,p.type2].filter(Boolean),currentHp:p.currentHp,maxHp:p.maxHp,source:entry.source,box:entry.box??null,slot:entry.slot??null};}
function validate(first,second){
 if(!first||!second)throw Error('Un des Pokémon n’est plus disponible. Actualise le laboratoire.');
 if(first.pokemon.uuid===second.pokemon.uuid)throw Error('Choisis deux Pokémon différents.');
 if(first.pokemon.isEgg||second.pokemon.isEgg||first.raw.isEgg||second.raw.isEgg)throw Error('Un Œuf ne peut pas participer à cet échange.');
 if(first.pokemon.data.id!==second.pokemon.data.id)throw Error('Les deux Pokémon doivent être de la même espèce.');
 if(first.pokemon.experience===second.pokemon.experience)throw Error('Ces deux Pokémon ont déjà la même expérience.');
 for(const entry of [first,second])if(!Number.isSafeInteger(Number(entry.pokemon.experience))||entry.pokemon.experience<0)throw Error('L’expérience de ce Pokémon ne peut pas être échangée.');
}
// Do not call gainExperience: this paid swap must not learn moves, evolve or heal.
function changes(pokemon,experience){
 const old= pokemon.currentHp;
 pokemon.experience=Number(experience);pokemon.level=pokemon.calculateLevelFromExperience(pokemon.experience);pokemon.recalculateStats();
 pokemon.currentHp=Math.max(0,Math.min(Number(old)||0,pokemon.maxHp));
 return{experience:pokemon.experience,level:pokemon.level,current_hp:pokemon.currentHp,current_attack:pokemon.attack,current_defense:pokemon.defense,current_special_attack:pokemon.specialAttack,current_special_defense:pokemon.specialDefense,current_speed:pokemon.speed};
}
function offer(first,second){validate(first,second);const before=[dto(first),dto(second)],expected=[fingerprint(first),fingerprint(second)],a=changes(first.pokemon,before[1].experience),b=changes(second.pokemon,before[0].experience);return{price:PRICE,first:before[0],second:before[1],after:[{...dto(first),...{experience:a.experience,level:a.level}},{...dto(second),...{experience:b.experience,level:b.level}}],expected};}
module.exports={UUID,FIELDS,fingerprint,dto,validate,changes,offer};
