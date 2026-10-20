// A fixed circuit shared by every player. No player roster, clock or battle RNG
// participates in these choices, so a reconnect never rerolls the challenge.
const dex=new Map(require('../../../data/game/pokedex.json').map(p=>[p.id,p]));
const learnsets = require('../../../data/game/pokemonData.json');
const slug = name => name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
const STYLES = {
    tempo: { name:'Assaut rapide', description:'Priorités et Pokémon mobiles pour maintenir la pression.', hint:'Garde un compagnon capable d’encaisser et surveille les priorités.', attacks:['Quick Attack','Aqua Jet','Mach Punch','Bullet Punch','Ice Shard'], support:['Tailwind'], abilities:['Technician','Speed Boost'],
        middle:[17,20,22,42,190,264,277,288,405,215,193,291], late:[18,20,22,169,424,264,277,405,461,469,291,335] },
    assault: { name:'Percée physique', description:'Des attaques physiques de types complémentaires.', hint:'Une bonne défense physique et des résistances variées facilitent les échanges.', attacks:['Mach Punch','Rock Tomb'], support:[], abilities:[], middle:[67,106,105,123,85,127,214,237],late:[68,106,105,212,85,127,214,237] },
    control: { name:'Contrôle de la vitesse', description:'Ralentissements et paralysie pour reprendre l’initiative.', hint:'Prévois une réponse aux altérations et plusieurs attaquants.', attacks:['Icy Wind','Electroweb','Bulldoze','Rock Tomb'], support:['Thunder Wave','Glare','Tailwind'], abilities:[],
        middle:[180,82,288,354,203,221,215,193,22,207], late:[181,462,264,354,203,473,461,469,398,472] },
    bulwark: { name:'Ligne défensive', description:'Un spécialiste renforce la résistance de partenaires capables de riposter.', hint:'Observe la protection utilisée puis alterne attaques physiques et spéciales.', attacks:[], support:['Reflect','Light Screen','Iron Defense','Amnesia'], abilities:[],
        middle:[95,299,304,221,184,364,305,113,111,375,338], late:[208,476,306,473,184,365,242,464,376,338,213,232] },
    rain: { name:'Équipe de pluie', description:'La pluie soutient les attaques Eau et certains talents de l’équipe.', hint:'La météo profite aux deux camps. Garde une résistance Eau et une réponse Électrik ou Plante.', attacks:[], support:['Rain Dance'], abilities:['Drizzle','Swift Swim','Rain Dish'], weather:'rain',
        middle:[61,271,279,170,226,55,184,400,87,195,419,457], late:[186,272,279,171,226,55,184,400,87,195,419,457] },
    sun: { name:'Équipe de soleil', description:'Le soleil soutient le Feu et les talents de partenaires Plante.', hint:'Prépare une résistance Feu ; les attaques Eau deviennent moins puissantes sous le soleil.', attacks:[], support:['Sunny Day'], abilities:['Drought','Chlorophyll','Solar Power'], weather:'sun',
        middle:[44,70,156,218,274,357,114,192,77,402], late:[45,71,157,219,275,357,465,192,78,324,3,6] },
    disruption: { name:'Briseurs de préparation', description:'Un spécialiste peut annuler les boosts ou gêner les capacités de statut.', hint:'Identifie le spécialiste avant d’investir plusieurs tours dans tes boosts.', attacks:[], support:['Haze','Taunt'], abilities:[],
        middle:[89,110,42,354,195,178,198,355,203,308], late:[89,110,169,354,195,178,430,477,203,308,130,212] },
    setup: { name:'Montée en puissance', description:'Un partenaire peut se renforcer pendant que les autres assurent la couverture.', hint:'Maintiens la pression ou interromps sa préparation avant qu’il prenne l’avantage.', attacks:[], support:['Swords Dance','Dragon Dance','Bulk Up','Calm Mind','Nasty Plot'], abilities:[],
        middle:[67,281,308,51,105,123,192,85,279,404], late:[68,282,308,330,212,448,350,149,373,230,445,59] },
    attrition: { name:'Usure et récupération', description:'Un spécialiste joue les altérations ou Vampigraine, avec des attaquants pour conclure.', hint:'Change de partenaire au bon moment et évite de prolonger les échanges défavorables.', attacks:['Giga Drain','Drain Punch'], support:['Leech Seed','Will-O-Wisp','Toxic'], abilities:[],
        middle:[44,315,93,89,355,200,356,114,193,111,455], late:[45,407,94,89,477,429,465,469,464,455,73,326] }
};
const OPENING = {
    1:{key:'tempo',ids:[161,163]}, 2:{key:'assault',ids:[66,403]},
    3:{key:'control',ids:[179,283]}, 4:{key:'bulwark',ids:[74,304]},
    6:{key:'control',ids:[180,271,459]}, 7:{key:'attrition',ids:[44,315,353]},
    8:{key:'setup',ids:[67,281,308]}, 9:{key:'bulwark',ids:[95,299,329,338]}
};
const CYCLE = ['rain','sun','disruption','tempo','setup','attrition','control','bulwark'];
const GUARDIAN_STYLES = ['bulwark','attrition','control','sun','disruption','setup'];
const GUARDIAN_TEAMS = [
    [185,75,208,112,95,76], [45,49,71,89,169,407], [26,171,181,121,466,479],
    [6,59,229,169,398,467], [196,94,65,429,477,282], [230,212,330,376,448,445]
];
function supports(id,name) {
    if(!learnsets[id]?.includes(slug(name)))return false;
    const base=dex.get(id).base, physical=base.Attack>=base['Sp. Attack'];
    return !(physical&&['Calm Mind','Nasty Plot'].includes(name)) && !(!physical&&['Swords Dance','Dragon Dance','Bulk Up'].includes(name));
}
function encounter(wave) {
    const size=Math.min(6,2+Math.floor((wave-1)/4)), guardian=wave%5===0;
    const guardianIndex=(wave/5-1)%6;
    const key=guardian?GUARDIAN_STYLES[guardianIndex]:OPENING[wave]?.key || CYCLE[((wave-1)-Math.floor((wave-1)/5)-8)%CYCLE.length];
    const style=STYLES[key];
    let ids;
    if(guardian)ids=GUARDIAN_TEAMS[guardianIndex].slice(0,size);
    else if(OPENING[wave])ids=OPENING[wave].ids.slice(0,size);
    else {
        const pool=wave<=15?style.middle:style.late, offset=Math.floor((wave-11)/10)*3;
        ids=Array.from({length:size},(_,i)=>pool[(offset+i)%pool.length]);
    }
    // Only one dedicated support specialist: later partners keep offensive
    // coverage, avoiding a succession of recovery/status stalls.
    const preferredSupport=wave>=6?style.support.find(name=>ids.some(id=>supports(id,name))):null;
    const supportIndex=preferredSupport?ids.findIndex(id=>supports(id,preferredSupport)):-1;
    return { key, strategy:{key,name:style.name,description:wave<=5?'Deux profils complémentaires pour les premiers échanges.':style.description,hint:style.hint},
        slots:ids.map((id,index)=>({id,key,attacks:style.attacks,support:index===supportIndex?style.support:[],
            abilities:style.abilities,weather:style.weather,role:index===supportIndex?'Spécialiste du style':'Couverture offensive'})) };
}
module.exports={encounter,STYLES};
