const test = require('node:test');
const assert = require('node:assert/strict');
const { rememberPartyOrder, orderedParty, restorePartyOrder } = require('../server/game/battle/partyOrder');
const { switchPokemonByIndex, autoSwitchPokemon, resolveMoveSwitches } = require('../server/game/battle/battleTeam');
const { encode, decode } = require('../server/game/drift/checkpointCodec');
const factory = require('../server/game/drift/pokemonFactory');

function mon(id) { const p = factory.create(id, 20, true); p.passiveAbility = null; return p; }

test('party order survives voluntary switches, pivots, KOs and a new capture without moving the active battler', () => {
    const a=mon(7), b=mon(4), c=mon(25), captured=mon(19), team={pokemons:[a,b,c]};
    rememberPartyOrder(team);
    assert(switchPokemonByIndex(team,2));assert.equal(team.pokemons[0],c);
    assert.deepEqual(orderedParty(team.pokemons),[a,b,c]);assert.equal(team.pokemons[0],c);
    resolveMoveSwitches({switchSelf:true},team,{pokemons:[mon(16)]});
    team.pokemons.push(captured);a.currentHp=0;
    restorePartyOrder(team);assert.deepEqual(team.pokemons,[a,b,c,captured]);assert.equal(a.currentHp,0);
    assert(team.pokemons.every(p=>p.battlePartySlot===undefined));
    rememberPartyOrder(team);assert(autoSwitchPokemon(team));assert.equal(team.pokemons[0],b);
    restorePartyOrder(team);assert.deepEqual(team.pokemons,[a,b,c,captured]);
});

test('checkpoint keeps chosen order independently of active Pokémon; permanent losses are not resurrected', () => {
    const a=mon(7),b=mon(4),c=mon(25),team={pokemons:[a,b,c]};rememberPartyOrder(team);
    switchPokemonByIndex(team,2);b.currentHp=0;b.riftFainted=true;
    // A has been lost permanently, while B was protected by a talisman.
    team.pokemons=team.pokemons.filter(p=>p!==a);
    const resumed=decode(encode(team));assert.equal(resumed.pokemons[0].uuid,c.uuid);
    restorePartyOrder(resumed);assert.deepEqual(resumed.pokemons.map(p=>p.uuid),[b.uuid,c.uuid]);
    assert.equal(resumed.pokemons[0].currentHp,0);assert.equal(resumed.pokemons[0].riftFainted,true);
});

test('an interrupted battle also restores the party before the next menu or retry', async () => {
    const { preservePartyOrder } = require('../server/game/battle/partyOrder');
    const a=mon(7),b=mon(4),player={equipe:{pokemons:[a,b]}};
    const battle=preservePartyOrder(async p=>{rememberPartyOrder(p.equipe);switchPokemonByIndex(p.equipe,1);throw Error('interrupted');});
    await assert.rejects(battle(player),/interrupted/);
    assert.deepEqual(player.equipe.pokemons,[a,b]);assert.equal(a.battlePartySlot,undefined);
});
