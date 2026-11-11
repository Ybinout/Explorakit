const {randomUUID}=require('node:crypto');
const {Battle,toID}=require('@pkmn/sim');
const {dex,teamSet,installStats}=require('./ruleset');
const names=require('../../../data/game/corruption_labels.fr.json');
const itemCatalog=require('../../../data/game/items.json').items;
const moveCatalog=require('../../../data/game/moves.json');
const byMove=new Map(moveCatalog.map(m=>[toID(m.ename),m]));
const sideIndex=id=>id==='p1'?0:1;
const location=id=>{const m=/^p([12])([ab]):/.exec(id||'');return m?{side:Number(m[1])-1,slot:m[2]==='a'?0:1}:null;};
class DoublesBattle {
 constructor(a,b,{emit,now=Date.now,onUpdate,onFinish,rules={}}){
  Object.assign(this,{a,b,emit,now,onUpdate,onFinish,rules});this.id=randomUUID();this.players=[a,b];this.finished=false;this.awaiting=true;this.pending=new Map();this.token=randomUUID();this.deadline=now()+45000;this.cursor=0;this.revision=0;this.choices=[[],[]];this.requests=[null,null];
  this.sim=new Battle({format:dex.formats.get('riftmondoubles')},dex);installStats(this.sim);
  const win=this.sim.win;this.sim.win=side=>{const resolved=typeof side==='string'?this.sim.getSide(side):side;this.simWinnerIndex=resolved?this.sim.sides.indexOf(resolved):null;return win.call(this.sim,side);};
  this.switchHistory=new Map();const add=this.sim.add;
  this.sim.add=(...args)=>{const start=this.sim.log.length,result=add.apply(this.sim,args);if(['switch','drag','replace'].includes(args[0])&&args[1]?.set?.rift){const views=[this.publicPokemon(args[1],true),this.publicPokemon(args[1],false)];for(let n=start;n<this.sim.log.length;n++)if(/^\|(?:switch|drag|replace)\|/.test(this.sim.log[n]))this.switchHistory.set(n,views);}return result;};
  for(const [i,p]of this.players.entries())this.sim.setPlayer('p'+(i+1),{name:p.username,team:p.equipe.pokemons.map(teamSet)});
  this.refresh();
 }
 active(i,slot=0){const p=this.sim.sides[i].active[slot];return p&&this.players[i].equipe.pokemons.find(own=>own.uuid===p.set.rift.uuid);}
 publicPokemon(p,own=false){if(!p)return null;const apparent=!own&&p.illusion?p.illusion:p,r=apparent.set.rift,model=this.players[sideIndex(p.side.id)].equipe.pokemons.find(p=>p.uuid===r.uuid);
  return {uuid:own?p.set.rift.uuid:null,pokemonId:apparent.species.num,name:apparent.name,level:p.level,shiny:apparent.shiny,k:r.k,gender:apparent.gender||null,currentHp:p.hp,maxHp:p.maxhp,status:p.status||'normal',types:apparent.getTypes(),corrupted:!!r.corrupted,boosts:{...p.boosts},effects:{shield:!!p.volatiles.protect,clone:!!p.volatiles.substitute},fainted:p.fainted||p.hp<=0,
   ...(own?{moves:p.moveSlots.map(m=>({name:dex.moves.get(m.id).name,pp:m.pp,maxpp:m.maxpp})),passiveAbility:dex.abilities.get(p.ability).name,heldItem:itemCatalog.find(i=>toID(i.key)===p.item)?.key||null,ability:names.abilities[dex.abilities.get(p.ability).name]||dex.abilities.get(p.ability).name}:{})};
 }
 targets(pokemon,move){const m=dex.moves.get(move.id),list=[],area=require('./moveAvailability').areaTargets(pokemon,m);
  if(area)return area.map(p=>({loc:(p.side===pokemon.side?-1:1)*(p.position+1),side:sideIndex(p.side.id),slot:p.position,name:this.publicPokemon(p,p.side===pokemon.side).name}));
  for(const side of this.sim.sides)for(const p of side.active){if(!p?.hp)continue;const loc=side===pokemon.side?-(p.position+1):p.position+1;if(this.sim.validTargetLoc(loc,pokemon,m.target))list.push({loc,side:sideIndex(side.id),slot:p.position,name:this.publicPokemon(p,p.side===pokemon.side).name});}
  return list;
 }
 state(i,{spectator=false}={}){const side=this.sim.sides[i],req=side.activeRequest;
  const own=!spectator;return {sideEffects:this.sim.sides.map(s=>Object.entries(s.sideConditions).map(([id,c])=>({id,name:names.moves[dex.moves.get(id).name]||dex.conditions.get(id).name,turns:c.duration||null,layers:c.layers||null}))),weather:this.sim.field.weather||null,terrain:this.sim.field.terrain||null,id:this.id,revision:this.revision,turn:this.sim.turn,turnId:this.token,deadline:this.deadline,serverNow:this.now(),side:i,finished:this.finished,winner:this.winnerIndex??null,reason:this.reason||null,
   players:this.players.map((p,n)=>({name:p.username,remaining:this.sim.sides[n].pokemon.filter(p=>p.hp>0).length,total:this.sim.sides[n].pokemon.length})),
   active:this.sim.sides.map((s,n)=>s.active.map(p=>this.publicPokemon(p,own&&n===i))),
   team:own?side.pokemon.map((p,index)=>({...this.publicPokemon(p,true),index,active:p.isActive})):[],
   choices:own?this.choices[i].map(Boolean):[],
   request:own&&!this.finished&&req&&!req.wait?{kind:req.forceSwitch?'switch':'move',slots:side.active.map((p,slot)=>{
    if(req.forceSwitch)return {slot,uuid:p?.set.rift.uuid,required:!!req.forceSwitch[slot],forceSwitch:true};
    const active=req.active?.[slot];return {slot,uuid:p?.set.rift.uuid,required:!!active&&!!p?.hp,trapped:!!active?.trapped,moves:(active?.moves||[]).map((m,index)=>({...m,index,disabledReason:require('./moveAvailability').disabledReason(p,m,dex.moves.get(m.id)),ename:dex.moves.get(m.id).name,name:names.moves[dex.moves.get(m.id).name]||m.move,type:dex.moves.get(m.id).type,category:dex.moves.get(m.id).category,power:dex.moves.get(m.id).basePower,targets:this.targets(p,m)}))};
   })}:null};
 }
 refresh(){
  require('../berries/simulator').syncModels(this.sim,this.players.flatMap(p=>p.equipe.pokemons));
  const changed=this.sim.sides.some((s,i)=>s.activeRequest!==this.requests[i]);
  if(changed){this.token=randomUUID();this.deadline=this.now()+45000;this.choices=[[],[]];this.pending.clear();this.requests=this.sim.sides.map(s=>s.activeRequest);}
  const events=this.events();this.revision++;
  if(this.sim.ended&&!this.finished){const winner=Number.isInteger(this.simWinnerIndex)?this.players[this.simWinnerIndex]:null;this.finish(winner||null,'finished',events);return;}
  for(const [i,p]of this.players.entries())this.emit(p,'whitepeak:doubleFrame',{...this.state(i),events:this.presentEvents(events,i)},{spectatorEvents:this.presentEvents(events,-1)});
  this.onUpdate?.(this);
 }
 presentEvents(events,viewer){return events.map(e=>{const {switchViews,...publicEvent}=e;return {...publicEvent,...(switchViews?{pokemon:switchViews[viewer===e.actor?.side?0:1]}:{})};});}
 events(){const start=this.cursor,lines=this.sim.log.slice(this.cursor);this.cursor=this.sim.log.length;const out=[];
  for(let n=0;n<lines.length;n++){
   let line=lines[n];if(line.startsWith('|split|')){n++;line=lines[n];n++;}
   const [,kind,...v]=line.split('|'),actor=location(v[0]);if(!actor&&kind!=='upkeep'&&kind!=='turn'&&kind!=='-weather'&&kind!=='-fieldstart'&&kind!=='-fieldend'&&kind!=='-sidestart'&&kind!=='-sideend')continue;
   const rawName=v[0]?.split(': ').slice(1).join(': '),event={kind,actor,name:rawName,effect:v[1]||null};if(this.switchHistory.has(start+n)){event.switchViews=this.switchHistory.get(start+n);this.switchHistory.delete(start+n);}
   // Future attacks resolve from a public slot-end event, not another use of
   // the move. A target-only cue avoids inventing an active caster or revealing
   // a reserve's identity after a switch.
   if(kind==='-end'&&/^move: (Future Sight|Doom Desire)$/.test(v[1])){const move=dex.moves.get(v[1].slice(6));out.push({kind:'move',actor:null,target:actor,delayed:true,moveName:move.name,moveType:move.type,category:move.category,power:move.basePower,moveTarget:'normal',message:`${names.moves[move.name]||move.name} frappe ${rawName} !`});}
   if(kind==='move'){const move=dex.moves.get(v[1]);Object.assign(event,{moveName:move.name,moveType:move.type,category:move.category,power:move.basePower,moveTarget:move.target,target:location(v[2]),message:`${rawName} utilise ${names.moves[move.name]||move.name} !`});}
   else if(['-damage','-heal','switch','drag','replace'].includes(kind)){const condition=v[kind.startsWith('-')?1:2]||'',hp=/^(\d+)(?:\/(\d+))?/.exec(condition);Object.assign(event,{direct:kind==='-damage'?!v.slice(2).some(part=>part.startsWith('[from]')):undefined,hp:hp?Number(hp[1]):0,maxHp:hp?.[2]?Number(hp[2]):null,details:kind.startsWith('-')?null:v[1],message:kind==='-heal'?`${rawName} récupère des PV.`:kind==='-damage'?`${rawName} subit des dégâts.`:`${rawName} entre en scène !`});}
   else if(kind==='faint')event.message=`${rawName} est K.O. !`;
   else if(kind==='-crit')event.message='Coup critique !';
   else if(kind==='-supereffective')event.message='C’est super efficace !';
   else if(kind==='-resisted')event.message='Ce n’est pas très efficace…';
   else if(kind==='-immune')event.message=`Cela n’affecte pas ${rawName}.`;
   else if(['-boost','-unboost'].includes(kind))Object.assign(event,{stat:v[1],delta:Number(v[2])*(kind==='-unboost'?-1:1),message:`${rawName} : ${({atk:'Attaque',def:'Défense',spa:'Attaque Spéciale',spd:'Défense Spéciale',spe:'Vitesse',accuracy:'Précision',evasion:'Esquive'})[v[1]]||v[1]} ${kind==='-boost'?'+':'−'}${v[2]}`});
   else if(kind==='-status')event.message=`${rawName} : ${({brn:'brûlure',par:'paralysie',psn:'poison',tox:'poison grave',slp:'sommeil',frz:'gel'})[v[1]]||v[1]}.`;
   else if(kind==='-miss'){event.target=location(v[1]);event.message='L’attaque échoue !';}
   else if(kind==='-fail')event.message='Mais cela échoue !';
   else if(kind==='cant')event.message=`${rawName} ne peut pas agir (${({slp:'sommeil',flinch:'apeurement',par:'paralysie',frz:'gel',recharge:'recharge',truant:'Absentéisme',disable:'Entrave',taunt:'Provoc'})[v[1]]||v[1]}).`;
   else if(['-activate','-start','-end','-singleturn'].includes(kind))event.message=`${rawName} : ${names.moves[v[1]?.replace('move: ','')]||v[1]}`;
   else if(kind==='-ability')event.message=`${rawName} active ${names.abilities[v[1]]||v[1]}.`;
   else if(kind==='-item'||kind==='-enditem')event.message=`${rawName} : ${itemCatalog.find(it=>toID(it.key)===toID(v[1]))?.name||v[1]}.`;
   else if(kind==='-fieldstart'||kind==='-fieldend')event.message=(names.moves[v[0]?.replace('move: ','')]||v[0])+(kind==='-fieldstart'?' recouvre le terrain.':' se dissipe.');
   else if(kind==='-sidestart'||kind==='-sideend')event.message=(v[0]?.split(': ').slice(1).join(': ')||'Le camp')+' : '+(names.moves[v[1]?.replace('move: ','')]||v[1])+(kind==='-sideend'?' se dissipe.':' entre en jeu.');
   else if(kind==='-weather')event.message=({RainDance:'La pluie tombe.',SunnyDay:'Le soleil brille.',Sandstorm:'La tempête de sable fait rage.',Snowscape:'La neige tombe.',none:'La météo se calme.'})[v[0]]||'La météo change.';
   if(event.message||kind==='turn')out.push(event);
  }return out;
 }
 action(player,data){const i=this.players.indexOf(player),req=i>=0?this.state(i).request:null,slot=data?.slot;
  if(this.finished||!req||data.turnId!==this.token||![0,1].includes(slot)||!req.slots[slot]?.required||this.pending.has(player)||this.choices[i][slot])return false;
  const own=this.sim.sides[i].active[slot],decision=req.slots[slot];let command;
  if(data.action==='attack'&&req.kind==='move'){
   const move=decision.moves.find(m=>m.index===data.moveIndex);if(!move||move.disabled||move.pp===0&&move.id!=='struggle')return false;
   const selectable=['normal','any','adjacentAlly','adjacentAllyOrSelf'].includes(move.target);
   if(selectable&&!move.targets.some(t=>t.loc===data.targetLoc))return false;
   command=`move ${move.index+1}${selectable?' '+data.targetLoc:''}`;
  }else if(data.action==='switch'){
   if(req.kind==='move'&&decision.trapped)return false;
   const target=this.sim.sides[i].pokemon.findIndex(p=>p.set.rift.uuid===data.pokemonUuid);
   if(target<0||this.sim.sides[i].pokemon[target].isActive||this.sim.sides[i].pokemon[target].hp<=0||this.choices[i].includes('switch '+(target+1)))return false;
   command='switch '+(target+1);
  }else return false;
  this.choices[i][slot]=command;
  if(req.kind==='switch'){
   const available=this.sim.sides[i].pokemon.filter(p=>!p.isActive&&p.hp>0).length;
   const picked=this.choices[i].filter(c=>c?.startsWith('switch ')).length;
   if(picked>=available)for(const s of req.slots)if(s.required&&!this.choices[i][s.slot])this.choices[i][s.slot]='pass';
  }
  if(req.slots.every((s,n)=>!s.required||this.choices[i][n])){
   const choices=req.slots.map((s,n)=>s.required?this.choices[i][n]:'pass').join(', ');
   if(!this.sim.choose('p'+(i+1),choices)){this.choices[i]=[];this.emit(player,'progressionNotice',{message:'Cette sélection n’est plus possible. Vérifie les cibles, les entraves et les remplaçants.'});this.refresh();return false;}
   this.pending.set(player,true);
  }
  this.refresh();return true;
 }
 tick(){if(!this.finished&&this.now()>=this.deadline){const waiting=this.sim.sides.map(s=>!s.activeRequest?.wait&&!s.isChoiceDone());const winner=waiting[0]&&!waiting[1]?this.b:waiting[1]&&!waiting[0]?this.a:null;this.finish(winner,'action_timeout');}}
 resume(player){const i=this.players.indexOf(player);if(i>=0)this.emit(player,'whitepeak:doubleFrame',{...this.state(i),events:[]});}
 spectatorView(){return this.state(0,{spectator:true});}
 finish(winner,reason,finalEvents=null){if(this.finished)return;this.finished=true;this.winnerIndex=winner?this.players.indexOf(winner):null;this.reason=reason;const events=finalEvents||this.events();this.revision++;
  for(const [i,p]of this.players.entries()){
   this.emit(p,'whitepeak:doubleFrame',{...this.state(i),events:this.presentEvents(events,i)},{spectatorEvents:this.presentEvents(events,-1)});

  }
  this.onFinish?.(this,winner,reason);
 }
}
module.exports={DoublesBattle,location,byMove};
