const { growthSnapshot, levelGrowth } = require('../models/levelGrowth');
const { randomUUID } = require('node:crypto');
const effects = require('./driftEffects');
const report = require('./runReport');
const { items } = require('../../../data/game/items.json');
const definitions = [
    { key:'rotation', name:'Deux compagnons, deux victoires', description:'Gagne des combats sauvages avec deux Pokémon différents qui ont réellement attaqué.', goal:2, items:['shell_bell','leftovers','life_orb'] },
    { key:'capture', name:'De nouveaux alliés', description:'Capture deux espèces différentes pendant cette exploration.', goal:2, items:['eviolite','expert_belt','assault_vest'] },
    { key:'trainer', name:'Relève un défi', description:'Bats un dresseur pendant l’exploration. Les nouveaux rivaux t’attendent au village et sur les routes.', goal:1, items:['expert_belt','leftovers','life_orb'] }
];
function stage(c) { return Math.max(1, Math.min(100, Math.floor(c.stage || 1))); }
function details(c) {
    const base = definitions.find(d => d.key === c.key);
    const tier = stage(c), minimumLevel = tier === 1 ? 0 : Math.min(60, 5 + (tier - 2) * 3);
    const d = { ...base, tier, minimumLevel, levels:Math.min(3,tier), money:Math.min(1000,(tier-1)*75),
        balls:Math.min(12,tier+2), potions:Math.min(6,tier+1), ball:tier>=3?'hyperball':tier===2?'superball':'pokeball',
        potion:tier>=2?'drift_super_potion':'drift_potion', item:base.items[Math.min(2,tier-1)] };
    d.itemName = items.find(i => i.key === d.item).name;
    if (tier > 1) {
        if (c.key === 'rotation') {
            d.goal = Math.min(5,tier+1); d.name = 'Une équipe qui combat';
            d.description = `Gagne ${d.goal} combats sauvages contre des Pokémon de niveau ${minimumLevel} ou plus, avec ${d.goal} compagnons différents ayant réellement attaqué. Une victoire crédite un compagnon.`;
        } else if (c.key === 'capture') {
            d.goal = Math.min(6,tier+1); d.name = 'Élargis ton bestiaire';
            d.description = `Bats ou capture ${d.goal} espèces sauvages différentes de niveau ${minimumLevel} ou plus. Les victoires comptent aussi lorsque ton équipe est complète.`;
        } else {
            d.goal = Math.min(8,tier); d.name = 'Des adversaires plus coriaces';
            d.description = `Gagne ${d.goal} combats contre des sauvages ou des dresseurs ayant au moins un Pokémon de niveau ${minimumLevel} ou plus. Les captures ne comptent pas.`;
        }
    }
    return d;
}
function fresh(key, tier=1) { return {id:randomUUID(),key,stage:tier,progress:[],claimed:null}; }
function create() { return definitions.map(d=>fresh(d.key)); }
// Previously claimed contracts advance once, without granting their reward again.
function migrate(p) {
    if (p.run?.phase !== 'exploration') return;
    p.contracts?.forEach((c,i) => { if (c.claimed) p.contracts[i] = fresh(c.key, stage(c)+1); });
}
function view(p) {
    return (p.contracts || []).map(c=>{const d=details(c);return {
        id:c.id,key:c.key,stage:d.tier,name:d.name,description:d.description,progress:c.progress.length,goal:d.goal,claimed:c.claimed,
        complete:c.progress.length>=d.goal,bonusMoney:d.money,
        rewards:[{key:'training',name:'Entraîner mes réserves',description:`${d.levels} niveau${d.levels>1?'x':''} pour chaque réserviste vivant sous le niveau 100 (hors premier Pokémon).`,available:p.equipe.pokemons.slice(1).some(poke=>!effects.isDead(poke)&&poke.level<100)},
            {key:'supplies',name:'Kit de voyage',description:`${d.balls} ${d.ball==='hyperball'?'Hyper Balls':d.ball==='superball'?'Super Balls':'Poké Balls'} et ${d.potions} ${d.potion==='drift_super_potion'?'Super Potions':'Potions'}.`,available:true},
            {key:'item',name:d.itemName,description:'Un objet stratégique à équiper depuis la fiche du Pokémon.',available:true}]
    };});
}
function record(p,battle,winner,reason) {
    if(p.run?.phase!=='exploration' || winner!==p || !p.contracts || !['finished','captured'].includes(reason)) return;
    if (battle.now && battle.now() >= p.run.endsAt) return;
    battle.contractRecorded ||= new Set();
    if (battle.contractRecorded.has(p.userId)) return;
    battle.contractRecorded.add(p.userId);
    // NPC teams are pruned on K.O.; use the defeated originals, including in older checkpoints.
    const targets = battle.originalTeams?.get(battle.b) || battle.originals?.filter(poke=>battle.rewarded?.has(poke.uuid)) || battle.b?.equipe?.pokemons || [];
    const target = battle.capturedPokemon || targets[0];
    const enemyLevel = Math.max(0,...targets.map(poke=>poke.level),target?.level||0);
    for (const c of p.contracts) {
        if (c.claimed) continue;
        const d=details(c), previous=c.progress.length;
        if (previous>=d.goal || enemyLevel<d.minimumLevel) continue;
        let values=[];
        if(c.key==='rotation' && reason==='finished' && battle.type==='wild')
            values=[...(battle.contractContributors || [])].filter(id=>!c.progress.includes(id)).slice(-1);
        if(c.key==='capture' && battle.type==='wild' && target && (reason==='captured'||d.tier>1))
            values=[String(target.data.id)];
        if(c.key==='trainer' && reason==='finished' &&
            ((['trainer','arena'].includes(battle.type)&&battle.npcKey)||(d.tier>1&&battle.type==='wild')))
            values=[battle.id || battle.npcKey];
        c.progress=[...new Set([...c.progress,...values])].slice(0,d.goal);
        if(previous<d.goal&&c.progress.length===d.goal) report.event(p,'contract',`Contrat accompli : ${d.name} · palier ${d.tier}. Choisis ta récompense dans le carnet.`);
    }
}
function claim(p,data,now=Date.now()) {
    const {requireMutable,fail}=require('./economy');requireMutable(p);
    if(p.run.phase!=='exploration'||now>=p.run.endsAt)fail('Les contrats se récupèrent pendant l’exploration.');
    const c=p.contracts?.find(c=>c.id===data?.contractId);
    if(!c||c.claimed)fail('Ce contrat ne peut pas être récupéré.');
    const d=details(c);
    if(c.progress.length<d.goal)fail('Ce contrat ne peut pas être récupéré.');
    if(!['training','supplies','item'].includes(data?.reward))fail('Choisis une des récompenses proposées.');
    const reserves=p.equipe.pokemons.slice(1).filter(poke=>!effects.isDead(poke)&&poke.level<100);
    if(data.reward==='training'&&!reserves.length)fail('Ajoute un Pokémon vivant sous le niveau 100 en réserve ou choisis une autre récompense.');
    const growth=[];
    if(data.reward==='training')for(const poke of reserves){const beforeGrowth=growthSnapshot(poke),before=poke.level,xp=poke.getNextLevelExpForLevel(Math.min(100,before+d.levels))-poke.experience;poke.gainExperience(xp,{deferEvolution:true});const entry=levelGrowth(poke,beforeGrowth);if(entry)growth.push(entry);report.increment(p,'xpGained',xp);report.increment(p,'levelsGained',poke.level-before);}
    if(data.reward==='supplies'){p.items[d.ball]=(p.items[d.ball]||0)+d.balls;p.items[d.potion]=(p.items[d.potion]||0)+d.potions;}
    if(data.reward==='item')p.items[d.item]=(p.items[d.item]||0)+1;
    p.money+=d.money;report.increment(p,'moneyEarned',d.money);
    c.claimed=data.reward;p.ready=false;report.syncTeam(p);
    report.event(p,'contract',`Récompense reçue : ${d.name} · palier ${d.tier} · ${data.reward==='training'?'entraînement des réserves':data.reward==='supplies'?'kit de voyage':d.itemName}${d.money?` · +${d.money} ₽`:''}.`);
    p.contracts[p.contracts.indexOf(c)]=fresh(c.key,d.tier+1);
    return {success:true,levelGrowth:growth};
}
module.exports={create,view,record,claim,migrate};
