const test=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events');
process.env.NODE_ENV='test';process.env.BATTLE_DELAY_SCALE='0';
const {startPvpBattle}=require('../server/game/battle/pvpBattle');
const factory=require('../server/game/drift/pokemonFactory');
function mon(id){const p=factory.create(id,20,true);p.passiveAbility=null;p.abilities=['Tackle'];p.movePp=[35];p.maxHp=p.currentHp=500;return p;}
class Socket extends EventEmitter {
    constructor(actions){super();this.actions=actions;}
    emit(name,payload){if(name==='requestAction'){setImmediate(()=>super.emit('actionResponse',this.actions.shift()||{action:'flee'}));return true;}return super.emit(name,payload);}
}
for(const pivot of [false,true])test(`PVP ${pivot?'pivot attack then replacement':'voluntary switch'} precedes the opposing attack for both viewers`,async()=>{
    const lead=mon(25),reserve=mon(7),enemy=mon(19);lead.currentSpeed=999;enemy.currentSpeed=1;
    if(pivot){lead.abilities=['U-turn'];lead.movePp=[20];}
    const a={id:'left',username:'A',equipe:{pokemons:[lead,reserve]}},b={id:'right',username:'B',equipe:{pokemons:[enemy]}};
    const events=[],io={sockets:{sockets:new Map([['left',new Socket([{action:pivot?'attack':'change',number:pivot?0:1}])],['right',new Socket([{action:'attack',number:0}])]])},to:target=>({emit:(name,payload)=>events.push({target,name,payload:JSON.parse(JSON.stringify(payload))})})};
    await startPvpBattle(a,b,io);
    assert.deepEqual(a.equipe.pokemons.map(p=>p.uuid),[lead.uuid,reserve.uuid]);
    for(const viewer of ['left','right']){
        const list=events.filter(e=>e.target===viewer),side=viewer==='left'?'player':'opponent';
        const entry=list.findIndex(e=>e.name==='introAnimation'&&e.payload.transitions.some(t=>t.kind==='enter'&&t.uuid===reserve.uuid&&t.side===side));
        const attack=list.findIndex(e=>e.name==='battleMoveAnimation'&&e.payload.actor!==(viewer==='left'?'player':'opponent'));
        assert(entry>=0&&attack>entry);const snapshot=list.slice(0,attack).filter(e=>e.name==='introAnimation').at(-1).payload;
        assert.equal(viewer==='left'?snapshot.player.equipe.pokemons[0].uuid:snapshot.wildPokemon.uuid,reserve.uuid);
        assert.equal(list.filter(e=>e.name==='battleMoveAnimation').length,pivot?2:1);
        if(pivot)assert(list.findIndex(e=>e.name==='battleMoveAnimation')<entry);
    }
});

for(const opposing of ['Tackle','Growl','Quick Attack','switch'])test(`PVP Aventure: Coup Bas checks the actual opposing ${opposing} action for both players`,async()=>{
 const previous=Math.random;Math.random=()=>.5;
 try{
  const a=mon(19),b=mon(19),reserve=mon(7);a.abilities=['Sucker Punch'];a.movePp=[5];a.currentSpeed=1;b.currentSpeed=999;b.abilities=[opposing==='switch'?'Tackle':opposing];b.movePp=[35];
  const left={id:'left',equipe:{pokemons:[a]}},right={id:'right',equipe:{pokemons:[b,reserve]}},events=[];
  const io={sockets:{sockets:new Map([['left',new Socket([{action:'attack',number:0}])],['right',new Socket([{action:opposing==='switch'?'change':'attack',number:opposing==='switch'?1:0}])]])},to:target=>({emit:(name,payload)=>events.push({target,name,payload:JSON.parse(JSON.stringify(payload))})})};
  await startPvpBattle(left,right,io);
  for(const viewer of ['left','right']){const result=events.find(e=>e.target===viewer&&e.name==='battleMoveResult'&&e.payload.moveName==='Sucker Punch');assert(result);assert.equal(result.payload.damage>0,opposing==='Tackle');}
  assert.equal(a.movePp[0],4);
 }finally{Math.random=previous;}
});
