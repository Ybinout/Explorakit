const test=require('node:test'),assert=require('node:assert/strict');
const reference=require('../vue-explorakit/src/data/pokemonReference.fr.json'),names=require('../vue-explorakit/src/data/gameNames.fr.json');
async function tokens(){return (await import('../vue-explorakit/src/services/battleMessage.js')).createNarrationParts(reference,names);}
test('every catalogue move retains its exact French/English spelling and type in narration',async()=>{
 const parts=await tokens();for(const[name,move]of Object.entries(reference.moves))for(const alias of new Set([name,names.moves[name]].filter(Boolean))){const text='Test utilise '+alias+' !',result=parts(text,{moveName:name});assert.equal(result.map(p=>p.text).join(''),text);assert.equal(result.filter(p=>p.type).length,1,name);assert.equal(result.find(p=>p.type).type,move.type,name);}
});
test('longest complete move names, actor nicknames, Unicode and multiple mentions remain unambiguous',async()=>{
 const parts=await tokens();for(const text of ['Retour utilise Retour !','Charge utilise Fatal-Foudre !','Le Pokémon prépare Choc Psy !']){const p=parts(text);assert.equal(p.filter(p=>p.type).length,1);assert.equal(p.map(p=>p.text).join(''),text);assert(!p[0].type);}
 assert.equal(parts('Staross uses Thunder Wave !').find(p=>p.type).text,'Thunder Wave');assert.equal(parts('Staross utilise Choc Psy puis Soin.').filter(p=>p.type).length,2);assert(!parts('Le Pokémon riposte.').some(p=>p.type));assert(!parts('ThunderboltExtra').some(p=>p.type));
});
test('resolved move types apply only to that move; HTML-like input remains literal text',async()=>{
 const parts=await tokens(),text='<img src=x onerror=alert(1)> utilise Ball’Météo !';assert.equal(parts(text).map(p=>p.text).join(''),text);
 const alias=names.moves['Weather Ball'],result=parts('Test utilise '+alias+' puis Retour !',{moveName:'Weather Ball',moveType:'Water'});assert.equal(result.find(p=>p.text===alias).type,'Water');assert.equal(result.find(p=>p.text==='Retour').type,'Normal');
});
test('the timer token changes only the seconds number, preserving all narration and other figures',async()=>{
 const parts=await tokens(),text='Niveau 100 · Choisis ton action · 30 secondes';assert(!parts(text).some(p=>p.countdown));const p=parts(text,{countdown:true});assert.equal(p.filter(p=>p.countdown).length,1);assert.equal(p.find(p=>p.countdown).text,'30');assert.equal(p.map(p=>p.text).join(''),text);assert(!parts('30 PP · 100 PV',{countdown:true}).some(p=>p.countdown));
});
test('decision clock uses the original server deadline and receipt time, rounds up, and never becomes negative',async()=>{
 const {decisionSeconds:seconds}=await import('../vue-explorakit/src/services/battleMessage.js'),clock={deadline:130000,serverNow:100000,receivedAt:500};
 for(const[t,n]of [[500,30],[699,30],[1500,29],[4200,27],[30500,0],[100000,0]])assert.equal(seconds(clock,t),n);
 assert.equal(seconds({deadline:130000,serverNow:110000,receivedAt:1000},4000),17);assert.equal(seconds(null,1000),null);assert.equal(seconds({deadline:NaN,serverNow:1,receivedAt:1},2),null);
});
test('native timed requests, invalid choices and resumes carry the same deadline without extending the turn',()=>{
 const {DriftBattle}=require('../server/game/drift/driftBattle'),factory=require('../server/game/drift/pokemonFactory');let now=1000;const events=[];const player=id=>({userId:id,id:'test'+id,socketId:'test'+id,alive:true,currentmap:'route1',run:{mode:'rift'},equipe:{pokemons:[factory.create(143,50,true)]},items:{},drifts:[],equipped:[],money:0,defeated:new Set()});const a=player(1),b=player(2),battle=new DriftBattle(a,b,{type:'pvp',now:()=>now,paceMs:0,emit:(p,event,data)=>{if(p===a&&event==='requestAction')events.push(data);}});
 try{const deadline=battle.deadline,token=battle.token;assert.equal(events.at(-1).deadline,31000);assert.equal(events.at(-1).serverNow,1000);now=6300;battle.resume(a);assert.equal(events.at(-1).deadline,deadline);assert.equal(events.at(-1).serverNow,now);assert.equal(events.at(-1).turnId,token);assert.match(events.at(-1).message,/30 secondes/);assert.equal(battle.action(a,{turnId:token,action:'attack',number:999}),false);assert.equal(events.at(-1).deadline,deadline);assert.equal(battle.deadline,deadline);}finally{battle.finished=true;}
});

test('Charge distinguishes French Tackle from English Charge and prioritizes the actual announced move',async()=>{const p=await tokens();assert.equal(p('Test utilise Charge !').find(p=>p.type).type,'Normal');assert.equal(p('Test uses Charge !',{language:'en'}).find(p=>p.type).type,'Electric');assert.equal(p('Test utilise Charge !',{moveName:'Charge'}).find(p=>p.type).type,'Electric');});
