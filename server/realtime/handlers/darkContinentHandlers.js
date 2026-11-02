const dc=require('../../game/world/darkContinent'),repo=require('../../persistence/darkContinentRepository');
function createHandlers({socket,account,userId,getPlayer,getState,setState,refreshActors,canUse,canInteract=canUse,travel,closeFishing}){
 let busy=false,scoutVisit=null,lastTravel=0;
 const near=(p,x,y)=>Math.abs(Math.floor(p.x/32)-x)+Math.abs(Math.floor(p.y/32)-y)<=2;
 const valid=()=>{const p=getPlayer();if(!p||p.inbattle||p.inventoryBusy||busy||!canUse())throw Error('Termine ton action avant de continuer.');return p;};
 const panel=(mode,extra={})=>socket.emit('darkContinentPanel',{mode,rules:dc.rules,...extra});
 const command=(name,work)=>account.on(name,async(data,ack)=>{let acquired;try{const p=valid();acquired=p;busy=true;p.inventoryBusy=true;const result=await work(p,data||{});if(typeof ack==='function')ack({success:true,...result});}catch(e){if(e.code)console.error('Dark Continent :',e.message);if(typeof ack==='function')ack({success:false,message:e.code?'Le passage est temporairement indisponible.':e.message});}finally{if(acquired){acquired.inventoryBusy=false;busy=false;}}});
 command('dark:claim',async p=>{const a=dc.actors(p.currentmap,getState()).find(a=>a.name==='dark_scout');if(!a||!near(p,a.x,a.y))throw Error('Rejoins l’éclaireur dans l’accueil.');setState(await repo.grantCard(userId));refreshActors();socket.emit('bagUpdated',{items:await require('../../persistence/itemRepository').loadUserItems(userId)});return{received:true};});
 command('dark:travel',async p=>{if(Date.now()-lastTravel<1500)throw Error('Laisse le passage se stabiliser.');const state=await repo.loadState(userId);setState(state);if(!state.owned)throw Error('Une carte de dresseur professionnel est nécessaire.');if(p.superTournamentActive)throw Error('Termine ta tentative du Super Tournoi.');
  const leaving=dc.isMap(p.currentmap);if(!leaving&&!p.equipe.pokemons.some(p=>p.currentHp>0))throw Error('Prépare une équipe apte avant de partir.');closeFishing();p.darkRulesRequired=false;await travel(leaving?dc.LOBBY:dc.ARRIVAL);
  if(!leaving){panel('rules',{required:true});p.darkRulesRequired=true;}lastTravel=Date.now();return{map:leaving?dc.LOBBY.map:dc.ARRIVAL.map};});
 command('dark:rulesRead',async p=>{if(p.currentmap!=='jungle1'||!near(p,6,10))throw Error('Écoute le guide sur la plage.');await repo.acknowledgeRules(userId);p.darkRulesRequired=false;setState({...getState(),introduced:true});return{};});
 command('dark:heal',async p=>{if(p.currentmap!=='jungle1'||!near(p,6,10))throw Error('Rejoins le guide sur la plage.');repo.removeFallen(p);require('../../game/world/playerRecovery').healTeam(p.equipe);await require('../../persistence/teamRepository').editEquipe(userId,p.equipe);socket.emit('teamStateChanged',{equipe:p.equipe,reason:'heal'});return{equipe:p.equipe};});
 return{
  async enter(){const p=getPlayer();if(!p)return;if(dc.isMap(p.currentmap)&&!p.equipe.pokemons.some(p=>p.currentHp>0)){await this.afterBattle();return;}if(![dc.LOBBY.map,'jungle1'].includes(p.currentmap)){scoutVisit=null;return;}const state=await repo.loadState(userId);setState({...state,scoutAt:getState().scoutAt});refreshActors();
   if(p.currentmap===dc.LOBBY.map&&state.eligible&&!state.owned&&scoutVisit!==dc.LOBBY.map){scoutVisit=dc.LOBBY.map;
    p.darkScoutBusy=true;
    try{const grid=require('../../game/world/mapRepository').loadCollisionData(p.currentmap),goal={x:Math.floor(p.x/32),y:Math.floor(p.y/32)},path=dc.scoutPath(grid,goal);
     for(const at of path){setState({...getState(),scoutAt:at});refreshActors();await new Promise(r=>setTimeout(r,140));if(!socket.connected||getPlayer()?.currentmap!==dc.LOBBY.map)return;}
     panel('invitation');
    }finally{p.darkScoutBusy=false;}}
   else if(p.currentmap!==dc.LOBBY.map)scoutVisit=null;
   if(p.currentmap==='jungle1'&&!state.introduced){p.darkRulesRequired=true;panel('rules',{required:true});}
  },
  async interact(){const p=getPlayer();if(!p||!canInteract())return false;const a=dc.actors(p.currentmap,getState()).find(a=>near(p,a.x,a.y));if(!a)return false;panel(a.name==='dark_scout'?'invitation':'guide');return true;},
  async afterBattle(){const p=getPlayer();if(!p||!dc.isMap(p.currentmap))return;repo.removeFallen(p);if(!p.equipe.pokemons.some(p=>p.currentHp>0)){await travel({map:'centre',x:560,y:304});socket.emit('blackout',{message:'Ton équipe a été perdue sur le Dark Continent. Tes compagnons du PC sont toujours à l’abri. Le terminal est juste devant toi.',mapname:'centre',equipe:p.equipe});}socket.emit('bagUpdated',{items:await require('../../persistence/itemRepository').loadUserItems(userId)});}
 };
}
module.exports={createHandlers};
