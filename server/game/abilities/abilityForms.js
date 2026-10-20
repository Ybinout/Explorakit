const {getAbilityName,hasAbility,isWeatherSuppressed}=require('./abilityEngine');
const {forms}=require('../../../data/game/ability_move_traits.gen7.json');
const FORMS = Object.freeze({
    'Castform-Sunny':{id:351,label:'Forme Solaire',sprite:10013,types:['Fire']},
    'Castform-Rainy':{id:351,label:'Forme Eau de Pluie',sprite:10014,types:['Water']},
    'Castform-Snowy':{id:351,label:'Forme Blizzard',sprite:10015,types:['Ice']},
    'Darmanitan-Zen':{id:555,label:'Mode Transe',sprite:10017},
    'Aegislash-Blade':{id:681,label:'Forme Assaut',sprite:10026},
    'Wishiwashi-School':{id:746,label:'Forme Banc',sprite:10127},
    'Minior':{id:774,label:'Noyau',sprite:10136},
    'Minior-Meteor':{id:774,label:'Météore',sprite:774},
    'Zygarde-Complete':{id:718,label:'Forme Parfaite',sprite:10120},
    'Greninja-Ash':{id:658,label:'Synergie',sprite:10117}
});
const ABILITIES=['Forecast','Battle Bond','Disguise','Schooling','Shields Down','Stance Change','Zen Mode','Power Construct','Multitype','RKS System','Illusion'];
const statKey={attack:'atk',defense:'def',specialAttack:'spa',specialDefense:'spd',speed:'spe'};
function memory(p) { if(!p.__abilityMemory)p.__abilityMemory={}; return p.__abilityMemory; }
function setForm(p,key,messages=[]) {
    const data=p.__battle||(p.__battle={});
    if(data.abilityForm===key)return;
    data.abilityForm=key;
    data.formSpriteId=FORMS[key]?.sprite||null;
    data.formLabel=FORMS[key]?.label||null;
    data.formTypes=key?(FORMS[key]?.types||forms[key]?.types):null;
    if(key)messages.push(`${p.truename||p.name} : ${FORMS[key].label}.`);
}
function sync(p,phase,messages=[],move=null,battleState=null,opponent=null) {
    if(!p || p.currentHp<=0)return;
    const ability=getAbilityName(p),id=p.data?.id,data=p.__battle||(p.__battle={}),mem=memory(p),ratio=p.currentHp/p.maxHp;
    let key=null;
    const forecast = id===351 && (ability==='Forecast' || data.abilityForm?.startsWith('Castform-'));
    if (id===351 && p.passiveAbility==='Forecast' && !data.forecastManaged) {
        // Migrate transient state created by the old Forecast implementation once.
        if (data.tempTypes?.length===1 && ['Fire','Water','Ice'].includes(data.tempTypes[0])) data.tempTypes=[];
        data.forecastManaged=true;
    }
    if (id===351 && ability==='Forecast' && !p.__moveAndStatOverrides) {
        const weather=isWeatherSuppressed(p,opponent)?null:battleState?.weather?.kind;
        key=({sun:'Castform-Sunny',rain:'Castform-Rainy',hail:'Castform-Snowy'})[weather]||null;
    }
    if(ability==='Schooling' && id===746 && p.level>=20 && ratio>.25)key='Wishiwashi-School';
    if(ability==='Zen Mode' && id===555 && ratio<=.5)key='Darmanitan-Zen';
    if(ability==='Shields Down' && id===774)key=ratio>.5?'Minior-Meteor':'Minior';
    if(ability==='Stance Change' && id===681) {
        key=data.abilityForm||null;
        if(phase==='move' && move?.combat?.damage_class!=='status')key='Aegislash-Blade';
        if(phase==='move' && move?.ename==="King's Shield")key=null;
    }
    if(ability==='Battle Bond' && id===658) {
        if(phase==='ko')mem.bond=true;
        if(mem.bond)key='Greninja-Ash';
    }
    if(ability==='Power Construct' && id===718) {
        if(phase==='end' && ratio<=.5 && !mem.construct) {
            mem.construct=true;mem.originalMaxHp=p.maxHp;
            const next=Math.floor((2*forms['Zygarde-Complete'].stats.hp+(p.k||1)*(p.iv?.hp||0)+Math.floor((p.ev?.hp||0)/4))*p.level/100+p.level+10);
            p.currentHp+=Math.max(0,next-p.maxHp);p.maxHp=Math.max(p.maxHp,next);
        }
        if(mem.construct)key='Zygarde-Complete';
    }
    if(phase==='entry' && mem.disguiseBroken && ability==='Disguise')data.disguiseBroken=true;
    if(phase==='entry' && ability==='Illusion') {
        const last=p.__abilityTeam?.filter(other=>other.currentHp>0).at(-1);
        data.illusion=last && last!==p?{id:last.data.id,name:last.name||last.truename}:null;
    }
    if(ability!=='Illusion')data.illusion=null;
    if (forecast && data.abilityForm!==key) {
        data.tempTypes=[];
        if (!key && data.abilityForm) messages.push(`${p.truename||p.name} reprend sa forme Normale avec Météo.`);
    }
    setForm(p,key,messages);
    if(ability==='Disguise' && mem.disguiseBroken) {
        data.disguiseBroken=true;data.formLabel='Déguisement brisé';data.formSpriteId=10143;
    }
    if(['Multitype','RKS System'].includes(ability)) {
        const item=require('../battle/battleResources').getItemDefinition(p.heldItem);
        const type=item?.type || item?.pokemon_type;
        data.formTypes=type && item?.battle_effect===(ability==='Multitype'?'plate':'memory')?[type]:null;
    }
}
function syncWeatherForms(a,b,battleState,messages=[]) {
    for (const [p,other] of [[a,b],[b,a]]) {
        if (p?.data?.id===351 && (p.passiveAbility==='Forecast' || p.__battle?.abilityForm?.startsWith('Castform-')))
            sync(p,'weather',messages,null,battleState,other);
    }
    return messages;
}
function stat(p,name) {
    const base=forms[p.__battle?.abilityForm]?.stats?.[statKey[name]];
    if(base==null)return null;
    if(typeof p.calculateStat==='function')return p.calculateStat(base,p.iv[name],name);
    return Math.floor(2*base*p.level/100+5);
}
function intercept(p,attacker,damage) {
    if(!(damage>0) || p.data?.id!==778 || !hasAbility(p,'Disguise') || memory(p).disguiseBroken
        || require('./abilityEngine').ignoresDefenderAbility(attacker,p))return false;
    memory(p).disguiseBroken=true;p.__battle.disguiseBroken=true;p.__battle.formLabel='Déguisement brisé';
    p.__battle.formSpriteId=10143;return true;
}
function clear(p) {
    const old=p.__abilityMemory?.originalMaxHp;
    if(old) {const alive=p.currentHp>0;p.currentHp=alive?Math.max(1,p.currentHp-(p.maxHp-old)):0;p.maxHp=old;}
    delete p.__abilityMemory;
    delete p.__abilityTeam;
}
function attachTeam(team) {
    for(const p of team||[])Object.defineProperty(p,'__abilityTeam',{value:team,writable:true,configurable:true,enumerable:false});
}
module.exports={ABILITIES,FORMS,sync,syncWeatherForms,stat,intercept,clear,attachTeam};
