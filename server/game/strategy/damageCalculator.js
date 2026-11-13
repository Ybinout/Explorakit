const engine=require('../battle/battleEngine');
const {planTurnActions}=require('../battle/turnActions');
const {getMoveDefinition}=require('../battle/battleResources');
const STATUSES=new Set(['normal','burn','poison','badly_poison','paralyze','sleep','freeze']);
const STATS=['attack','defense','specialAttack','specialDefense','speed'];
function integer(value,min,max,fallback){return Number.isInteger(value)&&value>=min&&value<=max?value:fallback;}
function calculate(team,payload={}){
 if(!Array.isArray(team)||team.length>12)throw Error('Équipe indisponible.');
 const source=team.find(p=>p.uuid===payload.attacker),target=team.find(p=>p.uuid===payload.defender);
 if(!source||!target||source===target||source.isEgg||target.isEgg)throw Error('Choisis deux Pokémon différents de ton équipe.');
 const index=integer(payload.move,0,3,-1),name=source.abilities[index],definition=getMoveDefinition(name);
 if(!definition)throw Error('Choisis une capacité actuellement apprise.');
 if(definition.combat?.effects?.some(e=>['random_move','assist','sleep_talk','copy_last_move','me_first','copycat','nature_power'].includes(e.kind)))throw Error('Cette capacité appelle une autre attaque : ses dégâts dépendent du combat. Sélectionne une capacité directe pour la simuler.');
 const options=payload.options||{},outcomes=[];
 const level=options.commonLevel==null||options.commonLevel===0?null:integer(options.commonLevel,1,9999,null);
 if(options.commonLevel!=null&&options.commonLevel!==0&&level===null)throw Error('Le niveau commun doit être un entier entre 1 et 9 999.');
 let simulated,entryItems;
 for(const roll of [0,.199999,.200001,.599999,.9,.999999]){
  const copies=structuredClone(team),a=copies.find(p=>p.uuid===source.uuid),d=copies.find(p=>p.uuid===target.uuid);
  for(const[p,key]of [[a,'attacker'],[d,'defender']]){
   // Simulations always start on isolated neutral battle state, never live flags.
   p.__battle={sleepTurns:0,statStages:{}};
   if(level){
    Object.setPrototypeOf(p,require('../models/Pokemon').prototype);p.level=level;p.recalculateStats();
    const percent=integer(options[key+'HpPercent'],0,100,100);p.currentHp=Math.floor(p.maxHp*percent/100);
   }else p.currentHp=integer(options[key+'Hp'],0,p.maxHp,p.currentHp);
   p.status=STATUSES.has(options[key+'Status'])?options[key+'Status']:p.status;
   for(const stat of STATS)p.__battle.statStages[stat]=integer(options[key+'Boosts']?.[stat],-6,6,0);
   engine.ensureBattleData(p);
  }
  const stats=p=>Object.fromEntries(['level','maxHp',...STATS].map(s=>[s,p[s]]));
  const state=engine.createBattleState({battleType:'trainer'}),attackerSide=engine.createSideState(),defenderSide=engine.createSideState();
  state.turn=2;
  state.weather={kind:['rain','sun','sandstorm','hail'].includes(options.weather)?options.weather:null,turns:5};
  state.terrain={kind:['electric_terrain','grassy_terrain','psychic_terrain','misty_terrain'].includes(options.terrain)?options.terrain:null,turns:5};
  if(options.reflect===true)defenderSide.screens.reflectTurns=5;
  if(options.lightScreen===true)defenderSide.screens.lightScreenTurns=5;
  const incoming=integer(options.incomingDamage,0,a.maxHp,0);
  if(incoming){a.__battle.lastDamageTaken=incoming;a.__battle.lastDamageTurn=state.turn;a.__battle.lastDamageSource=d.uuid;a.__battle.lastDamageClass=options.incomingSpecial===true?'special':'physical';}
  if(options.defenderHurt===true)d.__battle.lastHurtTurn=state.turn;
  a.__battle.activeMoveActions=options.firstAction===true?0:1;
  require('../abilities/abilityForms').syncWeatherForms(a,d,state);
  // Mutation berries activate on entry, not during useattack. Never consume
  // the owner's real equipment or persist a consumption receipt here.
  entryItems=[];
  for(const[p,opponent,key]of [[a,d,'attacker'],[d,a,'defender']]){
   const item=p.heldItem;
   engine.applyEntryItemEffects(p,state,opponent);
   if(p.__battle.mutationBerry)entryItems.push({side:key,itemKey:item,name:require('../battle/battleResources').getItemDefinition(item).name});
  }
  simulated={level,attacker:stats(a),defender:stats(d),attackerHp:a.currentHp,defenderHp:d.currentHp};
  planTurnActions(state,[{pokemon:a,action:'attack',moveName:name},{pokemon:d,action:options.opponentAttacks===false?'pass':'attack',moveName:d.abilities.find(n=>getMoveDefinition(n)?.combat?.damage_class!=='status')||'Tackle'}]);
  if(options.movedLast===true){const entry=state.turnActions.entries.find(e=>e.uuid===d.uuid);entry.acted=true;}
  const move=engine.resolveWeatherMove(engine.getMoveByName(name),a,d,state),hp=d.currentHp;
  let result=engine.useattack(name,a,d,{battleState:state,attackerSide,defenderSide,attackerTeam:copies,defenderTeam:[d],consumePp:false,skipTurnStart:true,movedLast:options.movedLast===true,damagePreview:{roll,critical:options.critical===true}});
  if(require('../battle/futureMoves').isFuture(name)&&result.success){state.turn+=2;result=engine.resolveFutureMoves(a,d,attackerSide,defenderSide,state,{damagePreview:{roll,critical:options.critical===true}})[0]?.result||result;}
  else if(result.phase==='prepare')result=engine.useattack(name,a,d,{battleState:state,attackerSide,defenderSide,attackerTeam:copies,defenderTeam:[d],consumePp:false,damagePreview:{roll,critical:options.critical===true}});
  outcomes.push({damage:Math.max(0,hp-d.currentHp),hpAfter:d.currentHp,effectiveness:result.abilityBlocked?0:result.effectiveness??engine.getMoveEffectiveness(move,a,d,state),success:result.success,messages:result.messages||[],hits:result.hits||0});
 }
 const sorted=[...outcomes].sort((a,b)=>a.damage-b.damage),min=sorted[0],max=sorted.at(-1),hp=simulated.defenderHp,maxHp=simulated.defender.maxHp;
 return {simulated,entryItems,attacker:source.uuid,defender:target.uuid,move:name,min:min.damage,max:max.damage,minPercent:100*min.damage/maxHp,maxPercent:100*max.damage/maxHp,minHpAfter:max.hpAfter,maxHpAfter:min.hpAfter,defenderHp:hp,defenderMaxHp:maxHp,effectiveness:max.effectiveness,possibleKo:max.hpAfter===0&&hp>0,guaranteedKo:min.hpAfter===0&&hp>0,successful:outcomes.some(o=>o.success),hits:[Math.min(...outcomes.map(o=>o.hits)),Math.max(...outcomes.map(o=>o.hits))],notes:[
  ...(level?[`Les deux Pokémon sont simulés au niveau ${level}, avec leurs IV, EV, potentiel, nature, talent et objet. Aucun changement sur ton équipe.`]:[]),
  'Bonus de la branche Combat de l’arbre désactivés dans cette simulation de duel ; ils sont réservés aux sauvages, aux raids et aux Super Combats.',
  ...entryItems.map(i=>`${i.side==='attacker'?'Attaquant':'Défenseur'} : ${i.name} activée à l’entrée, bonus et malus inclus. Rien n’est consommé sur ton équipe.`),
  'Perte de PV si la capacité touche, avec ses effets immédiats. Les dégâts de fin de tour et le tour adverse ne sont pas prédits.',
  'Les dégâts standards de ce moteur n’ont pas de tirage aléatoire hors critique : minimum et maximum peuvent être identiques.',
  ...(['Future Sight','Doom Desire'].includes(name)?['Impact différé deux tours plus tard, en supposant ces mêmes Pokémon et conditions au moment de l’impact.']:[]),
  ...(definition.combat?.power_type==='charge'?['Dégâts lors du relâchement, après le tour de préparation.']:[]),
  ...(!outcomes.some(o=>o.success)?max.messages.slice(0,2):[]),
  ...(definition.combat?.damage_class==='status'?['Capacité de statut : consulte son effet, elle n’inflige pas de dégâts directs classiques.']:[])
 ]};
}
module.exports={calculate};
