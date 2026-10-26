// Pure policy stress test. No server, database, socket or production account.
const assert=require('node:assert/strict'),{performance}=require('node:perf_hooks');
// Optional frozen policy for like-for-like offline performance comparisons.
if(process.env.TRAINER_AI_BASELINE) {
    const fs=require('node:fs'),Module=require('node:module'),path=require('node:path');
    const filename=require.resolve('../server/game/battle/humanTrainerAI'),baseline=new Module(filename,module);
    baseline.filename=filename;baseline.paths=Module._nodeModulePaths(path.dirname(filename));
    baseline._compile(fs.readFileSync(process.env.TRAINER_AI_BASELINE,'utf8'),filename);require.cache[filename]=baseline;
}
const ai=require('../server/game/battle/humanTrainerAI'),engine=require('../server/game/battle/battleEngine');
const factory=require('../server/game/drift/pokemonFactory'),resources=require('../server/game/battle/battleResources');
const {createDeterministicRandom}=require('../server/game/abilities/abilityDex');
const sets=[
    [6,['Flamethrower','Air Slash','Roost','Dragon Pulse'],'life_orb'],
    [9,['Surf','Ice Beam','Toxic','Protect'],'leftovers'],
    [3,['Giga Drain','Sludge Bomb','Sleep Powder','Synthesis'],'sitrus_berry'],
    [65,['Psychic','Shadow Ball','Focus Blast','Recover'],'focus_sash'],
    [143,['Body Slam','Earthquake','Curse','Rest'],'chesto_berry'],
    [212,['Bullet Punch','X-Scissor','Swords Dance','Roost'],'choice_band'],
    [130,['Waterfall','Ice Fang','Dragon Dance','Crunch'],'lum_berry'],
    [68,['Close Combat','Stone Edge','Knock Off','Drain Punch'],'assault_vest'],
    [94,['Shadow Ball','Sludge Bomb','Thunderbolt','Will-O-Wisp'],'choice_scarf'],
    [350,['Surf','Ice Beam','Recover','Toxic'],'shell_bell']
];
const previous=Math.random,latencies=[];let choices=0,switches=0,support=0;
try {
    const random=createDeterministicRandom('strategy-matrix-20261026');Math.random=random;
    function pokemon(offset,label,slot) {
        const [id,names,item]=sets[(offset+slot)%sets.length],p=factory.create(id,20+Math.floor(random()*60),true);
        p.uuid=`${label}:${offset}:${slot}`;p.abilities=names;p.movePp=names.map(n=>Math.ceil(resources.getMaxMovePp(n)*(.2+random()*.8)));p.heldItem=item;
        p.currentHp=Math.max(1,Math.floor(p.maxHp*(.1+random()*.9)));
        engine.ensureBattleData(p);p.__battle.statStages.attack=Math.floor(random()*5)-2;
        if(random()<.2)p.status=['poison','burn','paralyze'][Math.floor(random()*3)];return p;
    }
    const fixtures=[];
    for(let i=0;i<80;i++) {
        const team=Array.from({length:6},(_,s)=>pokemon(i,'npc',s)),opponentTeam=Array.from({length:6},(_,s)=>pokemon(i+3,'player',s));
        const field=engine.createBattleState();field.turn=i+1;
        field.weather={kind:[null,'rain','sun','hail','sandstorm'][i%5],turns:4};
        if(i%7===0)field.field.trickRoomTurns=2;
        if(i%4===0){field.sides.enemy.hazards.spikes=2;field.sides.player.hazards.stealthRock=true;}
        fixtures.push({team,opponentTeam,field,ownSide:field.sides.enemy,enemySide:field.sides.player,memory:{seen:{}},round:i+1,skill:.55+(i%4)*.15});
    }
    // Generation has ended. Any policy attempt to consume combat RNG now fails.
    Math.random=()=>{throw Error('Planner consumed live RNG');};
    for(const options of fixtures.slice(0,4))ai.chooseAction(options);
    for(const options of fixtures) {
        const before=JSON.stringify(options),start=performance.now(),decision=ai.chooseAction(options);latencies.push(performance.now()-start);
        assert.deepEqual(ai.chooseAction(options),decision,'Identical visible state must give the same committed action');
        assert.equal(JSON.stringify(options),before,'Planner changed a live fixture');
        if(decision.action==='attack') {
            const legal=resources.getUsableMoveIndexes(options.team[0],options.field);
            assert(legal.length?legal.includes(decision.number):decision.number===-1,'Illegal attack choice');
            if(engine.getMoveByName(options.team[0].abilities[decision.number])?.combat.damage_class==='status')support++;
        } else {assert(options.team[decision.number]?.currentHp>0);switches++;}
        choices++;
    }
    latencies.sort((a,b)=>a-b);
    const result={fixtures:fixtures.length,teamSize:6,choices,switches,support,mutations:0,rngReads:0,nondeterministicChoices:0,illegalChoices:0,
        milliseconds:{mean:latencies.reduce((n,t)=>n+t,0)/latencies.length,p50:latencies[Math.floor(latencies.length*.5)],p95:latencies[Math.floor(latencies.length*.95)],max:latencies.at(-1)}};
    console.log(JSON.stringify(result));
}finally{Math.random=previous;}
