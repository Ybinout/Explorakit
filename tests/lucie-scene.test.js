const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function dialogue(sequence){
 const source=fs.readFileSync('vue-explorakit/src/components/TextWithImage.vue','utf8').split('<script>')[1].split('</script>')[0].replace(/import AtlasPortrait[^;]+;/,'').replace('export default','component =');
 const timers=new Map();let id=0;const sandbox={AtlasPortrait:{},setTimeout(fn,ms){timers.set(++id,{fn,ms});return id;},clearTimeout(id){timers.delete(id);}};
 vm.runInNewContext(source,sandbox);const def=sandbox.component,c={...def.data(),sequence,charPerStep:120,$emit:e=>c.events.push(e),events:[]};
 for(const[k,f]of Object.entries(def.computed))Object.defineProperty(c,k,{get:()=>f.call(c)});
 for(const[k,f]of Object.entries(def.methods))c[k]=f.bind(c);
 return{c,def,timers,tick(){const[key,{fn}]=timers.entries().next().value;timers.delete(key);fn();}};
}
test('Lucie types slowly with punctuation pauses; action reveals then advances, no forced auto advance',()=>{
 const{c,timers,tick}=dialogue([{text:'A, B.',typewriterMs:45},{text:'Fin',typewriterMs:45}]);
 c.advanceText();assert.equal(c.displayedText,'A');assert.equal(timers.values().next().value.ms,45);
 tick();assert.equal(c.displayedText,'A,');assert.equal(timers.values().next().value.ms,195);
 c.advanceText();assert.equal(c.displayedText,'A, B.');assert.equal(timers.size,0);assert.equal(c.currentIndex,0);
 c.advanceText();assert.equal(c.currentIndex,1);assert.equal(c.displayedText,'F');
 while(timers.size)tick();assert.equal(c.displayedText,'Fin');assert.equal(c.events.length,0);
 c.advanceText();assert.deepEqual(c.events,['sequence-end']);assert.equal(timers.size,0);
});
test('ordinary dialogue retains paging and Lucie timers are cancelled when sequence changes or closes',()=>{
 const{c,def,timers}=dialogue([{text:'Bonjour monde'}]);c.advanceText();assert.equal(c.displayedText,'Bonjour monde');assert.equal(timers.size,0);
 c.sequence=[{text:'Lucie',typewriterMs:45}];def.watch.sequence.call(c);assert.equal(c.displayedText,'L');assert.equal(timers.size,1);
 c.sequence=[{text:'Nouveau'}];def.watch.sequence.call(c);assert.equal(c.displayedText,'Nouveau');assert.equal(timers.size,0);
 c.sequence=[{text:'Lucie',typewriterMs:45}];def.watch.sequence.call(c);c.resetText();assert.equal(timers.size,0);
});
test('Lucie portrait is only attached to her story trainer encounter; other modes and gyms stay scoped',async()=>{
 const{arenaChampion}=await import('../vue-explorakit/src/services/arenaEntrance.js');const c=arenaChampion('route2_maison','trainer');assert.equal(c.name,'Lucie');assert(c.minimumMs>=4000&&c.portraitMs>=2500);
 for(const kind of ['wild','pvp','arena','colosseum'])assert.equal(arenaChampion('route2_maison',kind),null);
 assert.equal(arenaChampion('ville1_arene','arena').name,'Mounir');assert(fs.existsSync('vue-explorakit/src/assets/image/'+c.portrait));
});
