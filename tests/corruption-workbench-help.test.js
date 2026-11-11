const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {randomUUID}=require('node:crypto');
const registry=require('../server/game/corruption/modules');
const balance=require('../vue-explorakit/src/data/corruptionBalance.json');
const abilityPools=require('../vue-explorakit/src/data/corruptionAbilityPools.json');
const client=path.resolve(__dirname,'../vue-explorakit/src');
const helperSource=fs.readFileSync(path.join(client,'services/corruptionWorkbenchHelp.js'),'utf8');
const helper=import('data:text/javascript;base64,'+Buffer.from(helperSource).toString('base64'));
const names={crystal_shard:'Éclats fissurés',clear_crystal:'Cristaux limpides',aurora_prism:'Prismes d’aurore'};
function options(family,type='Fire') {
 return {family,typeLabel:registry.TYPES[type],
  recipe:registry.recipe(family,type).map(c=>({...c,name:names[c.key]||'Plaque '+registry.TYPES[type]})),
  statPenalties:balance.statPenalties,defenseMultiplier:balance.defenseMultiplier,
  abilityCount:abilityPools[type].length};
}
const step=(guide,key)=>guide.find(s=>s.key===key);

test('All four station guides use the current native recipe for every plate type',async()=>{
 const {corruptionWorkbenchHelp}=await helper;
 for(const family of Object.keys(registry.FAMILIES))for(const type of Object.keys(registry.TYPES)){
  const input=options(family,type),before=structuredClone(input),guide=corruptionWorkbenchHelp(input);
  assert.equal(new Set(guide.map(s=>s.key)).size,guide.length);
  for(const cost of input.recipe)assert(step(guide,'recipe').text.includes(`${cost.name} × ${cost.quantity.toLocaleString('fr-FR')}`));
  assert(step(guide,'purpose').text.includes(input.typeLabel));
  assert.deepEqual(input,before,'Reading help must not alter recipe, pool or balance data');
 }
});

test('Guide prices, penalties and defensive percentages are computed, not frozen copy',async()=>{
 const {corruptionWorkbenchHelp}=await helper,input=options('type');
 input.recipe=input.recipe.map((c,i)=>({...c,quantity:1234+i}));
 input.statPenalties={move:3,ability:6,type:8,combat:2};input.defenseMultiplier=.6;
 const guide=corruptionWorkbenchHelp(input);
 assert(step(guide,'recipe').text.includes((1234).toLocaleString('fr-FR')));
 assert.match(step(guide,'stats').title,/−8 %/);
 assert.match(step(guide,'stats').text,/CS −3 % ; Talent −6 % ; Type −8 % ; Combat −2 %/);
 assert.match(step(guide,'stats').text,/−19 % avec les quatre/);
 assert.match(step(corruptionWorkbenchHelp({...input,family:'combat'}),'purpose').text,/réduit de 40 %/);
});

test('Crafting help distinguishes fixed type modules from random abilities/moves and paid combat failures',async()=>{
 const {corruptionWorkbenchHelp}=await helper;
 const type=corruptionWorkbenchHelp(options('type'));
 assert.match(step(type,'recipe').text,/toujours le module du type choisi/);
 assert.match(step(type,'usage').text,/au hasard, avec une chance sur deux/);
 assert.match(step(type,'usage').text,/unique type est impossible : le module reste dans le sac/);
 assert.match(step(type,'replacement').text,/types actuels, pas des types d’origine/);
 assert.equal(registry.craft('type','Fire',()=>0).itemKey,registry.craft('type','Fire',()=>.999).itemKey);
 const combat=corruptionWorkbenchHelp(options('combat'));
 assert.match(step(combat,'recipe').text,/50 % d’échec, 25 % de module offensif et 25 % de module défensif/);
 assert.match(step(combat,'recipe').text,/Un échec consomme aussi tous les composants/);
 assert.equal(registry.craft('combat','Fire',()=>0).created,false);
 for(const [roll,direction]of [[0,'offense'],[.999,'defense']]){
  const draws=[.999,roll];assert.equal(registry.craft('combat','Fire',()=>draws.shift()).itemKey,`cmod_${direction}_fire`);
 }
 assert.match(step(combat,'usage').text,/Un seul emplacement Combat/);
 const ability=corruptionWorkbenchHelp(options('ability'));
 assert.match(step(ability,'usage').text,/Coloforce, Force Pure et Garde Mystique/);
 assert.match(step(ability,'recipe').text,/quel que soit le nombre d’espèces/);
 const move=corruptionWorkbenchHelp(options('move'));
 assert.match(step(move,'recipe').text,/Lutte et Gribouille sont exclues/);
 assert.match(step(move,'usage').text,/automatiquement celle-ci au même emplacement/);
});

