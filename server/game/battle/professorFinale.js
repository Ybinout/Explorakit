// A short scripted confrontation with a human, isolated from Pokémon battle rules.
// No Pokémon identity, XP, EV, money, capture or ordinary trainer reward is created.
const{randomUUID}=require('node:crypto');
const resources=require('./battleResources'),engine=require('./battleEngine');
const{emitSoloBattleEnd}=require('./battleOutcome');
const{prepareMoveAnimation,serializeMoveResult}=require('./battleEvents');
const{rememberPartyOrder,restorePartyOrder}=require('./partyOrder');
const{editEquipe}=require('../../persistence/teamRepository');
function ask(socket){return new Promise(resolve=>{const turnId=randomUUID();let timer;
 const done=data=>{clearTimeout(timer);socket.off('actionResponse',answer);socket.off('disconnect',disconnect);resolve(data);};
 const answer=data=>{if(data?.turnId===turnId)done(data);},disconnect=()=>done({action:'flee'});
 socket.on('actionResponse',answer);socket.once('disconnect',disconnect);timer=setTimeout(disconnect,60000);timer.unref?.();
 socket.emit('requestAction',{turnId,message:'Le Professeur reste face à toi.'});
});}
async function start(player,io,userId,{onVictory}={}){
 const socket=io.sockets.sockets.get(player.id);if(!socket||socket.connected===false)return false;
 const enemy={uuid:randomUUID(),storyActor:'professor',data:{id:0,name:{french:'Le Professeur'}},name:'Le Professeur',truename:'Le Professeur',maxHp:100,currentHp:100,level:1,status:'normal',abilities:[],movePp:[]};
 const send=(event,data)=>io.to(player.id).emit(event,data),sync=()=>send('introAnimation',{player,wildPokemon:enemy,usableMoveIndexes:resources.getUsableMoveIndexes(player.equipe.pokemons[0]),moveTypes:(player.equipe.pokemons[0]?.abilities||[]).map(n=>engine.getMoveByName(n)?.type||'Normal')});
 let victory=false;
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
    if(Number.isInteger(n)&&n>0&&p?.currentHp>0&&!p.isEgg){[player.equipe.pokemons[0],player.equipe.pokemons[n]]=[p,player.equipe.pokemons[0]];sync();}
    continue;
   }
   const mon=player.equipe.pokemons[0],usable=resources.getUsableMoveIndexes(mon),n=action.number;
   if(action.action!=='attack'||!Number.isInteger(n)||(usable.length?!usable.includes(n):n!==0))continue;
   const name=usable.length?mon.abilities[n]:'Struggle',move=engine.getMoveByName(name);if(!move)continue;
   if(usable.length)resources.consumeMovePp(mon,name);
   send('battleMoveAnimation',{...prepareMoveAnimation(mon,enemy,name,engine.createBattleState()),phase:null,actor:'player'});
   send('battleText',{message:`${mon.truename||mon.name} utilise ${move.fname||name} !`});
   if(move.combat?.damage_class==='status'){
    send('battleMoveResult',serializeMoveResult('player',{move,success:true}));sync();send('battleText',{message:'Le Professeur ne recule pas.'});continue;
   }
   // The deliberate one-hit outcome belongs only to this narrative encounter.
   await editEquipe(userId,player.equipe);
   if(!await onVictory?.())throw Error('La confrontation ne peut pas être confirmée.');
   victory=true;enemy.currentHp=0;
   send('battleMoveResult',serializeMoveResult('player',{move,success:true,damage:100,hits:1,effectiveness:1}));sync();
   send('battleText',{message:'Le Professeur s’effondre.'});break;
  }
  return victory;
 }finally{
  restorePartyOrder(player.equipe);
  try{await editEquipe(userId,player.equipe);}finally{emitSoloBattleEnd(player,io,victory,{...(victory?{}:{fled:true}),summary:{experience:[],loot:[],money:0}},'trainer');}
 }
}
module.exports={start,ask};
