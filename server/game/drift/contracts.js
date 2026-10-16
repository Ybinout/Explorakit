const { randomUUID } = require('node:crypto');
const effects = require('./driftEffects');
const report = require('./runReport');
const definitions = [
    { key:'rotation', name:'Deux compagnons, deux victoires', description:'Gagne des combats sauvages avec deux Pokémon différents qui ont réellement attaqué.', goal:2, item:'shell_bell', itemName:'Grelot Coque' },
    { key:'capture', name:'De nouveaux alliés', description:'Capture deux espèces différentes pendant cette exploration.', goal:2, item:'eviolite', itemName:'Évoluroc' },
    { key:'trainer', name:'Relève un défi', description:'Bats un dresseur pendant l’exploration. Les nouveaux rivaux t’attendent au village et sur les routes.', goal:1, item:'expert_belt', itemName:'Ceinture Pro' }
];
function create() { return definitions.map(d=>({id:randomUUID(),key:d.key,progress:[],claimed:null})); }
function view(p) {
    return (p.contracts || []).map(c=>{const d=definitions.find(d=>d.key===c.key);return {
        id:c.id,key:c.key,name:d.name,description:d.description,progress:c.progress.length,goal:d.goal,claimed:c.claimed,
        complete:c.progress.length>=d.goal,
        rewards:[{key:'training',name:'Entraîner mes réserves',description:'Un niveau pour chaque réserviste vivant (le premier Pokémon de l’équipe est exclu).',available:p.equipe.pokemons.slice(1).some(poke=>!effects.isDead(poke))},
            {key:'supplies',name:'Kit de voyage',description:'3 Poké Balls et 2 Potions.',available:true},
            {key:'item',name:d.itemName,description:'Un objet stratégique à équiper depuis la fiche du Pokémon.',available:true}]
    };});
}
function record(p,battle,winner,reason) {
    if(p.run?.phase!=='exploration' || winner!==p || !p.contracts) return;
    let key,values=[];
    if(reason==='captured'&&battle.type==='wild'&&battle.capturedPokemon){key='capture';values=[String(battle.capturedPokemon.data.id)];}
    if(reason==='finished'&&battle.type==='wild'){key='rotation';values=[...(battle.contractContributors || [])].filter(id=>!p.contracts.find(c=>c.key==='rotation').progress.includes(id)).slice(-1);}
    if(reason==='finished'&&['trainer','arena'].includes(battle.type)&&battle.npcKey){key='trainer';values=[battle.npcKey];}
    const c=p.contracts.find(c=>c.key===key);if(!c || c.claimed) return;
    const goal=definitions.find(d=>d.key===key).goal,previous=c.progress.length;
    c.progress=[...new Set([...c.progress,...values])].slice(0,goal);
    if(previous<goal&&c.progress.length===goal) report.event(p,'contract','Contrat accompli : '+definitions.find(d=>d.key===key).name+'. Choisis ta récompense dans le carnet.');
}
function claim(p,data,now=Date.now()) {
    const {requireMutable,fail}=require('./economy');requireMutable(p);
    if(p.run.phase!=='exploration'||now>=p.run.endsAt)fail('Les contrats se récupèrent pendant l’exploration.');
    const c=p.contracts?.find(c=>c.id===data?.contractId),d=definitions.find(d=>d.key===c?.key);
    if(!c||c.claimed||c.progress.length<d.goal)fail('Ce contrat ne peut pas être récupéré.');
    if(!['training','supplies','item'].includes(data?.reward))fail('Choisis une des récompenses proposées.');
    const reserves=p.equipe.pokemons.slice(1).filter(poke=>!effects.isDead(poke));
    if(data.reward==='training'&&!reserves.length)fail('Ajoute un Pokémon vivant en réserve ou choisis une autre récompense.');
    if(data.reward==='training')for(const poke of reserves){const xp=poke.getNextLevelExpForLevel(poke.level+1)-poke.experience;poke.gainExperience(xp);report.increment(p,'xpGained',xp);report.increment(p,'levelsGained');}
    if(data.reward==='supplies'){p.items.pokeball=(p.items.pokeball||0)+3;p.items.drift_potion=(p.items.drift_potion||0)+2;}
    if(data.reward==='item')p.items[d.item]=(p.items[d.item]||0)+1;
    c.claimed=data.reward;p.ready=false;report.syncTeam(p);report.event(p,'contract',`Récompense reçue : ${d.name} · ${data.reward==='training'?'entraînement des réserves':data.reward==='supplies'?'kit de voyage':d.itemName}.`);
    return {success:true};
}
module.exports={create,view,record,claim};
