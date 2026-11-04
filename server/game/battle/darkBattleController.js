const {randomUUID}=require('node:crypto');
const {DriftBattle}=require('../drift/driftBattle');
const codec=require('../drift/checkpointCodec');
const repository=require('../../persistence/darkBattleRepository');
const dc=require('../world/darkContinent');

class DarkBattleController {
    constructor({userId,getPlayer,emit,persist=repository,now=Date.now,random=Math.random,onFinish=async()=>{}}) {
        Object.assign(this,{userId,getPlayer,emit,persist,now,random,onFinish});
        this.run=null;this.version=0;this.queue=Promise.resolve();this.events=[];this.closed=false;
    }
    get active(){return Boolean(this.run);}
    buffer(event,data){this.events.push([event,JSON.parse(JSON.stringify(data))]);}
    bind() {
        if(!this.run)return;
        const p=this.getPlayer(),r=this.run,b=r.battle;
        r.player.id=p.id;r.player.socketId=p.id;
        b.now=this.now;b.random=this.random;b.emit=(_p,e,d)=>this.buffer(e,d);b.onFinish=null;b.onUpdate=null;
        p.equipe=r.player.equipe;p.inbattle=true;
    }
    execute(work){const next=this.queue.then(()=>this.closed?false:work());this.queue=next.catch(()=>{});return next;}
    async atomic(change) {
        const before=this.run?codec.encode(this.run):null;
        let committed=false;
        this.events=[];
        try {
            if(await change()===false){this.events=[];return false;}
            const r=this.run;
            const receipt=await this.persist.save(this.userId,r,this.version,{emit:(e,d)=>this.buffer(e,d),random:this.random});
            committed=true;
            this.version=receipt.version;
            const finished=r.battle.finished;
            if(finished){
                r.player.equipe.pokemons=r.player.equipe.pokemons.filter(p=>!p.__darkContinentDead);
                const tracker=r.battle.resultTrackers.get(r.player);
                const lostPokemon=tracker.initial.filter(v=>v.pokemon.__darkContinentDead).map(({pokemon:p})=>({uuid:p.uuid,pokemonId:p.data.id,name:p.truename||p.name,level:p.level}));
                for(const [e,d]of this.events) {
                    if(e==='endbattle')d.summary={...d.summary,mode:'adventure',money:receipt.money,loot:receipt.loot.map(i=>`${i.name}${i.quantity>1?' ×'+i.quantity:''}`),lostPokemon};
                    if(e==='teamStateChanged')d.equipe=JSON.parse(JSON.stringify(r.player.equipe));
                }
            }
            const p=this.getPlayer();if(p){p.equipe=r.player.equipe;p.inbattle=true;}
            const events=this.events;this.events=[];
            if(finished)this.run=null;
            for(const[e,d]of events)this.emit(e,d);
            if(finished){try{await this.onFinish(receipt);}finally{if(this.getPlayer()===p&&p)p.inbattle=false;}}
            return true;
        }catch(error){
            if(!committed){this.run=before?codec.decode(before):null;this.events=[];this.bind();}
            throw error;
        }
    }
    async load(saved=null) {
        const state=saved||await this.persist.load(this.userId);this.version=state.version;this.run=state.run;this.bind();
        if(this.run)await this.atomic(()=>{
            const b=this.run.battle;b.deadline=this.now()+60000;
            this.buffer('battletrigger',this.trigger(this.run.environment,true));
            b.resume(this.run.player);return true;
        });
        return this.active;
    }
    trigger(environment,resumed=false){return {battleType:'wild',musicKind:'dark',environment,bagAllowed:true,fleeAllowed:false,resumed,message:resumed?'Le combat reprend.':'Un Pokémon sauvage apparaît !'};}
    async start(enemy,environment=null) {
        if(this.active)throw Error('Reprends d’abord ton combat.');
        const p=this.getPlayer();if(!p||!dc.isMap(p.currentmap))throw Error('Ce combat ne se trouve pas sur le Dark Continent.');
        const balls=await this.persist.loadBalls(this.userId);
        return this.atomic(()=>{
            const player={id:p.id,socketId:p.id,userId:this.userId,username:p.username,currentmap:p.currentmap,equipe:codec.decode(codec.encode(p.equipe)),items:{...balls},drifts:[],equipped:[]};
            const opponent={npc:true,currentmap:p.currentmap,equipe:{pokemons:[enemy]},items:{},drifts:[],equipped:[]};
            const run={id:randomUUID(),map:p.currentmap,x:p.x,y:p.y,environment,balls:{...balls},initialHeld:new Map(player.equipe.pokemons.map(v=>[v.uuid,v.heldItem||null])),started:new Set(player.equipe.pokemons.filter(v=>v.currentHp>0).map(v=>v.uuid)),player,enemy};
            run.battle=new DriftBattle(player,opponent,{type:'wild',emit:(_p,e,d)=>this.buffer(e,d),now:this.now,random:this.random,environment,
                rules:{darkAdventure:true,permanentDeaths:false,rewards:false,report:false,bagAllowed:true,fleeAllowed:false,musicKind:'dark'}});
            this.run=run;return true;
        });
    }
    async action(payload){
        if(!this.run)return false;
        const accepted=await this.atomic(()=>this.run.battle.action(this.run.player,payload));
        const b=this.run?.battle;
        if(!accepted&&b?.awaiting){
            this.emit('requestAction',{message:'Choisis une action disponible.',turnId:b.token,
                ...(b.replacementPhase?{replacement:true,replacementId:b.token,allowedPokemonIndexes:require('./replacementChoice').replacementIndexes(this.run.player.equipe)}:{})});
        }
        return accepted;
    }
    async tick(){const b=this.run?.battle;if(!b||b.finished||b.awaiting&&this.now()<b.deadline||!b.awaiting&&this.now()<b.nextRoundAt)return false;return this.atomic(()=>{b.tick();return true;});}
    async stop(){this.closed=true;await this.queue;}
}
module.exports={DarkBattleController};
