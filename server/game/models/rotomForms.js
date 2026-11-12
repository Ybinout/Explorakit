const base=require('../../../data/game/pokedex.json').find(p=>p.id===479);
const FORMS=Object.freeze({
 heat:{label:'Motisma Chaleur',species:'Rotom-Heat',type:'Fire',move:'Overheat',sprite:10008},
 wash:{label:'Motisma Lavage',species:'Rotom-Wash',type:'Water',move:'Hydro Pump',sprite:10009},
 frost:{label:'Motisma Froid',species:'Rotom-Frost',type:'Ice',move:'Blizzard',sprite:10010},
 fan:{label:'Motisma Hélice',species:'Rotom-Fan',type:'Flying',move:'Air Slash',sprite:10011},
 mow:{label:'Motisma Tonte',species:'Rotom-Mow',type:'Grass',move:'Leaf Storm',sprite:10012}
});
function normalize(value){if(typeof value==='string')value=JSON.parse(value);if(!value)return null;if(value.kind!=='rotom'||!Object.hasOwn(FORMS,value.key))throw Error('Forme de Motisma invalide.');return{kind:'rotom',key:value.key};}
function apply(p){if(p?.data?.id!==479)return p;const form=p.formData&&FORMS[p.formData.key];p.data=form?{...base,name:{...base.name,english:form.species},type:['Electric',form.type],base:{HP:50,Attack:65,Defense:107,'Sp. Attack':105,'Sp. Defense':107,Speed:86}}:base;[p.type1,p.type2]=p.data.type;p.formSpriteId=form?.sprite||null;p.formLabel=form?.label||null;return p;}
function change(p,key,choice={}){
 if(p?.data?.id!==479||p.currentHp<=0||p.isEgg)throw Error('Place un Motisma conscient en tête de ton équipe.');
 if(key!==null&&!Object.hasOwn(FORMS,key))throw Error('Cet appareil ne correspond à aucune forme.');
 if(p.uuid!==choice.expectedUuid||JSON.stringify(p.abilities)!==JSON.stringify(choice.expectedMoves)||(p.formData?.key||null)!==(choice.expectedForm||null))throw Error('Ton Motisma a changé. Interagis à nouveau avec l’appareil.');
 if((p.formData?.key||null)===key)throw Error('Motisma possède déjà cette forme.');
 const old=FORMS[p.formData?.key],next=FORMS[key],protectedMove=require('../corruption/pokemon').moduleOf(p,'move')?.move;
 const oldSlot=old&&old.move!==protectedMove?p.abilities.indexOf(old.move):-1;
 if(next&&!p.abilities.includes(next.move)){
  const slot=oldSlot>=0?oldSlot:p.abilities.length<4?p.abilities.length:choice.slot;
  if(!Number.isInteger(slot)||slot<0||slot>3)throw Error('Choisis la capacité à remplacer.');
  require('../corruption/pokemon').protectMove(p,slot);p.abilities=[...p.abilities];p.movePp=[...p.movePp];p.abilities[slot]=next.move;p.movePp[slot]=require('../battle/battleResources').getMaxMovePp(next.move);
 }else if(oldSlot>=0){p.abilities.splice(oldSlot,1);p.movePp.splice(oldSlot,1);}
 p.formData=key?{kind:'rotom',key}:null;p.recalculateStats(true);require('../corruption/pokemon').applyTraits(p);return p;
}
module.exports={FORMS,normalize,apply,change};
