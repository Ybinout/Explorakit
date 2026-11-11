// Explain native request restrictions, without changing the native legal moves.
const labels=require('../../../data/game/corruption_labels.fr.json');
const itemNames=new Map(require('../../../data/game/items.json').items.map(i=>[i.key.replace(/_/g,''),i.name]));
const moveName=n=>labels.moves[n?.name||n]||n?.name||n;
function disabledReason(p,m,move){
 if(m.pp===0&&m.id!=='struggle')return 'Aucun PP.';
 if(!m.disabled)return '';
 const v=p.volatiles||{};
 if(v.choicelock&&v.choicelock.move!==m.id&&!p.ignoringItem())return 'Bloquée par '+(itemNames.get(p.item)||p.getItem().name||'l’objet Choix')+'.';
 if(v.disable?.move===m.id)return 'Bloquée par Entrave.';
 if(v.encore?.move&&v.encore.move!==m.id)return 'Encore impose '+moveName(p.battle.dex.moves.get(v.encore.move))+'.';
 if(v.taunt&&move.category==='Status')return 'Bloquée par Provoc.';
 if(v.torment&&p.lastMove?.id===m.id)return 'Bloquée par Tourmente.';
 if(v.healblock&&move.flags.heal)return 'Bloquée par Anti-Soin.';
 if(v.throatchop&&move.flags.sound)return 'Bloquée par Exécu-Son.';
 if(p.hasItem('assaultvest')&&move.category==='Status')return 'Bloquée par la Veste de Combat.';
 const source=p.moveSlots.find(s=>s.id===m.id)?.disabledSource;
 if(source&&source!==move.name)return 'Bloquée par '+(labels.moves[source]||labels.abilities[source]||source)+'.';
 return 'Conditions de cette capacité non remplies.';
}
function areaTargets(p,move){
 let targets;
 if(move.target==='allAdjacent')targets=[...p.adjacentAllies(),...p.adjacentFoes()];
 else if(move.target==='allAdjacentFoes')targets=p.adjacentFoes();
 else if(['allies','allySide','allyTeam'].includes(move.target))targets=p.alliesAndSelf();
 else if(move.target==='foeSide')targets=p.foes(true);
 else if(move.target==='all')targets=[...p.alliesAndSelf(),...p.foes(true)];
 return targets?.filter(q=>q?.hp>0&&!q.fainted&&!q.m?.retired) || null;
}
module.exports={disabledReason,areaTargets};
