const test = require('node:test');
const assert = require('node:assert/strict');
const {make} = require('../scripts/calibrateCorruptionRaids');
const engine = require('../server/game/battle/battleEngine');
const {calculate} = require('../server/game/strategy/damageCalculator');
const berries = require('../data/game/items.json').items.filter(i => i.mutationBerry);
const {DoublesBattle} = require('../server/game/doubles/doublesBattle');
const {RaidBattle} = require('../server/game/raids/RaidBattle');
const codec = require('../server/game/drift/checkpointCodec');
const types = {
    Normal:'Tri Attack', Fire:'Flamethrower', Water:'Surf', Electric:'Thunderbolt',
    Grass:'Energy Ball', Ice:'Ice Beam', Fighting:'Aura Sphere', Poison:'Sludge Bomb',
    Ground:'Earth Power', Flying:'Air Slash', Psychic:'Psychic', Bug:'Bug Buzz',
    Rock:'Power Gem', Ghost:'Shadow Ball', Dragon:'Dragon Pulse', Dark:'Dark Pulse',
    Steel:'Flash Cannon', Fairy:'Moonblast'
};
const statNames = {attack:'atk', defense:'def', specialAttack:'spa', specialDefense:'spd', speed:'spe'};
function mon(item = null, move = 'Tri Attack', id = 143) {
    const p = make(id,100,4,[move],'Keen Eye');
    p.heldItem = item;
    return p;
}
function relevantMove(item) {
    const b = item.mutationBerry;
    return b.bonus.type ? types[b.bonus.type] : b.bonus.stat === 'speed' ? 'Electro Ball' :
        ['attack','defense'].includes(b.bonus.stat) ? 'Body Slam' : 'Tri Attack';
}
function calc(team, options = {}) {
    return calculate(team,{attacker:team[0].uuid,defender:team[1].uuid,move:0,options});
}
function native(team, options = {}) {
    const [a,d] = structuredClone(team), state = engine.createBattleState({battleType:'trainer'});
    for (const [p,side] of [[a,'attacker'],[d,'defender']]) {
        p.__battle = {statStages:{...options[side+'Boosts']}};
        if (options.commonLevel) {
            Object.setPrototypeOf(p,require('../server/game/models/Pokemon').prototype);
            p.level = options.commonLevel; p.recalculateStats();
            p.currentHp = Math.floor(p.maxHp * (options[side+'HpPercent'] ?? 100) / 100);
        } else p.currentHp = options[side+'Hp'] ?? p.currentHp;
        p.status = options[side+'Status'] || p.status;
        engine.ensureBattleData(p);
    }
    state.turn = 2;
    state.weather = {kind:options.weather || null,turns:5};
    engine.applySwitchInEffects(a,state.sides.player,state.sides.enemy,state,d);
    engine.applySwitchInEffects(d,state.sides.enemy,state.sides.player,state,a);
    const hp = d.currentHp;
    const result = engine.useattack(a.abilities[0],a,d,{battleState:state,
        attackerSide:state.sides.player,defenderSide:state.sides.enemy,
        consumePp:false,skipTurnStart:true,damagePreview:{roll:.9,critical:!!options.critical}});
    return {damage:hp-d.currentHp,a,d,hp,result};
}

test('all 126 mutation berries match actual single-battle damage in the calculator, on either side', () => {
    for (const item of berries) for (const side of [0,1]) {
        const move = relevantMove(item), team = [mon(null,move),mon(null,'Splash')];
        team[side].heldItem = item.key;
        const before = JSON.stringify(team), actual = native(team), result = calc(team);
        assert.equal(result.min,actual.damage,item.key+' side'+side);
        assert.equal(result.max,actual.damage,item.key+' side'+side);
        assert.equal(result.defenderHp,actual.hp,item.key+' entry HP');
        assert.equal(result.defenderMaxHp,actual.d.maxHp,item.key+' temporary max HP');
        assert.equal(result.entryItems.length,1,item.key);
        assert(result.notes.some(n => n.includes(item.name) && n.includes('bonus et malus')));
        assert.equal(JSON.stringify(team),before,'calculator must never spend '+item.key);
    }
});

