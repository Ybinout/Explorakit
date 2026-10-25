const fs=require('node:fs'),{performance}=require('node:perf_hooks');
const codec=require('../server/game/drift/checkpointCodec'),engine=require('../server/game/battle/battleEngine'),ai=require(process.env.PERF_AI_MODULE||'../server/game/battle/humanTrainerAI'),{getPnjTeam}=require('../server/game/world/pnjTeamFactory');
const fixture=process.env.PERF_AI_FIXTURE||'/tmp/riftmon-ai-performance-fixtures.gz';let cases;
if(fs.existsSync(fixture))cases=codec.decode(fs.readFileSync(fixture));else{
 cases=[];for(const [name,opponent]of [['sevenp','wanda'],['wanda','sevenp'],['ana','sevenp'],['raphael','sevenp']])for(const weather of ['none','rain']){
  const team=getPnjTeam(name).pokemons,opponentTeam=getPnjTeam(opponent).pokemons,field=engine.createBattleState();if(weather!=='none')field.weather={kind:weather,turns:5};
  cases.push({name,opponent,weather,options:{team,opponentTeam,field,ownSide:field.sides.enemy,enemySide:field.sides.player,skill:1,memory:{},round:1}});
 }fs.writeFileSync(fixture,codec.encode(cases));
}
const rows=cases.map(c=>{const samples=[];let choice;for(let n=0;n<12;n++){const t=performance.now();choice=ai.chooseAction(c.options);samples.push(performance.now()-t);}samples.sort((a,b)=>a-b);return{name:c.name,opponent:c.opponent,weather:c.weather,choice,analysis:ai.analyse(c.options),meanMs:samples.reduce((s,v)=>s+v,0)/samples.length,p95Ms:samples[Math.floor(samples.length*.95)]};});console.log(JSON.stringify({fixture,rows},null,2));
