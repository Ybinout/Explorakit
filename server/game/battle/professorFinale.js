// A short scripted confrontation with a human, isolated from Pokémon battle rules.
// No Pokémon identity, XP, EV, money, capture or ordinary trainer reward is created.
const{randomUUID}=require('node:crypto');
const resources=require('./battleResources'),engine=require('./battleEngine');
const{emitSoloBattleEnd,clearBattleTransientState}=require('./battleOutcome');
const heldItems=require('../items/heldItems');
const{switchPokemonByIndex}=require('./battleTeam');
const{prepareMoveAnimation,serializeMoveResult}=require('./battleEvents');
const{rememberPartyOrder,restorePartyOrder}=require('./partyOrder');
const{editEquipe}=require('../../persistence/teamRepository');
function ask(socket){return new Promise(resolve=>{const turnId=randomUUID();let timer;
 const done=data=>{clearTimeout(timer);socket.off('actionResponse',answer);socket.off('disconnect',disconnect);resolve(data);};
 const answer=data=>{if(data?.turnId===turnId)done(data);},disconnect=()=>done({action:'flee'});
 socket.on('actionResponse',answer);socket.once('disconnect',disconnect);timer=setTimeout(disconnect,60000);timer.unref?.();
 socket.emit('requestAction',{turnId,message:'Le Professeur reste face à toi.'});
});}
async function start(player,io,userId,{onVictory,onResolve}={}){
 const socket=io.sockets.sockets.get(player.id);if(!socket||socket.connected===false)return false;
 const enemy={uuid:randomUUID(),storyActor:'professor',data:{id:0,name:{french:'Le Professeur'}},name:'Le Professeur',truename:'Le Professeur',maxHp:100,currentHp:100,level:1,status:'corrupted',abilities:[],movePp:[]};
 const field=engine.createBattleState({battleType:'trainer'});
 const send=(event,data)=>io.to(player.id).emit(event,data),sync=()=>send('introAnimation',{player,wildPokemon:enemy,genders:require('./presentationState').genders(player.equipe.pokemons[0],enemy),usableMoveIndexes:resources.getUsableMoveIndexes(player.equipe.pokemons[0],field),moveTypes:(player.equipe.pokemons[0]?.abilities||[]).map(n=>engine.getMoveByName(n)?.type||'Normal')});
 let victory=false,resolution=null;
 const lead=player.equipe.pokemons.findIndex(p=>p.currentHp>0&&!p.isEgg);
 if(lead<0)return false;
 rememberPartyOrder(player.equipe);
 [player.equipe.pokemons[0],player.equipe.pokemons[lead]]=[player.equipe.pokemons[lead],player.equipe.pokemons[0]];
 try{
  sync();send('battleFieldState',{weather:{kind:null,turns:0},terrain:{kind:null,turns:0},field:{}});
  while(socket.connected!==false){
   const action=await ask(socket);if(socket.connected===false||action.action==='flee'||action.action==='timeout')break;
   if(action.action==='change'){
    const n=action.number,p=player.equipe.pokemons[n];
    if(Number.isInteger(n)&&n>0&&p?.currentHp>0&&!p.isEgg){switchPokemonByIndex(player.equipe,n);sync();}
    continue;
   }
   const mon=player.equipe.pokemons[0],usable=resources.getUsableMoveIndexes(mon),n=action.number;
   if(action.action!=='attack'||!Number.isInteger(n)||(usable.length?!usable.includes(n):n!==0))continue;
   const name=usable.length?mon.abilities[n]:'Struggle',move=engine.getMoveByName(name);if(!move)continue;
   const turnStart=engine.processTurnStart(mon,{move,battleState:field});
   for(const message of turnStart.messages)send('battleText',{message});
   if(!turnStart.canAct){sync();if(!player.equipe.pokemons.some(p=>p.currentHp>0&&!p.isEgg))break;field.turn++;continue;}
   if(usable.length)resources.consumeMovePp(mon,name);
   heldItems.lockMove(mon,name,field);
   send('battleMoveAnimation',{...prepareMoveAnimation(mon,enemy,name,engine.createBattleState()),phase:null,actor:'player'});
   send('battleText',{message:`${mon.truename||mon.name} utilise ${move.fname||name} !`});
   if(move.combat?.damage_class==='status'&&name!=='Purify'){
    send('battleMoveResult',serializeMoveResult('player',{move,success:true}));sync();send('battleText',{message:'Le Professeur ne recule pas.'});field.turn++;continue;
   }
   // The two deliberate outcomes belong only to this human confrontation.
   const choice=name==='Purify'?'pardon':'violence';
   await editEquipe(userId,player.equipe);
   if(!await(onResolve?onResolve(choice):choice==='violence'?onVictory?.():false))throw Error('La confrontation ne peut pas être confirmée.');
   victory=true;resolution=choice;
   if(choice==='pardon'){
    enemy.status='normal';mon.currentHp=Math.min(mon.maxHp,mon.currentHp+Math.ceil(mon.maxHp/2));
    send('battleMoveResult',serializeMoveResult('player',{move,success:true,damage:0,hits:0,effectiveness:1}));sync();
    send('battleText',{message:'La corruption violette se dissipe. Le Professeur retrouve ses esprits.'});
   }else{
    enemy.currentHp=0;
    send('battleMoveResult',serializeMoveResult('player',{move,success:true,damage:100,hits:1,effectiveness:1}));sync();
    send('battleText',{message:'Le Professeur s’effondre.'});
   }
   break;
  }
  return victory;
 }finally{
  clearBattleTransientState(player.equipe.pokemons);
  restorePartyOrder(player.equipe);
  try{await editEquipe(userId,player.equipe);}finally{emitSoloBattleEnd(player,io,victory,{...(victory?{}:{fled:true}),...(resolution==='pardon'?{reason:'pardoned'}:{}),summary:{experience:[],loot:[],money:0}},'trainer');}
 }
}
module.exports={start,ask};
