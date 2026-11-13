const rules=require('../../game/magicIsland/rules'),repo=require('../../persistence/magicIslandRepository');
function registerMagicIslandHandlers({socket,account,userId,getPlayer,canUse,canInteract=canUse,travel,beforeTravel=async()=>{},onTeamChanged=async()=>{},speak=()=>{},onCasinoLoss=()=>{},getHousingDevice=()=>null,openTalents=async()=>{}}){
 let busy=false, windowAt=0, count=0;
 const valid=()=>{const p=getPlayer();if(!p||p.inbattle||p.inventoryBusy||busy||!canUse())throw Error('Termine ton action avant de continuer.');return p;};
 const service=name=>{if(rules.near(getPlayer())?.name!==name)throw Error('Approche-toi du bon interlocuteur.');};
 const brief=p=>({uuid:p.uuid,data:{id:p.data.id},name:p.name,truename:p.truename,level:p.level,k:p.k,shiny:p.shiny,currentHp:p.currentHp,isEgg:p.isEgg,formData:p.formData,formSpriteId:p.formSpriteId});
 async function panel(mode){if(['craft','module'].includes(mode))socket.emit('bagUpdated',{items:await require('../../persistence/itemRepository').loadUserItems(userId)});const state=await repo.state(userId),payload={mode,state,types:rules.TYPES};if(mode==='expedition'&&!state.expedition){const r=await repo.roster(userId);payload.pokemon=[...r.team.map(p=>({...brief(p),source:'team'})),...r.stored.map(e=>({...brief(e.pokemon),source:'pc',box:e.box}))];}socket.emit('magicIslandPanel',payload);}
 async function refresh(teamChanged=false){if(teamChanged)await onTeamChanged();const state=await repo.state(userId);const p=getPlayer();if(p)p.speedModuleActive=state.speed.active;socket.emit('speedModuleState',state.speed);socket.emit('whitepeak:wallet',{balance:state.money});const items=await require('../../persistence/itemRepository').loadUserItems(userId);socket.emit('bagUpdated',{items});return state;}
 function command(name,work){account.on('magic:'+name,async(data,ack)=>{const reply=typeof ack==='function'?ack:()=>{};let acquired;try{if(Date.now()-windowAt>1000){windowAt=Date.now();count=0;}if(++count>6)throw Error('Patiente un instant.');const p=valid();if(!data||typeof data!=='object'||Array.isArray(data)||JSON.stringify(data).length>2048)throw Error('Confirmation invalide.');busy=true;acquired=p;p.inventoryBusy=true;const result=await work(data,p);reply({success:true,...result});}catch(error){if(error.code)console.error('Île Magique:',error.code);reply({success:false,message:error.code?'La sauvegarde est momentanément indisponible. Réessaie cette confirmation.':error.message});}finally{if(acquired)acquired.inventoryBusy=false;busy=false;}});}
 command('refresh',async()=>{service('magic_expedition');await panel('expedition');return{};});
 command('craft',async data=>{service('magic_balls');const result=await repo.craft(userId,data);return{result,state:await refresh()};});
 command('purchaseModule',async data=>{service('magic_module');const result=await repo.purchaseModule(userId,data);return{result,state:await refresh()};});
 command('setSpeed',async data=>{const result=await repo.setSpeed(userId,data);return{result,state:await refresh()};});
 command('travel',async data=>{service(data.direction==='out'?'magic_captain':'magic_return');await beforeTravel();const result=await repo.travel(userId,data);socket.emit('magicIslandPanel',null);if(!result.duplicate)await travel(result.destination);return{result,state:await refresh()};});
 command('casino',async data=>{service('casino_croupier');const result=await repo.playCasino(userId,data);const state=await refresh();socket.emit('magicIslandPanel',null);if(result.won&&!result.duplicate){socket.emit('uniqueItemReceived',{key:'master_ball',name:'Master Ball'});speak(rules.near(getPlayer()),[{text:'Incroyable ! Tu as gagné ! Tiens, une Master Ball. Prends-en soin.'}]);}else if(!result.won)onCasinoLoss();return{result,state};});
 command('startExpedition',async data=>{service('magic_expedition');const result=await repo.startExpedition(userId,data);return{result,state:await refresh(true)};});
 command('claimExpedition',async data=>{service('magic_expedition');const result=await repo.claimExpedition(userId,data);return{result,state:await refresh(true)};});
 command('berryMaster',async(data,p)=>{
  service('magic_berry_master');
  if(!['explain','recipe'].includes(data.action))throw Error('Choisis une recette ou une explication.');
  const master=require('../../game/berries/master'),actor=rules.near(p);
  // Opening the menu or requesting advice never claims the daily recipe.
  const result=data.action==='recipe'?await require('../../persistence/berryMasterRepository').visit(userId):null;
  socket.emit('magicIslandPanel',null);
  if(getPlayer()===p&&rules.near(p)?.name===master.NAME)speak(actor,result?master.pages(result):master.explanations());
  return{result};
 });
 // Rotom's transformation validates the actual placed appliance again at commit time.
 command('rotom',async data=>{if(!getHousingDevice('rotom:'+data.appliance))throw Error('Approche-toi de cet appareil dans la maison.');const result=await require('../../persistence/rotomRepository').transform(userId,data,getPlayer());await onTeamChanged();return{result};});
 return{
  async initialize(){const state=await repo.state(userId);getPlayer().speedModuleActive=state.speed.active;socket.emit('speedModuleState',state.speed);},
  async interact(){const p=getPlayer();if(!p||!canInteract())return false;const actor=rules.near(p);if(!actor)return false;
   if(actor.name==='magic_berry_master'){
    if(busy||p.inventoryBusy||p.inbattle)return true;
    socket.emit('magicIslandPanel',{mode:'berryMaster'});
    return true;
   }
   if(actor.name==='magic_neighbor'){await openTalents();return true;}const mode={magic_captain:'travel',magic_return:'return',magic_balls:'craft',magic_module:'module',magic_expedition:'expedition',casino_croupier:'casino'}[actor.name];await panel(mode);return true;},
  async openRotom(appliance){const p=getPlayer(),first=p?.equipe?.pokemons?.[0];if(first?.data?.id!==479){socket.emit('progressionNotice',{message:'L’appareil se met en marche.'});return;}const forms=require('../../game/models/rotomForms');socket.emit('magicIslandPanel',{mode:'rotom',appliance,pokemon:brief(first),moves:first.abilities,protectedMove:require('../../game/corruption/pokemon').moduleOf(first,'move')?.move||null,form:first.formData?.key||null,forms:forms.FORMS});}
 };
}
module.exports={registerMagicIslandHandlers};
