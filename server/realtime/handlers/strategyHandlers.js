function registerStrategyHandlers({account,getPlayer}){
 let last=0;
 account.on('strategy:calculate',(data,ack)=>{
  const reply=typeof ack==='function'?ack:()=>{};
  try{
   const now=Date.now();if(now-last<180)throw Error('Patiente un instant.');last=now;
   const team=getPlayer()?.equipe?.pokemons;if(!team)throw Error('Équipe indisponible.');
   reply({success:true,result:require('../../game/strategy/damageCalculator').calculate(team,data)});
  }catch(e){if(e.code)console.error('Calculateur :',e.code);reply({success:false,message:e.code?'Simulation indisponible.':e.message});}
 });
}
module.exports={registerStrategyHandlers};
