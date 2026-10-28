const { randomUUID } = require('node:crypto');
const catalogue = require('../../../data/game/drifts.json');
const { value, heal, attach, detach } = require('./driftEffects');
const { isShopMap, getShopCatalog, getDepartment } = require('../world/shopCatalog');
const { items: baseItems } = require('../../../data/game/items.json');
const { LobbyError } = require('./lobbyStore');
const { medicineBatch } = require('../items/medicineEffects');
const report = require('./runReport');
const stones = require('../items/stoneEvolution');
const merchant = require('./merchant');
const { validateRepel } = require('../items/repel');
const {getSellPrice}=require('../items/itemSales');
const SLOT_LIMIT = 5;
const prices = { common: 50, rare: 120, epic: 300, legendary: 800, mythic: 2000 };
const types = ['Normal','Fire','Water','Electric','Grass','Ice','Fighting','Poison','Ground','Flying','Psychic','Bug','Rock','Ghost','Dragon','Dark','Steel','Fairy'];
const potions = [{ key: 'drift_potion', name: 'Potion', category: 'heal', price: 100, amount: 20, description: 'Soigne 20 PV hors combat, uniquement un survivant.' },
    { key: 'drift_super_potion', name: 'Super Potion', category: 'heal', price: 300, amount: 60, description: 'Soigne 60 PV hors combat.' }];
