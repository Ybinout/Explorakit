// Compiled client + real local Socket.IO/MySQL. Only disposable explorakit_test accounts.
const assert = require('node:assert/strict'),
    fs = require('node:fs'),
    path = require('node:path'),
    http = require('node:http'),
    { once } = require('node:events'),
    { randomUUID, createHash } = require('node:crypto');
assert.equal(process.env.DB_TEST_NAME, 'explorakit_test');
process.env.DB_NAME = 'explorakit_test';
process.env.NODE_ENV = 'test';
process.env.BATTLE_DELAY_SCALE = '0';
const dist = process.env.RELEASE_DIST_DIR,
    engine = process.env.PRESENTATION_BROWSER || 'chromium',
    out =
        (process.env.PRESENTATION_OUT || '/tmp/riftmon-global-training-') +
        engine;
assert(fs.existsSync(dist + '/index.html'));
fs.mkdirSync(out, { recursive: true });
const { dbPool: db } = require('../server/config/database'),
    users = require('../server/persistence/userRepository'),
    teams = require('../server/persistence/teamRepository'),
    factory = require('../server/game/drift/pokemonFactory');
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
    raidId,
    success = false;
const errors = [],
    checks = [],
    views = [];
async function ready() {
    await page.waitForFunction(
        () => {
            const x = document.querySelector('.game-root')?.__vue__;
            if (
                x?.socket?.connected &&
                !x.mapLoading &&
                x.players[x.socket.id]
            ) {
                window.v = x;
                return true;
            }
            return false;
        },
        null,
        { timeout: 30000 }
    );
    await page.evaluate(() =>
        v.updatePreferences({
            ...v.preferences,
            masterVolume: 0,
            animationsEnabled: false,
        })
    );
}
async function shot(name, w, h, selector) {
    await page.setViewportSize({ width: w, height: h });
    await page.waitForTimeout(180);
    const shape = await page.locator(selector).evaluate((el) => {
        const r = el.getBoundingClientRect();
        return {
            left: r.left,
            right: r.right,
            top: r.top,
            bottom: r.bottom,
            width: innerWidth,
            height: innerHeight,
            pageWidth: document.documentElement.scrollWidth,
        };
    });
    assert(
        shape.left >= -1 &&
            shape.right <= w + 1 &&
            shape.top >= -1 &&
            shape.bottom <= h + 1 &&
            shape.pageWidth <= w + 1,
        name + JSON.stringify(shape)
    );
    await page.screenshot({ path: path.join(out, name + '.png') });
    views.push({ name, ...shape });
}
async function rpc(event, data = {}) {
    const r = await page.evaluate(
        ({ event, data }) =>
            new Promise((resolve, reject) =>
                v.socket
                    .timeout(15000)
                    .emit('raid:' + event, data, (e, r) =>
                        e ? reject(e) : resolve(r)
                    )
            ),
        { event, data }
    );
    assert(r.success, r.message);
    return r;
}
(async () => {
    try {
        server.listen(0, '127.0.0.1');
        await once(server, 'listening');
        const base = 'http://127.0.0.1:' + server.address().port;
        user = await users.createUserWithStarter(
            'GlobalUI_' + randomUUID().slice(0, 8),
            randomUUID()
        );
        await teams.editEquipe(user.id, {
            pokemons: [9, 6, 282, 59].map((id) =>
                factory.create(id, 150, true)
            ),
        });
        const before = JSON.stringify(
            (await teams.loadEquipe(user.id)).pokemons
        );
        for (const [k, value] of Object.entries({
            adventure_opening: 'complete',
            early_game_tutorial: JSON.stringify({
                version: 1,
                phase: 'complete',
                metWayne: true,
            }),
        }))
            await db.execute(
                'INSERT INTO player_story_flags(user_id,flag_key,flag_value) VALUES(?,?,?) ON DUPLICATE KEY UPDATE flag_value=VALUES(flag_value)',
                [user.id, k, value]
            );
        await db.execute(
            "UPDATE users SET map='ville5_maison1',x=432,y=496 WHERE id=?",
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
        page.on('console',m=>{if(m.type()==='error'&&/Error in render|TypeError|ReferenceError/.test(m.text()))errors.push(m.text());});
        await page.goto(base + '/');
        await page.locator('.mode-card.adventure').waitFor();
        for (const [w, h] of [
            [1280, 900],
            [393, 852],
            [320, 568],
        ]) {
            await page.setViewportSize({ width: w, height: h });
            await page.screenshot({
                path: path.join(out, 'home-' + w + '.png'),
            });
            const x = await page
                .locator('.mode-card.adventure')
                .evaluate((el) => ({
                    width: el.getBoundingClientRect().width,
                    height: el.getBoundingClientRect().height,
                    src: el.querySelector('img').src,
                    text: el.textContent,
                }));
            assert(x.src.includes('/animated/front/133.webp'));
            assert(!x.text.includes('multijoueur reste facultatif'));
            if (w < 400) assert(x.height > 400);
            views.push({ name: 'home-' + w, ...x });
        }
        checks.push(
            'real animated Eevee home card enlarged on desktop and mobile'
        );
        await page.goto(base + '/game');
        await ready();
        await page.evaluate(() => {
            v.clubPanel = { tab: 'duel' };
        });
        await page.locator('#house-mode-raid').click();
        await page
            .waitForFunction(() => v.raidBosses.length === 298, null, {
                timeout: 5000,
            })
            .catch(async (e) => {
                console.error(
                    'Catalog',
                    await page.evaluate(() => ({
                        map: v.map,
                        error: v.raidError,
                        busy: v.raidBusy,
                        panel: v.clubPanel,
                        raid: v.raidState,
                    }))
                );
                await page.screenshot({ path: out + '/catalog-failure.png' });
                throw e;
            });
        await page.locator('[data-training-level]').fill('555');
        for (const [w, h] of [
            [1280, 900],
            [393, 852],
            [320, 568],
            [844, 390],
        ])
            await shot('setup-' + w, w, h, '[data-whitepeak-panel]');
        await page.setViewportSize({ width: 393, height: 852 });
        await page
            .getByRole('button', { name: 'Préparer le raid', exact: false })
            .click();
        await page.waitForFunction(
            () =>
                v.raidState?.phase === 'lobby' &&
                v.raidInventory.length === 4 &&
                !v.raidBusy
        );
        raidId = await page.evaluate(() => v.raidState.id);
        assert.equal(await page.evaluate(() => v.raidState.rift.level), 555);
        assert.equal(await page.evaluate(() => v.clubPanel), null);
        if (await page.locator('.raid-guide').count()) {
            await page
                .getByRole('button', { name: 'J’ai compris', exact: true })
                .click();
            await page.waitForFunction(() => !v.raidBusy);
        }
        await shot('lobby-mobile', 393, 852, '.raid-panel');
        for (let i = 0; i < 4; i++) {
            await page.locator('.raid-selection>div>button').nth(i).click();
            await page.waitForFunction(() => !v.raidBusy);
        }
        await page
            .getByRole('button', { name: 'Je suis prêt', exact: true })
            .click();
        await page.waitForFunction(() => !v.raidBusy);
        await page
            .getByRole('button', { name: 'Lancer le raid', exact: false })
            .click();
        await page.waitForFunction(() => v.raidCombatActive);
        await shot('battle-mobile', 393, 852, '.raid-battle');
        await shot('battle-desktop', 1280, 900, '.raid-battle');
        checks.push(
            'real catalog, level555, native preparation, four selected allies and native battle'
        );
        await page.reload();
        await ready();
        await page.waitForFunction(() => v.raidCombatActive);
        assert.equal(await page.evaluate(() => v.raidState.id), raidId);
        assert.equal(
            await page.evaluate(() => v.raidState.rift.boss.level),
            555
        );
        checks.push(
            'browser reload automatically resumes the same native training raid'
        );
        // Withdraw through actual server commands; every change is checkpointed.
        for (
            let i = 0;
            i < 8 &&
            (await page.evaluate(() => v.raidState.phase === 'active'));
            i++
        ) {
            const f = await page.evaluate(() => v.raidState.combat);
            const slot = f.currentSlot;
            const b = require('../server/realtime/raidManager')
                .getRaidManager(io)
                .runs.get(raidId);
            const battle =
                require('../server/game/raids/RaidBattle').RaidBattle.restore(
                    b.combat
                );
            const chosen = slot;
            try {
                await rpc('action', {
                    token: battle.token,
                    slot: chosen,
                    action: 'retreat',
                    confirm: true,
                });
            } catch (e) {
                throw Error(
                    'Withdrawal: ' + e.message + ' keys ' + Object.keys(f)
                );
            }
        }
        assert.equal(
            JSON.stringify((await teams.loadEquipe(user.id)).pokemons),
            before
        );
        checks.push(
            'permanent team byte-for-byte unchanged after real client training'
        );
        await rpc('leave');
        for (const [map, x, y] of [
            ['route3', 24, 14],
            ['ville1', 22, 16],
            ['safari1', 18, 14],
            ['safari8', 12, 12],
            ['safari15', 9, 11],
        ]) {
            await page.evaluate(() => v.socket.disconnect());
            await require('../server/realtime/accountConnection').waitForAccountConnections(
                io
            );
            await db.execute('UPDATE users SET map=?,x=?,y=? WHERE id=?', [
                map,
                x * 32 + 16,
                y * 32 + 16,
                user.id,
            ]);
            await page.goto(base + '/game');
            await ready();
            await page.setViewportSize({ width: 1280, height: 900 });
            await page.evaluate(() =>
                v.updatePreferences({
                    ...v.preferences,
                    animationsEnabled: true,
                })
            );
            await page.waitForTimeout(600);
            if (map.startsWith('safari'))
                assert(
                    await page.evaluate(() => v.pnjs.some((p) => p.safariSign))
                );
            if (map === 'ville1') {
                assert(
                    await page.evaluate(() =>
                        v.pnjs.some(
                            (p) =>
                                p.name === 'town_bastien' &&
                                p.sprite === 'clement-walk-v3.png'
                        )
                    )
                );
                assert(
                    await page.evaluate(() =>
                        v.pnjs.some(
                            (p) =>
                                p.name === 'town_lina' &&
                                p.sprite === 'maria-blue-v1.png'
                        )
                    )
                );
            }
            await page.screenshot({
                path: path.join(out, 'world-' + map + '.png'),
            });
            views.push({ name: 'world-' + map });
            if (map === 'route3') {
                const smoke=await page.evaluate(()=>{const a=v._placeAmbience,c=a?.context;return {motion:v.preferences.animationsEnabled,reduced:v.worldWeatherReducedMotion,active:v.placeAmbienceActive,kind:a?.profile?.kind,frames:a?.frames,settings:a?.settings,pixels:c?Array.from(c.getImageData(400,110,35,45).data).filter((v,i)=>i%4===3&&v>0).length:0};});checks.push('Smoke diagnostics '+JSON.stringify(smoke));assert.equal(smoke.kind,'nrv');assert(smoke.pixels>0,'visible chimney smoke');
                await page.waitForTimeout(1000);
                await page.screenshot({
                    path: path.join(out, 'smoke-next.png'),
                });
            }
        }
        checks.push(
            'server-authored Safari signs and new town sprites render in actual world; bounded green chimney smoke'
        );
        assert.deepEqual(errors,[]);
        success = true;
    } finally {
        await browser?.close();
        await require('../server/realtime/raidManager')
            .getRaidManager(io)
            .stop();
        await require('../server/realtime/draftManager')
            .getDraftManager(io)
            .stop();
        require('../server/realtime/whitepeakClub').getClub(io).close();
        await new Promise((r) => io.close(r));
        await require('../server/realtime/accountConnection').waitForAccountConnections(
            io
        );
        if (raidId)
            await db.execute('DELETE FROM corruption_raids WHERE id=?', [
                raidId,
            ]);
        if (user) await db.execute('DELETE FROM users WHERE id=?', [user.id]);
        await db.end();
        const report = {
            success,
            engine,
            checks,
            views,
            errors,
            scope: 'real local HTTP/Socket.IO/MySQL training and home presentation; WebKit is not a physical iPhone test',
            buildIndexSha256: createHash('sha256')
                .update(fs.readFileSync(dist + '/index.html'))
                .digest('hex'),
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
