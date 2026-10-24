const test = require('node:test'),
    assert = require('node:assert/strict');
const engine = require('../server/game/battle/battleEngine');
const factory = require('../server/game/drift/pokemonFactory');
const { getMaxMovePp, getForcedMove } = require('../server/game/battle/battleResources');
const { planTurnActions, pendingMove } = require('../server/game/battle/turnActions');
test('Danseuse bypasses an existing Choice lock without replacing it or spending PP', () => fixed(() => {
    const a=mon(['Swords Dance']),b=mon(['Tackle']),s=engine.createBattleState();
    b.passiveAbility='Dancer';b.heldItem='choice_band';
    hit(b,a,'Tackle',s);assert.equal(b.__battle.choiceMove,'Tackle');const pp=b.movePp[0];
    hit(a,b,'Swords Dance',s);
    assert.equal(b.__battle.statStages.attack,2);assert.equal(b.__battle.choiceMove,'Tackle');assert.equal(b.movePp[0],pp);
}));
function mon(moves) {
    const p = factory.create(52, 40, true);
    p.passiveAbility = null;
    p.heldItem = null;
    p.abilities = moves;
    p.movePp = moves.map(getMaxMovePp);
    p.currentHp = p.maxHp = 1000;
    return p;
}
function fixed(work) {
    const old = Math.random;
    try {
        Math.random = () => 0.5;
        return work();
    } finally {
        Math.random = old;
    }
}
function hit(a, b, name, s) {
    return engine.useattack(name, a, b, {
        battleState: s,
        attackerSide: s.sides.player,
        defenderSide: s.sides.enemy,
        attackerTeam: [a],
        defenderTeam: [b],
    });
}
for (const automatic of ['bounce', 'coat', 'snatch', 'dance'])
    test(`${automatic}: automatic move neither spends pending action nor invalidates opening Bluff`, () =>
        fixed(() => {
            const name = ['bounce', 'coat'].includes(automatic) ? 'Growl' : 'Swords Dance';
            const a = mon([name]),
                b = mon(['Fake Out']),
                s = engine.createBattleState();
            if (automatic === 'bounce') b.passiveAbility = 'Magic Bounce';
            if (automatic === 'dance') b.passiveAbility = 'Dancer';
            if (automatic === 'coat') engine.ensureBattleData(b).magicCoat = true;
            if (automatic === 'snatch') engine.ensureBattleData(b).snatch = true;
            planTurnActions(s, [
                { pokemon: a, action: 'attack', moveName: name },
                { pokemon: b, action: 'attack', moveName: 'Fake Out' },
            ]);
            hit(a, b, name, s);
            assert.equal(pendingMove(s, b), 'Fake Out');
            assert.equal(b.__battle.activeMoveActions, 0);
            assert.equal(b.movePp[0], 10);
            const first = hit(b, a, 'Fake Out', s);
            assert(first.damage > 0);
            assert.equal(b.__battle.activeMoveActions, 1);
            const second = hit(b, a, 'Fake Out', s);
            assert.equal(second.damage, 0);
            assert(second.blocked);
        }));
test('a reflected status does not make a pending damaging action invisible to Coup Bas', () =>
    fixed(() => {
        const a = mon(['Growl', 'Sucker Punch']),
            b = mon(['Tackle']),
            s = engine.createBattleState();
        b.passiveAbility = 'Magic Bounce';
        planTurnActions(s, [
            { pokemon: a, action: 'attack', moveName: 'Growl' },
            { pokemon: b, action: 'attack', moveName: 'Tackle' },
        ]);
        hit(a, b, 'Growl', s);
        assert.equal(pendingMove(s, b), 'Tackle');
        assert(hit(a, b, 'Sucker Punch', s).damage > 0);
    }));
for (const forced of ['Fly', 'Hyper Beam', 'Bide'])
    test(`Danseuse does not release, consume or replace pending ${forced}`, () =>
        fixed(() => {
            const a = mon(['Swords Dance']),
                b = mon([forced]),
                s = engine.createBattleState();
            b.passiveAbility = 'Dancer';
            hit(b, a, forced, s);
            const data = b.__battle,
                pp = b.movePp[0],
                counter = data.activeMoveActions;
            const before = { charge: data.chargeMove, recharge: data.rechargeMove, bide: data.bideTurns };
            const r = hit(a, b, 'Swords Dance', s);
            assert.match(r.messages.join(' '), /Danseuse/);
            assert.equal(b.__battle.statStages.attack, 2);
            assert.equal(b.movePp[0], pp);
            assert.equal(b.__battle.activeMoveActions, counter);
            assert.deepEqual(
                { charge: data.chargeMove, recharge: data.rechargeMove, bide: data.bideTurns },
                before
            );
            assert.equal(getForcedMove(b), forced);
        }));
test('recharge is an inability to act, with its message before presentation and no new PP cost', () =>
    fixed(() => {
        const a = mon(['Hyper Beam']),
            b = mon(['Splash']),
            s = engine.createBattleState();
        hit(a, b, 'Hyper Beam', s);
        const pp = a.movePp[0];
        const r = hit(a, b, 'Hyper Beam', s);
        assert.equal(r.actionPrevented, true);
        assert.equal(r.damage, 0);
        assert.equal(a.movePp[0], pp);
        assert.match(r.beforeActionMessages.join(' '), /recharger/);
        assert.equal(getForcedMove(a), null);
    }));
test('empty PP presents Struggle, while forced charge still presents the pending move', () =>
    fixed(() => {
        const { prepareMoveAnimation } = require('../server/game/battle/battleEvents');
        const a = mon(['Water Gun']),
            b = mon(['Splash']),
            s = engine.createBattleState();
        a.movePp = [0];
        assert.deepEqual(prepareMoveAnimation(a, b, 'Water Gun', s), {
            moveName: 'Struggle',
            phase: null,
            moveType: 'Normal',
            moveTarget: 'single',
            damageClass: 'physical',
        });
        const r = hit(a, b, 'Water Gun', s);
        assert.equal(r.moveName, 'Struggle');
        assert.equal(a.__battle.activeMoveActions, 1);
        const charger = mon(['Fly']);
        hit(charger, b, 'Fly', s);
        charger.movePp = [0];
        const animation = prepareMoveAnimation(charger, b, 'Splash', s);
        assert.equal(animation.moveName, 'Fly');
        assert.equal(animation.phase, 'strike');
    }));
