const test = require('node:test');
const assert = require('node:assert/strict');
const { getRegionMap, regionLocation, pokemonLocations } = require('../server/game/world/regionMap');
const { buildReport } = require('../scripts/auditPokemonAvailability');
const { toPublicPlayer } = require('../server/realtime/playerState');
test('region covers all current wild and fishing locations, with playable connected roads', () => {
    const atlas=getRegionMap(), nodes=new Set(atlas.nodes.map(n=>n.id));
    assert.equal(nodes.size,26);
    const reached=new Set(['start']);
    let changed=true;while(changed){changed=false;for(const [a,b] of atlas.edges)if(reached.has(a)!==reached.has(b)){reached.add(a);reached.add(b);changed=true;}}
    assert.deepEqual(reached,nodes);
    for(const n of atlas.nodes){assert(n.x>12&&n.x<atlas.width-12&&n.y>12&&n.y<atlas.height-12);assert(!n.id.startsWith('gen_ville')||n.id==='gen_ville5');}
    assert(!atlas.edges.some(e=>e.includes('ville_commerciale')&&e.includes('gen_route8')),'no invented future connection');
    for(const species of buildReport().entries.filter(p=>p.method==='capture')){
        const habitat=pokemonLocations(species.id,true);assert.equal(habitat.kind,'wild');
        const actual=habitat.locations.map(l=>[l.map,l.method==='cave'?'grass':l.method].join(':')).sort();
        assert.deepEqual(actual,species.locations.map(l=>[l.map,l.method].join(':')).sort(),`${species.name}: authoritative encounter sources`);
        for(const l of habitat.locations)assert(nodes.has(l.map));
    }
});
test('habitats distinguish fishing, evolution and unavailable species without exposing unseen entries',()=>{
    assert.equal(pokemonLocations(129,false),undefined);
    assert(pokemonLocations(129,true).locations.every(l=>l.method==='fishing'));
    const venusaur=pokemonLocations(3,true);assert.equal(venusaur.kind,'evolution');assert.deepEqual(venusaur.locations,[]);assert(venusaur.ancestors.some(a=>a.speciesId===1||a.speciesId===2));
    const mewtwo=pokemonLocations(150,true);assert.equal(mewtwo.kind,'wild');assert.deepEqual(mewtwo.legendary,{oneIn:3000,poolSize:35});
    assert(mewtwo.locations.some(l=>l.map==='start'&&l.method==='grass'));assert(mewtwo.locations.some(l=>l.method==='cave'));assert(mewtwo.locations.some(l=>l.method==='fishing'));
    assert.equal(pokemonLocations(150,false),undefined);assert.equal(pokemonLocations(494,true).kind,'unavailable');
});
test('player marker resolves interiors and each shared Pokemon Centre return town',()=>{
    const examples={etage:'start',route2_maison:'route2',ville1_arene:'ville1',ville_safe1_shop:'ville_safe1',gen_arene5:'gen_ville5',tour_etage3:'ville_commerciale',ville5_arene:'ville5',gen_shop_route10:'gen_route6'};
    for(const [map,region] of Object.entries(examples))assert.equal(regionLocation(map),region);
    for(const map of ['ville1','ville5','route4','ville_commerciale'])assert.equal(toPublicPlayer({currentmap:'centre',centerReturnPoint:{map}}).regionLocation,map);
    assert.equal(regionLocation('centre'),null,'do not invent a town for missing historical return state');
    assert.equal(regionLocation('nonexistent'),null);
});
