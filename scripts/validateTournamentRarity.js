// Compare the checked-in algorithm with the pending change on identical seeded inputs.
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),assert=require('node:assert/strict'),{execFileSync}=require('node:child_process');
const baseline=process.env.RARITY_BASELINE||'384fd6eba302682094375353d880266aa906229d';
const file=path.resolve(__dirname,'../server/game/superTournament/rewards.js'),prior=new Module(file,module);prior.filename=file;prior.paths=Module._nodeModulePaths(path.dirname(file));prior._compile(execFileSync('git',['show',baseline+':server/game/superTournament/rewards.js'],{encoding:'utf8'}),file);
const current=require(file),{getMaxMovePp}=require('../server/game/battle/battleResources');
const states=[['healthy',100,35,'normal'],['pp_missing',100,34,'normal'],['injured',75,35,'normal'],['hurt_pp',75,20,'normal'],['status',100,35,'burn'],['KO',0,0,'normal']];
const report={samplesPerState:20000,baseline,states:[]};
for(const [name,hp,pp,status]of states){const team=[{uuid:'test',currentHp:hp,maxHp:100,status,abilities:['Tackle'],movePp:[Math.min(pp,getMaxMovePp('Tackle'))]}],entry={name};
 for(const [version,rewards]of [['before',prior.exports],['after',current]]){let seed=74,count=0;const random=()=>((seed=(seed*1664525+1013904223)>>>0)/2**32);for(let i=0;i<report.samplesPerState;i++){const o=rewards.createOffer(team,1,random);assert.equal(new Set(o.cards.map(rewards.familyOf)).size,4);count+=o.cards.includes('full_reset');}entry[version]={count,percent:count/report.samplesPerState*100};}
 assert(entry.after.count>0&&entry.after.percent<2);report.states.push(entry);
}
const out=process.env.RARITY_REPORT||'/tmp/riftmon-renaissance-rarity.json';fs.writeFileSync(out,JSON.stringify(report,null,2));console.log(JSON.stringify(report));
