const items=require('../../../data/game/items.json').items;
const stats={hp:'PV',attack:'Attaque',defense:'Défense',specialAttack:'Attaque Spéciale',specialDefense:'Défense Spéciale',speed:'Vitesse'};
function requireIvRerollConfirmation(pokemon,itemKey,confirmation) {
    const stat=items.find(i=>i.key===itemKey)?.fieldUse?.ivReroll;
    if(!stat||!pokemon||pokemon.isEgg||!(pokemon.currentHp>0))return;
    const before=pokemon.iv?.[stat];
    if(!Number.isInteger(before)||before<0||before>31)return;
    if(confirmation?.stat===stat&&confirmation.before===before)return;
    if(before<26&&confirmation==null)return;
    const error=Error(`IV ${stats[stat]} : ${before}/31. Confirme cette relance : la nouvelle valeur peut être plus basse.`);
    error.ivConfirmationRequired={pokemonUuid:pokemon.uuid,stat,before};
    throw error;
}
module.exports={requireIvRerollConfirmation};
