// Isolated AI/HTTP contention benchmark. No SQL, live account or public traffic.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),{once}=require('node:events'),{performance}=require('node:perf_hooks');
const codec=require('../server/game/drift/checkpointCodec'),engine=require('../server/game/battle/battleEngine');
function baselineModule(ref){
 if(!/^[a-f0-9]{7,40}$/.test(ref))throw Error('Use an explicit baseline commit SHA');
 const root=path.resolve(__dirname,'..'),directory=fs.mkdtempSync(path.join(require('node:os').tmpdir(),'riftmon-ai-reference-'));
 for(const file of ['server/game/battle/humanTrainerAI.js','server/game/battle/humanTrainerModel.js','server/game/drift/colosseumAI.js']){
  const source=require('node:child_process').execFileSync('git',['show',ref+':'+file],{cwd:root,encoding:'utf8'});
  const rewritten=source.replace(/require\('([^']+)'\)/g,(_match,name)=>{const resolved=path.resolve(root,path.dirname(file),name),base=path.basename(resolved);return `require(${JSON.stringify(['humanTrainerModel','colosseumAI'].includes(base)?path.join(directory,base+'.js'):resolved)})`;});
  fs.writeFileSync(path.join(directory,path.basename(file)),rewritten);
 }
 return path.join(directory,'humanTrainerAI.js');
}
const modulePath=process.env.PROFILE_AI_REF?baselineModule(process.env.PROFILE_AI_REF):process.env.PROFILE_AI_MODULE||path.resolve(__dirname,'../server/game/battle/humanTrainerAI'),ai=require(modulePath);
const fixture=process.env.PROFILE_AI_FIXTURE||'/tmp/riftmon-concurrent-ai-fixtures.gz',output=process.env.PROFILE_AI_OUTPUT||'/tmp/riftmon-ai-concurrent-after.json';
if(!fs.existsSync(fixture))throw Error('Generate stable fixtures with PERF_AI_FIXTURE='+fixture+' node scripts/measureTrainerAi.js');
const cases=codec.decode(fs.readFileSync(fixture));
function distribution(samples){const sorted=[...samples].sort((a,b)=>a-b);return {meanMs:sorted.reduce((a,b)=>a+b,0)/sorted.length,p95Ms:sorted[Math.min(sorted.length-1,Math.floor(sorted.length*.95))],maxMs:sorted.at(-1)};}
function scenarios(){
 const result=[];for(const base of cases)for(let variation=0;variation<6;variation++){
  const c=codec.decode(codec.encode(base)),o=c.options;o.round=variation+1;o.field.turn=variation+1;
  if(variation){for(const [i,p]of o.team.entries()){p.currentHp=Math.max(1,Math.floor(p.maxHp*(.25+(i%3)*.2)));engine.ensureBattleData(p);}for(const p of o.opponentTeam)engine.ensureBattleData(p);}
  if(variation===1){o.ownSide.hazards.stealthRock=true;o.enemySide.hazards.spikes=2;}
  if(variation===2){o.field.field.trickRoomTurns=3;o.team[0].status='paralyze';o.team[0].__battle.statStages.attack=2;}
  if(variation===3){o.field.weather={kind:'sandstorm',turns:3};o.team[0].heldItem='choice_scarf';o.team[0].__battle.choiceMove=o.team[0].abilities[0];o.opponentTeam[0].__battle.substituteHp=30;}
  if(variation===4){o.field.weather={kind:'hail',turns:3};o.ownSide.screens.reflectTurns=3;o.team[0].status='sleep';o.team[0].__battle.sleepTurns=2;}
  if(variation===5){o.field.terrain={kind:'electric_terrain',turns:4};o.opponentTeam[0].__battle.statStages.speed=2;o.team[0].__battle.chargeElectric=true;o.team[0].__battle.helpingHand=true;}
  result.push({label:`${base.name}/${base.weather}/${variation}`,options:o});
 }return result;
}
async function run(){
 const agent=new http.Agent({keepAlive:true,maxSockets:2}),server=http.createServer((_q,r)=>{r.end('ok');});let checks=[];
 try{server.listen(0,'127.0.0.1');await once(server,'listening');const endpoint='http://127.0.0.1:'+server.address().port;
  const ping=()=>new Promise((resolve,reject)=>{const start=performance.now();http.get(endpoint,{agent},r=>{r.resume();r.on('end',()=>resolve(performance.now()-start));}).on('error',reject);});
  for(let i=0;i<5;i++)await ping();const isolated=[];for(let i=0;i<20;i++)isolated.push(await ping());
  for(const c of cases)ai.chooseAction(c.options);
  const rows=[];for(const battles of [1,4,8,16,32]){const costs=[],pings=[];
   for(let repeat=0;repeat<4;repeat++){const request=ping();const work=new Promise(resolve=>setImmediate(()=>{const start=performance.now();for(let i=0;i<battles;i++)ai.chooseAction(cases[i%cases.length].options);resolve(performance.now()-start);}));const [duration,latency]=await Promise.all([work,request]);costs.push(duration);pings.push(latency);}
   rows.push({simultaneousDecisions:battles,decisionBatch:distribution(costs),competingHttpPing:distribution(pings)});
  }
  // Exact scores and predictions, not just a broad "attack vs switch" check.
  for(const c of scenarios()){const before=codec.encode(c.options),analysis=ai.analyse(c.options),choice=ai.chooseAction(c.options),replacement=ai.chooseReplacement(c.options);if(!before.equals(codec.encode(c.options)))throw Error('AI mutated fixture '+c.label);checks.push({label:c.label,analysis,choice,replacement});}
  const result={module:modulePath,rows,isolatedHttpPing:distribution(isolated),checks,limits:'Synchronized decision bursts beside a local HTTP probe, using real AI and fixed current champion teams. This is not sustained full-game capacity or a complete combat playthrough.'};fs.writeFileSync(output,JSON.stringify(result,null,2));console.log(JSON.stringify({output,scenarios:checks.length,rows}));
 }finally{agent.destroy();await new Promise(r=>server.close(r));}
}
run().catch(e=>{console.error(e.stack);process.exitCode=1;});