test('Each station explains one-use installation, permanent limits and both held-item exceptions',async()=>{
 const {corruptionWorkbenchHelp}=await helper;
 for(const family of Object.keys(registry.FAMILIES)){
  const guide=corruptionWorkbenchHelp({...options(family),unlocked:false});
  assert.match(step(guide,'purpose').text,/Carte de dresseur professionnel/);
  assert.match(step(guide,'replacement').text,/fabrication seule ne modifie aucun Pokémon/);
  assert.match(step(guide,'replacement').text,/installation réussie consomme un exemplaire/);
  assert.match(step(guide,'permanence').text,/Un seul Pokémon corrompu est autorisé dans l’équipe/);
  assert.match(step(guide,'permanence').text,/plusieurs au PC/);
  assert.match(step(guide,'permanence').text,/légendaires, fabuleux, Œufs et Pokémon K.O./);
  assert.match(step(guide,'held-items').text,/baie finale du Mutateur ou un Kit de survie/);
  assert.match(step(guide,'held-items').text,/ancien objet ordinaire incompatible retourne dans le sac/);
 }
});

async function workbench() {
 const compiler=require('../vue-explorakit/node_modules/vue-template-compiler');
 const source=compiler.parseComponent(fs.readFileSync(path.join(client,'components/menu/CorruptionWorkbench.vue'),'utf8'));
 assert.deepEqual(compiler.compile(source.template.content).errors,[]);
 const deps={BagItemIcon:{},MenuHelp:{},corruptionWorkbenchHelp:(await helper).corruptionWorkbenchHelp,
  balance,abilityPools,crypto:{randomUUID},localizeTypeName:t=>registry.TYPES[t],typeBadgeStyle:()=>({}),moduleEffect:()=>'',
  CORRUPTION_FAMILIES:Object.keys(registry.FAMILIES).map(key=>({key,title:key})),
  recipeFor:(family,type)=>options(family,type).recipe};
 const component=new Function(...Object.keys(deps),source.script.content.replace(/^import .*;\n/gm,'').replace('export default','return'))(...Object.values(deps));
 const events=[],vm={...component.data(),panel:{station:'type',unlocked:true},items:[],
  $emit:(...args)=>events.push(args),command:()=>{throw Error('Help must not send a command');}};
 for(const [name,fn]of Object.entries(component.methods))vm[name]=fn.bind(vm);
 for(const [name,get]of Object.entries(component.computed))Object.defineProperty(vm,name,{get:()=>get.call(vm)});
 return {vm,events};
}

test('Opening help and Escape preserve an assembled recipe, result and request identity',async()=>{
 const {vm,events}=await workbench();
 vm.filled=['crystal_shard','dark_plate_fire'];vm.type='Fire';vm.uncertain=true;
 vm.result={created:false};vm.drag={moving:true};
 const before={filled:[...vm.filled],result:vm.result,requestId:vm.requestId};
 vm.openHelp();assert.equal(vm.helpOpen,true);assert.equal(vm.drag,null);
 assert.match(step(vm.guideSteps,'recipe').text,/Plaque Feu × 20/);
 vm.closePanel();assert.equal(vm.helpOpen,false);assert.deepEqual(events,[]);
 assert.deepEqual(vm.filled,before.filled);assert.equal(vm.result,before.result);
 assert.equal(vm.requestId,before.requestId);assert.equal(vm.uncertain,true);
 vm.closePanel();assert.deepEqual(events,[['close']]);
 vm.busy=true;vm.openHelp();vm.closePanel();assert.equal(vm.helpOpen,false);assert.equal(events.length,1);
});

test('The station focus trap yields to help and includes the ability search input',async()=>{
 const {vm}=await workbench();let queries=0,prevented=0;
 const first={getClientRects:()=>[{}],focus(){global.document.activeElement=this;}},
  search={getClientRects:()=>[{}],focus(){global.document.activeElement=this;}};
 vm.$refs={dialog:{querySelectorAll(selector){queries++;assert.match(selector,/input:not\(:disabled\)/);return[first,search];}}};
 const previous=global.document;global.document={activeElement:first};
 try{
  vm.helpOpen=true;vm.trap({shiftKey:true,preventDefault(){prevented++;}});assert.equal(queries,0);
  vm.helpOpen=false;vm.trap({shiftKey:true,preventDefault(){prevented++;}});
  assert.equal(global.document.activeElement,search);
  vm.trap({shiftKey:false,preventDefault(){prevented++;}});assert.equal(global.document.activeElement,first);
  assert.equal(prevented,2);
 }finally{if(previous===undefined)delete global.document;else global.document=previous;}
});