test('common-level recalculation, HP ratios, stages, statuses and two berries use the same native activation', () => {
    const team = [mon('mutant_offense_normal_legendary_berry','Body Slam'),mon('mutant_defense_normal_legendary_berry','Splash')];
    for (const commonLevel of [0,50,150,250]) {
        const options = {commonLevel,attackerHpPercent:45,defenderHpPercent:70,
            attackerStatus:'burn',attackerBoosts:{attack:2},defenderBoosts:{defense:1}};
        const before = JSON.stringify(team), r = calc(team,options), real = native(team,options);
        assert.equal(r.max,real.damage); assert.equal(r.defenderMaxHp,real.d.maxHp);
        assert.equal(r.defenderHp,real.hp); assert.equal(r.entryItems.length,2);
        assert.equal(JSON.stringify(team),before);
    }
    const hp = [mon('mutant_stat_maxhp_legendary_berry'),mon('mutant_stat_maxhp_rare_berry','Splash')];
    const r = calc(hp,{commonLevel:150,attackerHpPercent:50,defenderHpPercent:50}), real = native(hp,{commonLevel:150,attackerHpPercent:50,defenderHpPercent:50});
    assert.equal(r.simulated.attacker.maxHp,real.a.maxHp);
    assert.equal(r.defenderMaxHp,real.d.maxHp); assert.equal(r.defenderHp,real.hp);
    assert.equal(r.maxPercent,r.max/real.d.maxHp*100);
});

test('Unnerve, Klutz and fainted holders block activation; ordinary immediate berries also match battle entry', () => {
    const t = [mon('mutant_offense_normal_common_berry'),mon(null,'Splash')];
    const plain = calc([mon(),mon(null,'Splash')]).max;
    for (const blocked of ['Unnerve','Klutz','fainted']) {
        const team = structuredClone(t);
        if (blocked==='Unnerve') team[1].passiveAbility='Unnerve';
        if (blocked==='Klutz') team[0].passiveAbility='Klutz';
        if (blocked==='fainted') team[0].currentHp=0;
        const r=calc(team), before=JSON.stringify(team);
        assert.equal(r.entryItems.length,0,blocked);
        if (blocked!=='fainted') assert.equal(r.max,plain,blocked);
        assert.equal(JSON.stringify(team),before);
    }
    for (const key of ['liechi_berry','petaya_berry','ganlon_berry','apicot_berry','salac_berry','oran_berry','sitrus_berry','rawst_berry']) {
        const team=[mon(key,'Body Slam'),mon(key,'Splash')];
        const options={attackerHp:Math.floor(team[0].maxHp/5),defenderHp:Math.floor(team[1].maxHp/5),attackerStatus:'burn'};
        assert.equal(calc(team,options).max,native(team,options).damage,key);
    }
});

test('classic and corrupted damage equipment is included, with ability suppression and no real consumption', () => {
    for (const [key,move] of [['life_orb','Tri Attack'],['choice_band','Body Slam'],['choice_specs','Tri Attack'],['muscle_band','Body Slam'],['wise_glasses','Tri Attack'],['silk_scarf','Tri Attack'],['death_orb','Tri Attack'],['corrupted_choice_band','Body Slam'],['corrupted_choice_specs','Tri Attack']]) {
        const team=[mon(key,move),mon(null,'Splash')];
        if (key.startsWith('corrupted_')||key==='death_orb') team[0].corruption={version:1,revision:1,permanent:true,modules:{}};
        const base=calc([mon(null,move),mon(null,'Splash')]).max, before=JSON.stringify(team);
        assert(calc(team).max>base,key); assert.equal(calc(team).max,native(team).damage,key);
        team[0].passiveAbility='Klutz'; assert.equal(calc(team).max,base,key+' suppressed');
        team[0].passiveAbility='Keen Eye'; assert.equal(JSON.stringify(team),before);
    }
    for (const key of ['assault_vest','eviolite','focus_sash','chilan_berry']) {
        const team=[mon(null,'Tri Attack'),mon(key,'Splash',key==='eviolite'?113:143)];
        assert.equal(calc(team).max,native(team).damage,key);
    }
});

