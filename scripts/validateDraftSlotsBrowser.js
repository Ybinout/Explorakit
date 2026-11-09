// Built client, real HTTP/Socket.IO/MySQL; deterministic entropy is confined to this recipe.
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
    out =
        (process.env.PRESENTATION_OUT || '/tmp/riftmon-draft-slots-') + engine;
assert(fs.existsSync(dist + '/index.html'));
fs.mkdirSync(out, { recursive: true });
const { dbPool: db } = require('../server/config/database'),
    users = require('../server/persistence/userRepository'),
    slots = require('../server/realtime/casinoSlots'),
    repo = require('../server/persistence/casinoSlotsRepository'),
    originalManager = slots.getSlotsManager;
let manager,
    roll = 995000;
slots.getSlotsManager = () =>
    manager ||
    (manager = slots.createSlotsManager({
        rng: (n) => (n === 1000000 ? roll : 0),
    }));
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
const errors = [],
    checks = [],
    views = [];
async function ready() {
    await page.waitForFunction(
        () => {
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
        },
        null,
        { timeout: 30000 }
    );
    await page.evaluate(() =>
        v.updatePreferences({
            ...v.preferences,
            masterVolume: 0,
            animationsEnabled: true,
        })
    );
}
async function shot(name, w, h, selector = '[data-slots-panel]') {
    await page.setViewportSize({ width: w, height: h });
    await page.waitForTimeout(130);
    const bounds = await page.locator(selector).evaluate((el) => {
        const r = el.getBoundingClientRect();
        return {
            left: r.left,
            right: r.right,
            top: r.top,
            bottom: r.bottom,
            pageWidth: document.documentElement.scrollWidth,
        };
    });
    assert(
        bounds.left >= -1 &&
            bounds.right <= w + 1 &&
            bounds.top >= -1 &&
            bounds.bottom <= h + 1 &&
            bounds.pageWidth <= w + 1,
        name + JSON.stringify(bounds)
    );
    await page.screenshot({ path: path.join(out, name + '.png') });
    views.push({ name, w, h, ...bounds });
}
async function pull(touch = false) {
    const box = await page.locator('.slots-lever').boundingBox(),
        x = box.x + box.width / 2,
        y = box.y + 18;
    if (touch && engine === 'chromium') {
        const c = await page.context().newCDPSession(page);
        await c.send('Input.dispatchTouchEvent', {
            type: 'touchStart',
            touchPoints: [{ x, y }],
        });
        for (let i = 1; i <= 10; i++) {
            await c.send('Input.dispatchTouchEvent', {
                type: 'touchMove',
                touchPoints: [{ x, y: y + i * 5 }],
            });
            await page.waitForTimeout(12);
        }
        await c.send('Input.dispatchTouchEvent', {
            type: 'touchEnd',
            touchPoints: [],
        });
        await c.detach();
    } else {
        await page.mouse.move(x, y);
        await page.mouse.down();
        await page.mouse.move(x, y + 51, { steps: 12 });
        await page.mouse.up();
    }
    await page.waitForFunction(
        () => v.slotsState?.spin?.phase === 'spinning' && !v.slotsBusy
    );
}
(async () => {
    try {
        server.listen(0, '127.0.0.1');
        await once(server, 'listening');
        user = await users.createUserWithStarter(
            'SlotsUI_' + randomUUID().slice(0, 8),
            randomUUID()
        );
        await db.execute(
            "UPDATE users SET money=2000000,map='ville5_maison2',x=112,y=240 WHERE id=?",
            [user.id]
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
        await require('../server/persistence/patchNotesRepository').acknowledge(
            user.id,
            require('../data/game/latest_patch.json').version
        );
        browser = await require('playwright')[engine].launch({
            headless: true,
        });
        const c = await browser.newContext({
            viewport: { width: 1280, height: 900 },
            hasTouch: true,
            serviceWorkers: 'block',
        });
        await c.addInitScript(
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
        page = await c.newPage();
        page.on('pageerror', (e) => errors.push(e.message));
        page.on('console', (m) => {
            if (
                m.type() === 'error' &&
                /Error in render|TypeError|ReferenceError/.test(m.text())
            )
                errors.push(m.text());
        });
        await page.goto('http://127.0.0.1:' + server.address().port + '/');
        await page.locator('.mode-card.adventure').click();
        await ready();
        await page.waitForFunction(() => v.interactionHint?.available);
        const p = manager.contexts.get(user.id).getPlayer();
        await page.keyboard.press('ArrowLeft');
        await page.waitForTimeout(180);
        assert.equal(p.x, 112);
        checks.push(
            'machine hitbox blocks native movement without changing the base casino map'
        );
        await page.keyboard.press('Space');
        await page.locator('[data-slots-panel]').waitFor();
        await page.locator('.slots-lever:not(:disabled)').waitFor();
        assert.equal(await page.evaluate(() => v.slotsMachine), 1);
        for (const [w, h] of [
            [1280, 900],
            [393, 852],
            [320, 568],
            [844, 390],
        ])
            await shot('idle-' + w, w, h);
        await page.setViewportSize({ width: 1280, height: 900 });
        await pull();
        assert.equal(
            Number(
                (
                    await db.execute('SELECT money FROM users WHERE id=?', [
                        user.id,
                    ])
                )[0][0].money
            ),
            1990000
        );
        const first = await page
            .locator('.slots-strip')
            .first()
            .evaluate((el) => getComputedStyle(el).transform);
        await page.waitForTimeout(350);
        const second = await page
            .locator('.slots-strip')
            .first()
            .evaluate((el) => getComputedStyle(el).transform);
        assert.notEqual(first, second);
        checks.push(
            'mouse lever, three vertical animated reels and debit before payout'
        );
        await shot('spinning', 1280, 900);
        await page
            .getByRole('button', { name: 'Fermer la machine', exact: true })
            .click();
        await page.reload();
        await ready();
        await page.waitForFunction(() => v.slotsOpen);
        await page.waitForFunction(
            () => v.slotsState?.spin?.phase === 'result',
            {},
            { timeout: 12000 }
        );
        assert.equal(
            await page.evaluate(() => v.slotsState.spin.payout),
            100000
        );
        await page.waitForFunction(() => v.progressionState.money === 2090000);
        checks.push(
            'close and reconnect resume the same recorded jackpot; credit occurs once'
        );
        for (const [w, h] of [
            [1280, 900],
            [393, 852],
            [320, 568],
            [844, 390],
        ])
            await shot('jackpot-' + w, w, h);
        roll = 505000;
        await page.setViewportSize({ width: 393, height: 852 });
        await pull(true);
        await page.waitForFunction(
            () =>
                Date.now() +
                    v.slotsState.offset -
                    v.slotsState.spin.startedAt >=
                3150
        );
        const stopped = await page
            .locator('.slots-strip')
            .evaluateAll((a) => a.map((el) => getComputedStyle(el).transform));
        await page.waitForTimeout(200);
        const later = await page
            .locator('.slots-strip')
            .evaluateAll((a) => a.map((el) => getComputedStyle(el).transform));
        assert.equal(stopped[0], later[0]);
        assert.notEqual(stopped[2], later[2]);
        checks.push('reels decelerate and stop successively before the payout');
        await page.waitForFunction(
            () => v.slotsState?.spin?.phase === 'result',
            {},
            { timeout: 12000 }
        );
        assert.equal(await page.evaluate(() => v.slotsState.spin.payout), 5000);
        await page.waitForFunction(() => v.progressionState.money === 2085000);
        checks.push(
            engine === 'chromium'
                ? 'real touchscreen lever drag; pair returns half the stake'
                : 'small-screen lever drag; pair returns half the stake'
        );
        await shot('pair-mobile', 393, 852);
        await page.locator('.slots-paytable summary').click();
        await shot('paytable-mobile', 393, 852);
        await page.locator('.slots-paytable summary').click();
        await page.locator('.slots-lever').scrollIntoViewIfNeeded();
        roll = 0;
        await pull(true);
        await page.evaluate(() => v.socket.disconnect());
        await require('../server/realtime/accountConnection').waitForAccountConnections(
            io
        );
        await page.waitForTimeout(5600);
        await page.evaluate(() => v.socket.connect());
        await ready();
        await page.waitForFunction(
            () =>
                v.slotsState?.spin?.phase === 'result' &&
                v.slotsState.spin.payout === 0 &&
                !v.slotsBusy
        );
        assert.equal(
            await page.evaluate(() => v.progressionState.money),
            2075000
        );
        checks.push(
            'a result settled during a long disconnect is resynchronized without a new debit'
        );

        await page
            .getByRole('button', { name: 'Fermer la machine', exact: true })
            .click();
        await page.context().close();
        await require('../server/realtime/accountConnection').waitForAccountConnections(
            io
        );
        await db.execute(
            "UPDATE users SET map='ville5_maison2',x=112,y=368 WHERE id=?",
            [user.id]
        );
        const c2 = await browser.newContext({
            viewport: { width: 1280, height: 900 },
            serviceWorkers: 'block',
        });
        await c2.addInitScript(
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
        page = await c2.newPage();
        page.on('pageerror', (e) => errors.push(e.message));
        await page.goto('http://127.0.0.1:' + server.address().port + '/');
        await page.locator('.mode-card.adventure').click();
        await ready();
        await page.keyboard.press('Space');
        await page.locator('[data-slots-panel]').waitFor();
        assert.equal(await page.evaluate(() => v.slotsMachine), 2);
        checks.push('second physical machine is interactive');
        await page
            .getByRole('button', { name: 'Fermer la machine', exact: true })
            .click();
        await shot('casino-room', 1280, 900, '.game-stage');
        await page.evaluate(() => v.socket.disconnect());
        await require('../server/realtime/accountConnection').waitForAccountConnections(
            io
        );
        await db.execute(
            "UPDATE users SET map='ville1',x=720,y=528 WHERE id=?",
            [user.id]
        );
        await page.goto('http://127.0.0.1:' + server.address().port + '/game');
        await ready();
        await page.waitForFunction(
            () =>
                v.pnjs.some(
                    (p) =>
                        p.name === 'town_bastien' &&
                        p.sprite === 'clement-walk-v4.png'
                ) &&
                v.pnjs.some(
                    (p) =>
                        p.name === 'town_lina' &&
                        p.sprite === 'maria-blue-v1.png'
                )
        );
        await page.waitForTimeout(500);
        await shot('city-sprites', 1280, 900, '.game-stage');
        await shot('city-sprites-mobile', 393, 852, '.game-stage');
        checks.push(
            'real city actors use the shorter twelve-frame Clement sheet and unchanged Maria artwork'
        );

        const row = await repo.read(user.id);
        assert.equal(row.settle_at, null);
        assert.equal(
            JSON.parse(
                typeof row.snapshot === 'string'
                    ? row.snapshot
                    : JSON.stringify(row.snapshot)
            ).payout,
            0
        );
        assert.deepEqual(errors, []);
        success = true;
    } catch (e) {
        console.error(e);
        if (page) {
            console.error(
                await page
                    .evaluate(() => ({
                        map: window.v?.map,
                        state: window.v?.slotsState,
                        error: window.v?.slotsError,
                        busy: window.v?.slotsBusy,
                        position: window.v?.players[window.v?.socket?.id],
                    }))
                    .catch(() => ({}))
            );
            await page
                .screenshot({ path: out + '/failure.png' })
                .catch(() => {});
        }
        process.exitCode = 1;
    } finally {
        await browser?.close();
        await manager?.stop();
        slots.getSlotsManager = originalManager;
        require('../server/realtime/housing').getHousingManager(io).stop();
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
        if (user) await db.execute('DELETE FROM users WHERE id=?', [user.id]);
        await db.end();
        const report = {
            success,
            engine,
            checks,
            views,
            errors,
            buildIndexSha256: createHash('sha256')
                .update(fs.readFileSync(dist + '/index.html'))
                .digest('hex'),
            scope: 'Compiled client, real local HTTP/Socket.IO/MySQL. Deterministic entropy only in this recipe. Chromium touch CDP and mouse input; WebKit is not a physical iPhone test.',
        };
        fs.writeFileSync(out + '/report.json', JSON.stringify(report, null, 2));
        console.log(JSON.stringify(report));
    }
})();
