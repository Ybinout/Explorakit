// Presentation fixtures in the authenticated compiled client. KO persistence and
// operator repairs are separately verified by real SQL tests; no production DB.
const assert = require('node:assert/strict'),
    fs = require('node:fs'),
    path = require('node:path'),
    http = require('node:http'),
    { once } = require('node:events'),
    { randomUUID, createHash } = require('node:crypto');
assert.equal(process.env.DB_TEST_NAME, 'explorakit_test');
process.env.DB_NAME = 'explorakit_test';
process.env.NODE_ENV = 'test';
const dist = process.env.RELEASE_DIST_DIR,
    engine = process.env.PRESENTATION_BROWSER || 'chromium',
    out = '/tmp/riftmon-safari-safety-' + engine;
assert(dist && fs.existsSync(dist + '/index.html'));
fs.mkdirSync(out, { recursive: true });
const { dbPool: db } = require('../server/config/database'),
    users = require('../server/persistence/userRepository'),
    content = require('../server/game/draft/content'),
    compat = require('../server/game/draft/compatibility'),
    { RaidBattle } = require('../server/game/raids/RaidBattle'),
    { make } = require('./calibrateCorruptionRaids');
const app = require('express')(),
    server = http.createServer(app),
    io = new (require('socket.io').Server)(server);
app.use(require('express').json());
app.use('/api', require('../server/http/routes'));
app.use(require('express').static(dist));
app.get('*', (_q, r) => r.sendFile(path.join(dist, 'index.html')));
io.use(require('../server/http/authMiddleware').authenticateSocket);
require('../server/realtime/socketHandler')(io);
let browser,
    page,
    user,
    success = false;
const checks = [],
    views = [],
    errors = [];
