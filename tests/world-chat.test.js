const test=require('node:test'),assert=require('node:assert/strict');
const {normalizeWorldMessage,registerWorldChatHandlers}=require('../server/realtime/handlers/worldChatHandlers');
function handler(){
 const events={},sent=[],player={username:'Vrai nom',userId:42,currentmap:'route1',inbattle:false},state={time:1000,allowed:true};
 const socket={id:'owner',connected:true,on:(name,fn)=>events[name]=fn};
 registerWorldChatHandlers({socket,io:{to:room=>({emit:(name,payload)=>sent.push({room,name,payload})})},getPlayer:()=>state.missing?null:player,available:()=>state.allowed,now:()=>state.time});
 return{sent,player,state,socket,send:payload=>{let result;events['world:chat'](payload,r=>result=r);return result;}};
}
test('world chat normalization handles Unicode/emoji, removes control/bidi characters and rejects empty/oversized/non-text payloads',()=>{
 assert.equal(normalizeWorldMessage('  Salut\n   Évoli\t👋  '),'Salut Évoli 👋');assert.equal(normalizeWorldMessage('e\u0301'),'é');
 assert.equal(normalizeWorldMessage('a\u202eb'),'a b');assert.equal(normalizeWorldMessage('😀'.repeat(160)).length,320);
 for(const value of [null,undefined,{},12,'','   ','\n\u0000','a'.repeat(161),'😀'.repeat(161),' '.repeat(10000)])assert.equal(normalizeWorldMessage(value),null);
 assert.equal(normalizeWorldMessage('<img src=x onerror=alert(1)>'),'<img src=x onerror=alert(1)>','plain text, never interpreted as HTML');
});
test('world chat uses server identity and current map only, including sender; forged room/name/id are ignored',()=>{
 const f=handler();assert(f.send({message:'Salut',map:'elsewhere',fromId:'victim',fromName:'Admin'}).success);
 assert.equal(f.sent.length,1);const event=f.sent[0];assert.equal(event.room,'adventure-map:route1');assert.equal(event.name,'world:speech');
 assert.equal(event.payload.fromId,'owner');assert.equal(event.payload.fromName,'Vrai nom');assert.equal(event.payload.map,'route1');assert.equal(event.payload.text,'Salut');assert.equal(event.payload.durationMs,7000);assert(event.payload.id);
 f.player.currentmap='route2';f.state.time+=2000;assert(f.send({message:'Ici'}).success);assert.equal(f.sent[1].room,'adventure-map:route2');
});
test('world chat rate limit and unavailable states never broadcast or consume a cooldown for rejected text',()=>{
 const f=handler();for(const value of [null,[],{},'message',{message:7},{message:' '},{message:'a'.repeat(161)}])assert.equal(f.send(value).success,false);
 assert(f.send({message:'Un'}).success);assert.equal(f.send({message:'Deux'}).success,false);f.state.time+=1999;assert.equal(f.send({message:'Deux'}).success,false);f.state.time++;assert(f.send({message:'Deux'}).success);
 for(const property of ['battle','offline','busy','missing']){f.state.time+=2000;f.player.inbattle=property==='battle';f.socket.connected=property!=='offline';f.state.allowed=property!=='busy';f.state.missing=property==='missing';assert.equal(f.send({message:'Non'}).success,false);}
 assert.equal(f.sent.length,2);
});
function context(){return{calls:[],font:'',measureText:text=>({width:Array.from(text).length*7}),scale(){},beginPath(){},roundRect(){},fill(){},stroke(){},fillText(...args){this.calls.push(['text',...args]);},save(){},restore(){},moveTo(){},lineTo(){},drawImage(...args){this.calls.push(['image',...args]);}};}
test('speech wraps long words and emoji without truncating text or exceeding available line width',async()=>{
 const {wrapSpeech}=await import('../vue-explorakit/src/services/worldSpeech.js');const c=context();
 for(const text of ['Bonjour tout le monde','a'.repeat(160),'Bonjour 👋👋👋 éééééé éééééé']){const lines=wrapSpeech(c,text,56);assert(lines.every(line=>c.measureText(line).width<=56));assert.equal(lines.join('').replace(/\s/g,''),text.replace(/\s/g,''));}
});
test('speech cache follows moving actors without allocating canvases on each frame; palette and resolution invalidate once',async()=>{
 const {WorldSpeech}=await import('../vue-explorakit/src/services/worldSpeech.js');let allocations=0;const speech=new WorldSpeech(()=>{allocations++;return{width:0,height:0,getContext:()=>context()};});
 const c=context(),players={a:{currentmap:'route1',x:400,y:300}},options={players,map:'route1',camera:{x:0,y:0,visibleWidth:896,visibleHeight:640},scale:1,position:(id,p)=>p};
 assert(speech.receive({fromId:'a',map:'route1',text:'Bonjour'},1000));
 for(let t=1000;t<1500;t+=10){players.a.x++;speech.draw(c,options,t);}assert.equal(allocations,1);const images=c.calls.filter(call=>call[0]==='image');assert(images.at(-1)[2]>images[0][2]);
 speech.setColors({paper:'#edf5fc',ink:'#243f53',border:'#6699b2'});speech.draw(c,options,1500);assert.equal(allocations,1);
 speech.setColors({paper:'#123',ink:'#fff',border:'#abc'});speech.draw(c,options,1510);assert.equal(allocations,2);
 speech.draw(c,{...options,scale:2},1520);assert.equal(allocations,3);
 speech.draw(c,{...options,scale:2},1530);assert.equal(allocations,3);
});
test('speech expires, replaces the previous message, clears on missing/departing/fighting actors and bounds memory',async()=>{
 const {WorldSpeech}=await import('../vue-explorakit/src/services/worldSpeech.js');const speech=new WorldSpeech(()=>({getContext:()=>context()})),c=context(),players={a:{currentmap:'route1',x:0,y:0}};
 const options={players,map:'route1',camera:{x:0,y:0,visibleWidth:300,visibleHeight:300},scale:1,position:(id,p)=>p};
 speech.receive({fromId:'a',map:'route1',text:'Un',durationMs:999999},0);speech.receive({fromId:'a',map:'route1',text:'Deux'},10);assert.equal(speech.entries.size,1);assert.equal(speech.entries.get('a').text,'Deux');
 speech.draw(c,options,7010);assert.equal(speech.entries.size,0);
 for(const player of [undefined,{currentmap:'route2'},{currentmap:'route1',inbattle:true}]){speech.receive({fromId:'a',map:'route1',text:'Un'},0);players.a=player;speech.draw(c,options,10);assert.equal(speech.entries.size,0);}
 for(let i=0;i<40;i++)speech.receive({fromId:String(i),map:'route1',text:'Un'},0);assert.equal(speech.entries.size,32);speech.clear();assert.equal(speech.entries.size,0);
 assert.equal(speech.receive({fromId:'a',map:'route1',text:'a'.repeat(161)},0),false);
});
test('nearby simultaneous speech bubbles avoid overlapping text and stay inside the camera',async()=>{
 const {WorldSpeech}=await import('../vue-explorakit/src/services/worldSpeech.js');const speech=new WorldSpeech(()=>({getContext:()=>context()})),c=context();
 const players={a:{currentmap:'route1',x:130,y:300},b:{currentmap:'route1',x:160,y:300}};
 for(const id of ['a','b'])speech.receive({fromId:id,map:'route1',text:'Bonjour tout le monde'},0);
 speech.draw(c,{players,map:'route1',camera:{x:0,y:0,visibleWidth:320,visibleHeight:640},scale:1,position:(id,p)=>p},10);
 const boxes=c.calls.filter(call=>call[0]==='image').map(([,canvas,x,y,width,height])=>({x,y,width,height}));assert.equal(boxes.length,2);
 const [a,b]=boxes;assert(a.y+a.height<=b.y||b.y+b.height<=a.y||a.x+a.width<=b.x||b.x+b.width<=a.x);
 for(const box of boxes)assert(box.x>=0&&box.x+box.width<=320&&box.y>=0&&box.y+box.height<=640);
});
