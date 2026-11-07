const test=require('node:test'),assert=require('node:assert/strict'),{make}=require('../scripts/calibrateCorruptionRaids'),engine=require('../server/game/battle/battleEngine'),forms=require('../server/game/abilities/abilityForms'),items=require('../data/game/items.json').items;
function p(id=493,ability='Multitype'){const p=make(id,100,4,['Judgment','Trick','Fling','Thief'],ability);p.heldItem=null;return p;}
const plates=items.filter(i=>i.abilityPlate),state=()=>engine.createBattleState({battleType:'trainer'});
test('seventeen real held plates are distinct from crafting tablets, with existing shop progression and no loot changes',()=>{assert.equal(plates.length,17);const shop=require('../data/game/shop_offers.json'),store=require('../data/game/department_store.json');for(const i of plates){assert.equal(i.category,'held');assert.equal(i.battle_effect,'type_power');assert.equal(i.buy_price,10000);assert(!i.key.startsWith('dark_plate_'));assert(!i.wildLoot&&!i.dropOnly);assert(JSON.stringify(shop).includes(i.key));assert(JSON.stringify(store).includes(i.key));}});
for(const item of plates)test(item.key+': Multitype and Judgment use the held plate type; copy is never shared',()=>{
 const a=p(),d=p(143,'Keen Eye');a.heldItem=item.key;forms.sync(a,'entry');assert.deepEqual(engine.getPokemonTypes(a),[item.boost_type]);const base=engine.getMoveByName('Judgment'),m=engine.resolveWeatherMove(base,a,d,state());assert.equal(m.type,item.boost_type);assert.equal(base.type,'Normal');
 a.heldItem=null;forms.sync(a,'entry');assert.deepEqual(engine.getPokemonTypes(a),['Normal']);assert.equal(engine.resolveWeatherMove(base,a,d,state()).type,'Normal');
});
test('ordinary plate holders keep their species type; Multitype cannot change a foreign species',()=>{const a=p(143,'Multitype');a.heldItem='flame_plate';forms.sync(a,'entry');assert.deepEqual(engine.getPokemonTypes(a),['Normal']);});
test('Arceus plates cannot be removed by Knock Off, Trick, Fling or contact theft',()=>{
 for(const move of ['Knock Off','Trick','Thief','Covet']){const a=p(68,'Keen Eye'),d=p();a.abilities=[move];d.heldItem='flame_plate';a.heldItem=move==='Trick'?'leftovers':null;engine.useattack(move,a,d,{battleState:state(),consumePp:false,skipTurnStart:true});assert.equal(d.heldItem,'flame_plate',move);}
 const a=p(),d=p(143,'Keen Eye');a.heldItem='flame_plate';engine.useattack('Fling',a,d,{battleState:state(),consumePp:false,skipTurnStart:true});assert.equal(a.heldItem,'flame_plate');assert.equal(d.currentHp,d.maxHp);
});
test('ordinary Pokémon can lose a plate and Judgment observes item suppression',()=>{
 const a=p(68,'Keen Eye'),d=p(143,'Keen Eye');d.heldItem='flame_plate';engine.useattack('Knock Off',a,d,{battleState:state(),consumePp:false,skipTurnStart:true});assert.equal(d.heldItem,null);
 const arceus=p();arceus.heldItem='flame_plate';const s=state();s.field.magicRoomTurns=5;assert.equal(engine.resolveWeatherMove(engine.getMoveByName('Judgment'),arceus,d,s).type,'Normal');forms.sync(arceus,'entry',[],null,s,d);assert.deepEqual(engine.getPokemonTypes(arceus),['Fire']);
});

test('plates cannot be traded or bestowed onto Arceus during battle, but ordinary transfers stay valid',()=>{for(const move of ['Trick','Bestow']){const a=p(143,'Keen Eye'),d=p();a.heldItem='flame_plate';engine.useattack(move,a,d,{battleState:state(),consumePp:false,skipTurnStart:true});assert.equal(a.heldItem,'flame_plate');assert.equal(d.heldItem,null);}const a=p(143,'Keen Eye'),d=p(68,'Keen Eye');a.heldItem='flame_plate';engine.useattack('Bestow',a,d,{battleState:state(),consumePp:false,skipTurnStart:true});assert.equal(d.heldItem,'flame_plate');});