async function shot(name, w, h) {
    await page.setViewportSize({ width: w, height: h });
    await page.waitForTimeout(110);
    const shape = await page.evaluate(() => {
        const p =
                document.querySelector('.draft-inspect-backdrop') ||
                document.querySelector('.raid-guide') ||
                document.querySelector('.raid-confirm') ||
                document.querySelector('[data-draft-panel]') ||
                document.querySelector('.raid-panel'),
            r = p.getBoundingClientRect();
        return {
            width: innerWidth,
            height: innerHeight,
            left: r.left,
            right: r.right,
            top: r.top,
            bottom: r.bottom,
            overflow: p.scrollWidth > p.clientWidth + 1,
            pageWidth: document.documentElement.scrollWidth,
        };
    });
    assert(
        shape.left >= -1 &&
            shape.top >= -1 &&
            shape.right <= shape.width + 1 &&
            shape.bottom <= shape.height + 1 &&
            !shape.overflow &&
            shape.pageWidth <= shape.width + 1,
        name + JSON.stringify(shape)
    );
    await page.screenshot({ path: path.join(out, name + '.png') });
    views.push({ name, ...shape });
}
function draft() {
    const pokemon = [6, 9, 157].map((id) => {
            const p = content.pokemon(id, 50, () => 0.5);
            p.abilities = id === 157 ? ['Flamethrower'] : ['Tackle'];
            return { cardId: randomUUID(), pokemon: p };
        }),
        cards = ['Flamethrower', 'Surf', 'Spore', 'Thunderbolt'].map((move) =>
            compat.decorate({ id: randomUUID(), kind: 'move', move }, pokemon)
        );
    cards.push(
        content.view({
            id: randomUUID(),
            kind: 'ability',
            ability: 'Intimidate',
        }),
        content.view({ id: randomUUID(), kind: 'item', item: 'leftovers' }),
        content.view({ id: randomUUID(), kind: 'iv', stat: 'speed' }),
        content.view({ id: randomUUID(), kind: 'nature', nature: 'Timid' })
    );
    return {
        id: randomUUID(),
        version: 1,
        phase: 'draft',
        hostId: user.id,
        you: 0,
        level: 50,
        serverNow: Date.now(),
        deadline: Date.now() + 300000,
        round: 0,
        pick: 3,
        packSize: 8,
        participants: Array.from({ length: 4 }, (_, index) => ({
            index,
            userId: index ? null : user.id,
            name: index ? 'IA ' + index : user.username,
            bot: !!index,
            online: !index,
            count: 3,
            remaining: 8,
            ready: !!index,
        })),
        pack: cards,
        picked: null,
        collection: pokemon.map((p) =>
            content.view({ id: p.cardId, kind: 'pokemon', pokemon: p.pokemon })
        ),
        matches: [],
    };
}
function rift(safari) {
    return {
        id: randomUUID(),
        map: safari ? 'safari7' : 'jungle4',
        region: safari ? 'safari' : 'dark',
        permanentDeaths: !safari,
        name: 'Faille de corruption',
        level: 100,
        boss: {
            pokemonId: 635,
            name: 'Trioxhydre',
            level: 100,
            types: ['Dark', 'Dragon'],
        },
        reward: {
            money: 100000,
            experiencePerPokemon: 50000,
            plateChance: 0.5,
            pearl: 0,
        },
    };
}
(async () => {
    try {
        server.listen(0, '127.0.0.1');
        await once(server, 'listening');
        user = await users.createUserWithStarter(
            'SafariUI_' + randomUUID().slice(0, 8),
            randomUUID()
        );
        await db.execute(
            "UPDATE player_story_flags SET flag_value='complete' WHERE user_id=? AND flag_key='adventure_opening'",
            [user.id]
        );
        await db.execute(
            "UPDATE users SET map='draft_house',x=432,y=464 WHERE id=?",
            [user.id]
        );
        await require('../server/persistence/patchNotesRepository').acknowledge(
            user.id,
            require('../data/game/latest_patch.json').version
        );
        browser = await require('playwright')[engine].launch({
            headless: true,
        });
        const context = await browser.newContext({
            viewport: { width: 1280, height: 900 },
            hasTouch: true,
            serviceWorkers: 'block',
        });
        await context.addInitScript(
            (auth) => {
                if (location.protocol.startsWith('http'))
                    localStorage.setItem(
                        'explorakit.user',
                        JSON.stringify(auth)
                    );
            },
            {
                ...user,
                token: require('../server/config/auth').signAccessToken(user),
            }
        );
        page = await context.newPage();
        page.on('pageerror', (e) => errors.push(e.message));
        await page.goto('http://127.0.0.1:' + server.address().port + '/game');
        await page.waitForFunction(() => {
            const v = document.querySelector('.game-root')?.__vue__;
            if (
                v?.socket?.connected &&
                !v.mapLoading &&
                v.players[v.socket.id]
            ) {
                window.v = v;
                return true;
            }
            return false;
        });
        await page.evaluate(() => {
            v.updatePreferences({
                ...v.preferences,
                animationsEnabled: false,
                masterVolume: 0,
            });
            v.draftCommand = async () => {};
            v.raidCommand = async () => {};
        });
        const state = draft(),
            move = state.pack[0];
        await page.evaluate((state) => {
            v.draftState = state;
            v.draftOpen = true;
        }, state);
        await page.locator('[data-draft-panel]').waitFor();
        const first = page.locator('[data-draft-card="' + move.id + '"]');
        assert.match(
            await first.locator('[data-draft-compatibility]').innerText(),
            /1 compatible/
        );
        assert.match(
            await page
                .locator(
                    '[data-draft-card="' +
                        state.pack[2].id +
                        '"] [data-draft-compatibility]'
                )
                .innerText(),
            /Aucun compatible/
        );
        assert.equal(
            await page
                .locator(
                    '[data-draft-card="' +
                        state.pack[4].id +
                        '"] [data-draft-compatibility]'
                )
                .count(),
            0
        );
        for (const mode of ['light', 'dark']) {
            await page.evaluate(
                (mode) =>
                    v.updatePreferences({ ...v.preferences, themeMode: mode }),
                mode
            );
            for (const [w, h] of [
                [1280, 900],
                [393, 852],
                [320, 568],
                [844, 390],
            ]) {
                await shot('compatibility-' + mode + '-' + w, w, h);
                assert(
                    await page.evaluate(() =>
                        [
                            ...document.querySelectorAll(
                                '[data-draft-compatibility]'
                            ),
                        ].every((el) => el.scrollWidth <= el.clientWidth + 1)
                    )
                );
                await first.locator('[data-draft-compatibility]').click();
                await page.locator('[data-draft-compatibility-list]').waitFor();
                assert.match(
                    await page
                        .locator('[data-draft-compatibility-list]')
                        .innerText(),
                    /Dracaufeu[\s\S]*Compatible[\s\S]*Tortank[\s\S]*Incompatible[\s\S]*Typhlosion[\s\S]*Déjà connue/
                );
                await shot('compatibility-detail-' + mode + '-' + w, w, h);
                await page.keyboard.press('Escape');
            }
        }
        checks.push(
            'compact available count and species icons; tap opens legal, incompatible and already-known detail; ability cards remain free'
        );
        await page.evaluate(() => {
            v.draftState = {
                ...v.draftState,
                version: 2,
                pack: v.draftState.pack.map((c) =>
                    c.kind === 'move' ? { ...c, compatibility: [] } : c
                ),
            };
        });
        assert.match(
            await first.locator('[data-draft-compatibility]').innerText(),
            /Pas encore de Pokémon/
        );
        await shot('no-picked-pokemon', 393, 852);
        checks.push(
            'no Pokémon selected is distinguished from incompatible moves without disabling the draft choice'
        );
        await page.evaluate(() => {
            v.draftOpen = false;
            v.draftState = null;
        });
        for (const safari of [true, false]) {
            const info = rift(safari);
            await page.evaluate((info) => {
                v.raidPreview = info;
                v.raidState = null;
                v.raidPanelVisible = true;
                v.battle = false;
            }, info);
            await page.locator('.raid-panel').waitFor();
            if (safari) {
                assert(await page.locator('[data-raid-safe]').isVisible());
                assert(
                    !/Les K.O. sont définitifs ici/.test(
                        await page.locator('.raid-panel').innerText()
                    )
                );
            } else
                assert.match(
                    await page.locator('.raid-panel').innerText(),
                    /Les K.O. sont définitifs ici/
                );
            await page.locator('.raid-help').click();
            for (const [w, h] of [
                [393, 852],
                [320, 568],
                [1280, 900],
            ])
                await shot(
                    'raid-' + (safari ? 'safari' : 'dark') + '-guide-' + w,
                    w,
                    h
                );
            assert.match(
                await page.locator('.raid-guide').innerText(),
                safari ? /Kit de survie reste intact/ : /perte définitive/
            );
            await page.keyboard.press('Escape');
            await page.evaluate(() => {
                v.raidPanelVisible = false;
            });
            const party = [9, 143, 195, 6].map((id) => ({
                ownerId: user.id,
                ownerName: 'Test',
                pokemon: make(id, 100, 4, ['Splash'], 'Keen Eye'),
            }));
            for (const p of party) p.pokemon.heldItem = null;
            const boss = make(635, 100, 4, ['Splash'], 'Keen Eye');
            boss.heldItem = null;
            const b = new RaidBattle(party, boss, { seed: [1, 2, 3, 4] });
            await page.evaluate(
                ({ frame, rift }) => {
                    v.raidState = {
                        id: 'policy-fixture',
                        phase: 'active',
                        rift,
                        combat: frame,
                    };
                    v.battle = true;
                },
                { frame: b.view(user.id), rift: info }
            );
            await page.waitForFunction(() => {
                const r = document.querySelector('[data-raid-battle]')?.__vue__;
                return r && !r.loading && !r.playing;
            });
            await page.locator('[aria-label="Aide sur le raid"]').click();
            assert.match(
                await page.locator('.raid-confirm').innerText(),
                safari ? /Kit de survie reste intact/ : /définitifs sans Kit/
            );
            await shot(
                'combat-' + (safari ? 'safari' : 'dark') + '-rules',
                393,
                852
            );
            await page.keyboard.press('Escape');
            await page.evaluate(() => {
                v.raidState = null;
                v.battle = false;
            });
        }
        checks.push(
            'preview, pre-raid help and native combat help consistently explain Safari recoverable KOs versus Dark permanent losses'
        );
        assert.deepEqual(errors, []);
        success = true;
    } catch (e) {
        try {
            await page.screenshot({ path: path.join(out, 'failure.png') });
            fs.writeFileSync(
                path.join(out, 'failure.txt'),
                await page.locator('body').innerText()
            );
        } catch {}
        throw e;
    } finally {
        await browser?.close();
        await require('../server/realtime/draftManager')
            .getDraftManager(io)
            .stop();
        await require('../server/realtime/raidManager')
            .getRaidManager(io)
            .stop();
        require('../server/realtime/whitepeakClub').getClub(io).close();
        await new Promise((r) => io.close(r));
        await require('../server/realtime/accountConnection').waitForAccountConnections(
            io
        );
        if (user) await db.execute('DELETE FROM users WHERE id=?', [user.id]);
        await db.end();
        const report = {
            success,
            engine,
            checks,
            views,
            errors,
            scope: 'explicit own-collection compatibility DTO and native raid-frame presentation fixtures in authenticated compiled client; real SQL KO and recovery operations are tested separately',
            buildIndexSha256: createHash('sha256')
                .update(fs.readFileSync(dist + '/index.html'))
                .digest('hex'),
            testAccountDeleted: true,
        };
        fs.writeFileSync(
            path.join(out, 'report.json'),
            JSON.stringify(report, null, 2)
        );
        console.log(JSON.stringify(report));
    }
})().catch((e) => {
    console.error(e.stack);
    process.exitCode = 1;
});