function simulator(item, format, side=0) {
    const left=[mon(side===0?item:null),mon(null,'Splash'),mon(null,'Splash'),mon(null,'Splash')];
    const right=mon(side===1?item:null,'Splash');
    if (format==='raid') {
        const b=new RaidBattle(left.map((pokemon,i)=>({pokemon,ownerId:i%2+1,ownerName:'Test'})),right,{seed:[1,2,3,4],now:()=>1000});
        return {b,sim:b.sim,a:b.sim.p1.active[0],d:b.sim.p2.active[0],holder:side===0?b.sim.p1.active[0]:b.sim.p2.active[0]};
    }
    const players=[{id:1,username:'A',equipe:{pokemons:left}},{id:2,username:'B',equipe:{pokemons:[right,mon(null,'Splash'),mon(null,'Splash')]}}];
    const b=new DoublesBattle(...players,{emit(){}});
    return {b,sim:b.sim,a:b.sim.p1.active[0],d:b.sim.p2.active[0],holder:side===0?b.sim.p1.active[0]:b.sim.p2.active[0]};
}
function damage(f,type='Normal',category='Special') {
    f.sim.prng.setSeed('1,2,3,4');
    return f.sim.actions.getDamage(f.a,f.d,f.sim.dex.getActiveMove({...f.sim.dex.moves.get('triattack'),type,category,basePower:80,willCrit:false}));
}

for (const format of ['double','raid']) test('all 126 mutations apply real damage/stat/HP effects in '+format+', with correct penalties', () => {
    const plain=simulator(null,format), baseStats=Object.fromEntries(Object.keys(statNames).map(s=>[s,plain.a.getStat(statNames[s])])), baseHp=plain.a.maxhp;
    for (const item of berries) {
        const b=item.mutationBerry, f=simulator(item.key,format);
        assert.equal(f.holder.item,'',item.key); assert(f.holder.volatiles.riftmutation,item.key);
        assert.equal(f.holder.m.berrySpent.length,1,item.key);
        for (const [stat,key] of Object.entries(statNames)) {
            const factor=(b.bonus.kind==='stat'&&b.bonus.stat===stat?1+b.bonus.amount:1)*(b.penalty?.stat===stat?b.penalty.factor:1);
            const stage=b.entryStage?.stat===stat?1.5:1;
            assert(Math.abs(f.holder.getStat(key)-baseStats[stat]*factor*stage)<=3,item.key+' '+stat);
        }
        const hpFactor=(b.bonus.stat==='maxHp'?1+b.bonus.amount:1)*(b.penalty?.stat==='maxHp'?b.penalty.factor:1);
        assert.equal(f.holder.maxhp,Math.floor(baseHp*hpFactor),item.key+' HP');
        if (b.bonus.kind==='offense') {
            // Same attacker build/penalty and stages, then remove only the type bonus.
            const boosted=damage(f,b.bonus.type),effect=f.holder.volatiles.riftmutation.berry.bonus;
            f.holder.volatiles.riftmutation.berry.bonus={...effect,type:'No matching type'};
            const ordinary=damage(f,b.bonus.type);
            assert(Math.abs(boosted-ordinary*(1+b.bonus.amount))<=3,item.key+' offensive damage');
        }
        if (b.bonus.kind==='defense') {
            const g=simulator(item.key,format,1),reduced=damage(g,b.bonus.type),effect=g.holder.volatiles.riftmutation.berry.bonus;
            g.holder.volatiles.riftmutation.berry.bonus={...effect,type:'No matching type'};
            const ordinary=damage(g,b.bonus.type);
            assert(Math.abs(reduced-ordinary*(1-b.bonus.amount))<=3,item.key+' defensive damage');
        }
    }
});

test('raid checkpoint retains actual berry damage, stat penalties and a single consumption record', () => {
    for (const key of ['mutant_offense_normal_legendary_berry','mutant_stat_attack_legendary_berry','mutant_stat_maxhp_legendary_berry']) {
        const f=simulator(key,'raid'), expected=damage(f);
        const restored=RaidBattle.restore(codec.decode(codec.encode(f.b.snapshot())),()=>2000);
        const r={b:restored,sim:restored.sim,a:restored.sim.p1.active[0],d:restored.sim.p2.active[0]};
        assert.equal(damage(r),expected,key); assert.equal(r.a.m.berrySpent.length,1);
        assert.deepEqual(r.a.volatiles.riftmutation.berry,f.a.volatiles.riftmutation.berry);
    }
});
