const test=require('node:test'),assert=require('node:assert/strict');
const Pokemon=require('../server/game/models/Pokemon');
const storage=require('../server/game/storage/pokemonStorage');
const tournament=require('../server/game/superTournament/content');
const {gender}=require('../server/game/items/stoneEvolution');
const mon=id=>new Pokemon(id,null,5,0,{hp:15,attack:15,defense:15,specialAttack:15,specialDefense:15,speed:15});
test('private PC views expose the engine gender for legacy and explicit Pokémon without changing them',()=>{
  const team=[mon(32),mon(29),mon(81),mon(1),mon(1)];team[3].gender='female';team[4].gender='male';
  const before=JSON.stringify(team),view=storage.view(team,[{box:0,slot:0,pokemon:team[0]}]);
  assert.deepEqual(view.team.map(p=>p.gender),['male','female','genderless','female','male']);
  assert.equal(view.entries[0].pokemon.gender,'male');assert.equal(JSON.stringify(team),before);
});
test('old Super Tournament checkpoints receive stable presentation genders, never a reroll or mutation',()=>{
  const team=[mon(1),mon(29),mon(32),mon(81)];
  const run={phase:'sas',room:0,score:0,player:{equipe:{pokemons:team}}},before=JSON.stringify(run);
  const first=tournament.state(run).team,second=tournament.state(run).team;
  assert.deepEqual(first.map(p=>p.gender),team.map(gender));assert.deepEqual(second.map(p=>p.gender),first.map(p=>p.gender));
  assert.equal(JSON.stringify(run),before);assert(first.every((p,i)=>p!==team[i]));
});