function guideFocusHarness(ignoredAttempts=0) {
 const compiler=require('../vue-explorakit/node_modules/vue-template-compiler');
 const source=compiler.parseComponent(fs.readFileSync(path.join(client,'components/tutorial/TutorialCoach.vue'),'utf8')).script.content;
 const ticks=[],frames=new Map(),document={activeElement:null};let frameId=0,visible=false,painted=false,focused=0,attempts=0;
 const component=new Function('requestAnimationFrame','cancelAnimationFrame','window','document',source.replace('export default','return'))(
  callback=>{frames.set(++frameId,callback);return frameId;},id=>frames.delete(id),{removeEventListener(){}},document);
 const button={focus(){assert.equal(visible&&painted,true,'The visible guide must paint before receiving focus');if(++attempts<=ignoredAttempts)return;focused++;document.activeElement=this;}};
 const vm={measured:false,paused:false,_isDestroyed:false,copy:{interactive:false},
  $refs:{card:{querySelector:()=>button,contains:node=>node===button}},observeTargets(){},measure(){},
  $nextTick(callback){ticks.push(callback);}};
 for(const name of ['reveal','cancelFocusStep','queueFocusStep','focusStep'])vm[name]=component.methods[name].bind(vm);
 return {vm,component,frames,document,button,get focused(){return focused;},get attempts(){return attempts;},
  flushTicks(){while(ticks.length){visible=vm.measured;for(const callback of ticks.splice(0))callback.call(vm);}},
  paintFrame(){const pending=[...frames];for(const [id,callback]of pending){frames.delete(id);callback();}painted=visible;}};
}

test('The shared guide lets its visible DOM paint before moving keyboard focus',()=>{
 const h=guideFocusHarness();h.vm.reveal();h.flushTicks();
 assert.equal(h.vm.measured,true);assert.equal(h.focused,0);
 h.paintFrame();assert.equal(h.focused,0);
 h.paintFrame();assert.equal(h.focused,1);assert.equal(h.frames.size,0);
});

test('Pausing or destroying the guide cancels the initial focus and subsequent retries',()=>{
 for(const lifecycle of ['pause','destroy'])for(const framesPassed of [0,1,3]){
  const h=guideFocusHarness(Infinity);h.vm.reveal();h.flushTicks();
  for(let i=0;i<framesPassed;i++)h.paintFrame();
  const stale=[...h.frames.values()];assert.equal(stale.length,1);
  if(lifecycle==='pause'){
   h.vm.paused=true;h.component.watch.paused.call(h.vm,true);
  }else{
   h.component.beforeDestroy.call(h.vm);h.vm._isDestroyed=true;
  }
  assert.equal(h.frames.size,0,'Closing or hiding the guide must cancel its pending frame');
  // A callback already dispatched by the browser must also be harmless.
  for(const callback of stale)callback();
  assert.equal(h.frames.size,0);assert.equal(h.focused,0);
 }
});

test('Interactive onboarding keeps focus on the game controls',()=>{
 const h=guideFocusHarness();h.vm.copy.interactive=true;
 h.vm.reveal();h.flushTicks();h.paintFrame();h.paintFrame();
 assert.equal(h.vm.measured,true);assert.equal(h.frames.size,0);assert.equal(h.focused,0);
});

test('A delayed browser focus is retried finitely and stops once the guide owns focus',()=>{
 const h=guideFocusHarness(2);h.vm.reveal();h.flushTicks();
 for(let i=0;i<4;i++)h.paintFrame();
 assert.equal(h.attempts,3);assert.equal(h.focused,1);assert.equal(h.frames.size,0);
 h.vm.queueFocusStep();h.paintFrame();h.paintFrame();
 assert.equal(h.attempts,3,'An already focused control must not lose focus to the first button');
 assert.equal(h.frames.size,0);
 const refused=guideFocusHarness(Infinity);refused.vm.reveal();refused.flushTicks();
 for(let i=0;i<30;i++)refused.paintFrame();
 assert.equal(refused.focused,0);assert(refused.attempts>1&&refused.attempts<=12);
 assert.equal(refused.frames.size,0,'A browser that never accepts focus must not create an infinite loop');
});