const fail = message => { throw new LobbyError('drift_invalid', message); };
function bag(p) { return [...baseItems, ...potions].filter(i => p.items[i.key] > 0).map(i => ({ ...i, sellPrice:getSellPrice(i.key), quantity: p.items[i.key], ...(i.fieldUse?.abilityReroll?{abilityOptions:require('../items/abilityCapsule').decorate(i,p.equipe.pokemons).abilityOptions}:{}), ...(i.category==='evolution'?{evolutions:Object.fromEntries(p.equipe.pokemons.map(poke=>[poke.uuid,stones.target(poke,i.key)]).filter(([,target])=>target))}:{}) })); }
function shop(p) {
    const department=getDepartment(p.currentmap),supplies=!department||department.number===1;
    return { success: true, catalog: [...getShopCatalog({expedition:true,mapName:p.currentmap}).filter(i => i.key !== 'revive'), ...(supplies?potions:[])], items: bag(p), money: p.money, shopMeta:require('../world/shopCatalog').getShopMeta({expedition:true,mapName:p.currentmap}), merchant:supplies?merchant.view(p):null };
}
function requireMutable(p) { if (!p.alive || p.inbattle || ['results','selection'].includes(p.run.phase)) fail('Action indisponible maintenant.'); }
function equip(p, uuid, enabled) {
    requireMutable(p);
    if (typeof enabled !== 'boolean') fail('Choix d’équipement invalide.');
    const d = p.drifts.find(d => d.uuid === uuid); if (!d) fail('Drift introuvable.');
    if (!enabled) { p.equipped = p.equipped.filter(id => id !== uuid); p.ready = false; report.syncDrifts(p); return; }
    if (p.equipped.includes(uuid)) return;
    if (p.equipped.length >= SLOT_LIMIT) fail('Les cinq emplacements sont occupés.');
    if (p.drifts.some(other => other.definitionId === d.definitionId && p.equipped.includes(other.uuid))) fail('Ce Drift est déjà équipé dans une autre rareté.');
    p.equipped.push(uuid); p.ready = false;
    report.syncDrifts(p);
}
function replace(p, uuid, replaceUuid) {
    requireMutable(p);
    const incoming=p.drifts.find(d=>d.uuid===uuid);
    if(!incoming || p.equipped.includes(uuid) || !p.equipped.includes(replaceUuid))fail('Choisis un Drift de ton sac et un emplacement équipé.');
    const next=p.equipped.map(id=>id===replaceUuid?uuid:id);
    const families=next.map(id=>p.drifts.find(d=>d.uuid===id)?.definitionId);
    if(new Set(families).size!==families.length)fail('Un Drift de cette famille est déjà équipé.');
    p.equipped=next;p.ready=false;report.syncDrifts(p);
}
function salePrice(d) { const strength=require('./driftStrength');return Math.floor(prices[d.rarity]*strength.points(d)/strength.weights[d.rarity]); }
function remove(p, uuid, sell = false) {
    requireMutable(p);
    if (sell && p.equipped.includes(uuid)) fail('Retire ce Drift avant de le vendre.');
    if (sell && (p.run.phase !== 'exploration' || !isShopMap(p.currentmap))) fail('La revente se fait dans une boutique, pendant l’exploration.');
    const index = p.drifts.findIndex(d => d.uuid === uuid); if (index < 0) fail('Drift introuvable.');
    const earned = sell ? Math.floor(salePrice(p.drifts[index]) * (1 + value(p, 53) / 100)) : 0;
    if (sell) p.money += earned;
    p.equipped=p.equipped.filter(id=>id!==uuid);
    report.driftRemoved(p,p.drifts[index],sell,earned);
    p.drifts.splice(index, 1); p.ready = false;
}
function buy(p, key, quantity) {
    requireMutable(p);
    if (p.run.phase !== 'exploration' || !isShopMap(p.currentmap)) fail('Rejoins une boutique.');
    const item = shop(p).catalog.find(i => i.key === key);
    if (!item || !Number.isInteger(quantity) || quantity < 1 || quantity > 99) fail('Achat invalide.');
    if (item.purchaseLimit && (p.items[key] || 0) + quantity > item.purchaseLimit) fail('Tu possèdes déjà cette canne. Un seul exemplaire suffit.');
    const cost = item.price * quantity; if (p.money < cost) fail('Monnaie insuffisante.');
    p.money -= cost; p.items[key] = (p.items[key] || 0) + quantity;
    report.increment(p,'moneySpent',cost);report.event(p,'purchase',`${quantity} × ${item.name} acheté${quantity>1?'s':''} · −${cost} ₽.`);
    return { ...shop(p), progression: { money: p.money } };
}
function sell(p,key,quantity){
    requireMutable(p);
    if(p.run.phase!=='exploration'||!isShopMap(p.currentmap))fail('Rejoins une boutique.');
    if(!Number.isInteger(quantity)||quantity<1||quantity>99)fail('Quantité invalide.');
    const price=getSellPrice(key),item=bag(p).find(i=>i.key===key);
    if(!price)fail('Cet objet ne peut pas être vendu.');
    if(!item||item.quantity<quantity)fail('Tu ne possèdes pas assez de cet objet.');
    const totalPrice=price*quantity;
    if(!Number.isSafeInteger(p.money+totalPrice))fail('Tu ne peux plus recevoir d’argent.');
    p.items[key]-=quantity;p.money+=totalPrice;
    report.increment(p,'moneyEarned',totalPrice);report.event(p,'sale',`${quantity} × ${item.name} vendu${quantity>1?'s':''} · +${totalPrice} ₽.`);
    return {...shop(p),itemKey:key,quantity,unitPrice:price,totalPrice,progression:{money:p.money}};
}
function usePotion(p, key, uuid, random = Math.random, quantity=1, ivConfirmation=null) {
    requireMutable(p);
    const item = [...potions, ...baseItems].find(i => i.key === key), pokemon = p.equipe.pokemons.find(a => a.uuid === uuid);
    if (p.run.phase !== 'exploration' && !((item?.fieldUse?.effort || item?.fieldUse?.ivReroll || item?.fieldUse?.effortReset || item?.fieldUse?.abilityReroll || item?.fieldUse?.natureReroll) && ['preparation','tournament','colosseum_ready'].includes(p.run.phase))) fail('Soins automatiques entre les rounds.');
    if (!item || item.revive || !pokemon || (pokemon.currentHp <= 0 && !pokemon.riftFainted) || !(p.items[key] > 0)) fail('Ce soin est inutilisable.');
    if(!Number.isInteger(quantity)||quantity<1||quantity>99||quantity>1&&!(item.fieldUse?.effort?.amount>0))fail('Quantité invalide.');
    try { require('../items/ivRerollConfirmation').requireIvRerollConfirmation(pokemon,key,ivConfirmation); }
    catch(error){const refusal=new LobbyError('iv_confirmation_required',error.message);refusal.ivConfirmationRequired=error.ivConfirmationRequired;throw refusal;}
    let result;
    if (pokemon.riftFainted && pokemon.currentHp <= 0) {
        const effect=item.fieldUse || item;
        const amount=effect.amount || effect.heal || Math.floor(pokemon.maxHp*(effect.healFraction || 0));
        if (!(amount>0)) fail('Il faut un soin de PV pour réveiller ce Pokémon.');
        pokemon.currentHp=Math.min(pokemon.maxHp,amount); pokemon.status='normal'; delete pokemon.riftFainted;
        result={currentHp:pokemon.currentHp,status:'normal'};
    } else if (item.category === 'heal') {
        if (pokemon.currentHp >= pokemon.maxHp) fail('Cet objet n’aurait aucun effet.');
        result = { currentHp: Math.min(pokemon.maxHp, pokemon.currentHp + item.amount), status: pokemon.status };
    } else {
        try { result = medicineBatch(pokemon,key,quantity,p.items[key],random); } catch (error) { fail(error.message); }
    }
    if (result.ev || result.iv || result.movePp || result.passiveAbility || result.nature) {
        const {trainingChange,consumed,...updated}=result;Object.assign(pokemon,updated); p.items[key]-=consumed||1; p.ready=false; report.syncTeam(p);
        report.event(p,'item',`${consumed||1} × ${item.name} utilisé sur ${pokemon.truename || pokemon.name}.`);
        return {success:true,items:bag(p),equipe:p.equipe,trainingChange,consumed:consumed||1};
    }
    attach(p.equipe.pokemons, p, false, random);
    try { heal(pokemon, result.currentHp - pokemon.currentHp); pokemon.status = result.status; } finally { detach(p.equipe.pokemons); }
    if (random() >= value(p, 52) / 100) p.items[key]--;
    report.increment(p,'potionsUsed');report.event(p,'heal',`${item.name} utilisée sur ${pokemon.truename || pokemon.name}.`);
    return { success: true, items: bag(p), equipe: p.equipe };
}
function useRepel(p, key) {
    requireMutable(p);
    if (p.run.phase !== 'exploration') fail('Le Repousse s’utilise pendant l’exploration.');
    let steps;
    try { steps = validateRepel(p, key); } catch (error) { fail(error.message); }
    if (!(p.items[key] > 0)) fail('Cet objet n’est plus dans ton sac.');
    p.items[key]--; p.repelSteps = steps;
    return { success: true, items: bag(p), repelSteps: steps };
}
function useMachine(p, data) {
    requireMutable(p);
    if (!['exploration','preparation','tournament','colosseum_ready'].includes(p.run.phase)) fail('Apprentissage indisponible maintenant.');
    const pokemon = p.equipe.pokemons.find(poke=>poke.uuid===data?.pokemonUuid);
    if (!(p.items[data?.itemKey]>0)) fail('Cette CS n’est plus dans ton sac.');
    let result;
    try { result = require('../items/machines').teachMachine(pokemon,data?.itemKey,data); }
    catch (error) { fail(error.message); }
    Object.assign(pokemon,result);p.items[data.itemKey]--;p.ready=false;report.syncTeam(p);
    report.event(p,'item',`${baseItems.find(i=>i.key===data.itemKey).name} utilisée sur ${pokemon.truename || pokemon.name}.`);
    return {success:true,equipe:p.equipe,items:bag(p)};
}
function drop(p, source, random = Math.random) {
    const chance = { wild: .15, capture: .15, trainer: .5, arena: 1 }[source] || 0;
    const loot = [];
    if (random() < Math.min(1, chance * (1 + value(p, 44) / 100))) {
        const weights = source === 'arena' ? [1500, 3000, 3000, 2000, 500] : source === 'trainer' ? [3500, 3300, 2000, 1000, 200] : catalogue.rarities.map(r => r.weight);
        let roll = random() * 10000, index = 0;
        for (; index < 4; index++) { roll -= weights[index]; if (roll < 0) break; }
        const rarity = catalogue.rarities[index].key;
        const candidates = catalogue.definitions.filter(d => d.values[rarity] !== null);
        const definition = candidates[Math.floor(random() * candidates.length)];
        const drift = { uuid: randomUUID(), definitionId: definition.id, rarity, element: ['DRF-001', 'DRF-014'].includes(definition.id) ? types[Math.floor(random() * types.length)] : null };
        require('./fusion').acquire(p,drift,source); loot.push(definition.name);
    }
    if (source !== 'capture' && source !== 'wild' && random() < Math.min(1, .2 * (1 + value(p, 45) / 100))) {
        const key = random() < .5 ? 'pokeball' : 'drift_potion'; p.items[key] = (p.items[key] || 0) + 1; loot.push(key === 'pokeball' ? 'Poké Ball' : 'Potion');
        report.event(p,'item',`Objet trouvé : ${key==='pokeball'?'Poké Ball':'Potion'}.`);
    }
    if (source === 'wild' || source === 'capture') {
        const item = require('../items/wildLoot').awardExpedition(p, random,1+value(p,45)/100);
        if (item) { loot.push(item.name); report.event(p,'item',`Objet trouvé : ${item.name}${item.unique?' · unique':''}.`); }
        for(const crystal of require('../items/wildCrystals').awardExpedition(p,random)){
            loot.push(crystal.name);report.event(p,'item',`Objet trouvé : ${crystal.name}.`);
        }
    }
    return loot;
}
function evolve(p,key,uuid) {
    requireMutable(p);
    if (!['exploration','preparation','tournament','colosseum_ready'].includes(p.run.phase)) fail('Évolution indisponible maintenant.');
    const item=baseItems.find(i=>i.key===key && i.category==='evolution'),pokemon=p.equipe.pokemons.find(poke=>poke.uuid===uuid);
    if (!item || !(p.items[key]>0) || !stones.target(pokemon,key)) fail('Cette pierre ne convient pas à ce Pokémon.');
    const evolution=stones.evolve(pokemon,key);p.items[key]--;p.ready=false;report.syncTeam(p);
    return {success:true,evolution,equipe:p.equipe,items:bag(p)};
}
module.exports = { useMachine, useRepel, salePrice, replace, evolve, SLOT_LIMIT, prices, bag, shop, equip, remove, buy, sell, usePotion, drop, requireMutable, fail };
