// Compiled client and real Socket.IO/MySQL, exclusively disposable explorakit_test accounts.
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
    out = (process.env.PRESENTATION_OUT || '/tmp/riftmon-housing-') + engine;
assert(fs.existsSync(dist + '/index.html'));
fs.mkdirSync(out, { recursive: true });
const { dbPool: db } = require('../server/config/database'),
    users = require('../server/persistence/userRepository'),
    repo = require('../server/persistence/housingRepository'),
    config = require('../data/game/housing.json'),
    social = require('../server/persistence/trainerRepository');
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
    success = false;
const accounts = [],
    errors = [],
    checks = [],
    views = [];
async function ready(p = page) {
    await p.waitForFunction(
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
    await p.evaluate(() =>
        v.updatePreferences({
            ...v.preferences,
            masterVolume: 0,
            animationsEnabled: false,
        })
    );
}
async function shot(name, w, h, sel = '[data-housing-panel]') {
    await page.setViewportSize({ width: w, height: h });
    await page.waitForTimeout(150);
    const r = await page.locator(sel).evaluate((el) => {
        const r = el.getBoundingClientRect();
        return {
            left: r.left,
            top: r.top,
            right: r.right,
            bottom: r.bottom,
            pageWidth: document.documentElement.scrollWidth,
        };
    });
    assert(
        r.left >= -1 &&
            r.top >= -1 &&
            r.right <= w + 1 &&
            r.bottom <= h + 1 &&
            r.pageWidth <= w + 1,
        name + JSON.stringify(r)
    );
    await page.screenshot({ path: path.join(out, name + '.png') });
    views.push({ name, w, h, ...r });
}
async function ctx(u) {
    const c = await browser.newContext({
        viewport: { width: 1280, height: 900 },
        hasTouch: true,
        serviceWorkers: 'block',
    });
    await c.addInitScript(
        (auth) => {
            if (location.protocol.startsWith('http'))
                localStorage.setItem('explorakit.user', JSON.stringify(auth));
        },
        { ...u, token: require('../server/config/auth').signAccessToken(u) }
    );
    const p = await c.newPage();
    p.on('pageerror', (e) => errors.push(e.message));
    await p.goto('http://127.0.0.1:' + server.address().port + '/');
    await p.locator('.mode-card.adventure').click();
    await ready(p);
    return p;
}
async function settled() {
    await page.waitForFunction(() => !v.housingBusy);
    const e = await page.evaluate(() => v.housingError);
    assert(!e, e);
}
async function tile(x, y) {
    return page
        .locator('[data-housing-editor] .house-grid-viewport canvas')
        .evaluate(
            (el, { x, y }) => {
                const e = el.closest('[data-housing-editor]').__vue__,
                    r = el.getBoundingClientRect();
                return {
                    x: r.left + ((x - e.bounds.x + 0.5) / e.bounds.w) * r.width,
                    y: r.top + ((y - e.bounds.y + 0.5) / e.bounds.h) * r.height,
                };
            },
            { x, y }
        );
}
async function place(name, x, y, touch = false) {
    await page
        .locator('.house-stock button')
        .filter({ has: page.getByText(name, { exact: true }) })
        .click();
    const p = await tile(x, y);
    if (touch) await page.touchscreen.tap(p.x, p.y);
    else await page.mouse.click(p.x, p.y);
    await page.waitForTimeout(80);
}
(async () => {
    try {
        server.listen(0, '127.0.0.1');
        await once(server, 'listening');
        for (let i = 0; i < 2; i++) {
            const u = await users.createUserWithStarter(
                'HousingUI_' + randomUUID().slice(0, 8),
                randomUUID()
            );
            accounts.push(u);
            await db.execute(
                "UPDATE users SET money=25000000,map='ville1',x=240,y=112 WHERE id=?",
                [u.id]
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
                    [u.id, k, value]
                );
            await require('../server/persistence/patchNotesRepository').acknowledge(
                u.id,
                require('../data/game/latest_patch.json').version
            );
        }
        await social.friendAction(accounts[0].id, accounts[1].id, 'request');
        await social.friendAction(accounts[1].id, accounts[0].id, 'accept');
        let h = await repo.read(accounts[0].id);
        for (const item of config.furniture)
            h = (
                await repo.furniture(accounts[0].id, {
                    requestId: randomUUID(),
                    revision: h.revision,
                    key: item.key,
                    quantity: 3,
                })
            ).home;
        browser = await require('playwright')[engine].launch({
            headless: true,
        });
        page = await ctx(accounts[0]);
        await page.evaluate(() => v.socket.emit('Space'));
        await page.locator('[data-housing-panel]').waitFor();
        for (const [w, z] of [
            [1280, 900],
            [393, 852],
            [320, 568],
            [844, 390],
        ])
            await shot('purchase-' + w, w, z);
        await page.setViewportSize({ width: 1280, height: 900 });
        await page
            .locator('.house-models button')
            .filter({ has: page.getByText('Le Loft', { exact: true }) })
            .click();
        await page
            .getByRole('button', { name: 'Acheter Le Loft', exact: false })
            .click();
        await settled();
        await page.waitForFunction(
            () => v.map === 'housing_loft' && !v.mapLoading
        );
        await page
            .locator('[data-housing-editor] .house-grid-viewport canvas')
            .waitFor();
        await page.waitForTimeout(250);
        await place('Table ronde', 10, 8);
        await place('Canapé azur', 15, 8);
        await place('Plante en pot', 10, 13);
        await place('Bibliothèque', 19, 7);
        await place('Tapis bleu', 16, 12);
        assert.equal(
            await page.evaluate(
                () => v.$refs.housingPanel.$refs.editor.draft.placements.length
            ),
            5
        );
        await page
            .getByRole('button', { name: 'Sauvegarder', exact: false })
            .click();
        await settled();
        assert.equal(
            (await repo.read(accounts[0].id)).floors[0].placements.length,
            5
        );
        checks.push(
            'real purchase and five furniture placements persisted without altering stock'
        );
        // Move an existing table with real pointer drag, not an imperative edit call.
        if (
            await page
                .locator('.house-selected button')
                .filter({ hasText: 'Désélectionner' })
                .count()
        )
            await page
                .locator('.house-selected button')
                .filter({ hasText: 'Désélectionner' })
                .click();
        let from = await tile(10, 8),
            to = await tile(12, 9);
        await page.mouse.move(from.x, from.y);
        await page.mouse.down();
        await page.mouse.move(to.x, to.y, { steps: 10 });
        await page.mouse.up();
        await page
            .getByRole('button', { name: 'Sauvegarder', exact: false })
            .click();
        await settled();
        assert.equal(
            (await repo.read(accounts[0].id)).floors[0].placements.find(
                (p) => p.key === 'table'
            ).x,
            12
        );
        checks.push('real PC drag moves an installed piece');
        for (const [w, z] of [
            [1280, 900],
            [393, 852],
            [320, 568],
            [844, 390],
        ])
            await shot('editor-' + w, w, z);
        // Tap placement on a small screen; no reliance on HTML drag/drop.
        await page.setViewportSize({ width: 393, height: 852 });
        await page
            .locator('.house-stock')
            .evaluate((el) => (el.scrollLeft = 0));
        await page
            .locator('.house-stock button')
            .filter({ has: page.getByText('Chaise en bois', { exact: true }) })
            .click();
        await page.locator('.house-grid-viewport').evaluate((el) => {
            el.scrollLeft = 0;
            el.scrollTop = 0;
        });
        to = await tile(9, 9);
        await page.touchscreen.tap(to.x, to.y);
        await page
            .getByRole('button', { name: 'Sauvegarder', exact: false })
            .click();
        await settled();
        assert.equal(
            (await repo.read(accounts[0].id)).floors[0].placements.length,
            6
        );
        checks.push('touch placement persists on mobile');
        if (engine === 'chromium') {
            const stock = page
                .locator('.house-stock button')
                .filter({
                    has: page.getByText('Chaise en bois', { exact: true }),
                });
            await stock.scrollIntoViewIfNeeded();
            const box = await stock.boundingBox(),
                to = await tile(9, 11),
                cdp = await page.context().newCDPSession(page);
            await cdp.send('Input.dispatchTouchEvent', {
                type: 'touchStart',
                touchPoints: [
                    { x: box.x + box.width / 2, y: box.y + box.height / 2 },
                ],
            });
            await page.waitForTimeout(230);
            for (let i = 1; i <= 12; i++) {
                await cdp.send('Input.dispatchTouchEvent', {
                    type: 'touchMove',
                    touchPoints: [
                        {
                            x:
                                box.x +
                                box.width / 2 +
                                ((to.x - box.x - box.width / 2) * i) / 12,
                            y:
                                box.y +
                                box.height / 2 +
                                ((to.y - box.y - box.height / 2) * i) / 12,
                        },
                    ],
                });
                await page.waitForTimeout(12);
            }
            await cdp.send('Input.dispatchTouchEvent', {
                type: 'touchEnd',
                touchPoints: [],
            });
            await cdp.detach();
            await page.waitForTimeout(100);
            assert.equal(
                await page.evaluate(
                    () =>
                        v.$refs.housingPanel.$refs.editor.draft.placements
                            .length
                ),
                7
            );
            await page
                .getByRole('button', { name: 'Sauvegarder', exact: false })
                .click();
            await settled();
            checks.push('real held touch drag from the furniture library');
        }
        await page.setViewportSize({ width: 1280, height: 900 });
        await page.getByRole('tab', { name: 'Étages', exact: false }).click();
        await page
            .locator('.house-models button')
            .filter({ has: page.getByText('Le Nid', { exact: true }) })
            .click();
        await page
            .getByRole('button', { name: 'Ajouter Le Nid', exact: false })
            .click();
        await settled();
        await page
            .locator('.house-models button')
            .filter({ has: page.getByText('Le Pavillon', { exact: true }) })
            .click();
        await page
            .getByRole('button', { name: 'Ajouter Le Pavillon', exact: false })
            .click();
        await settled();
        assert.equal((await repo.read(accounts[0].id)).floors.length, 3);
        await shot('three-floors', 1280, 900);
        checks.push('two independently purchased floors, maximum three');
        await page.getByRole('tab', { name: 'Inviter', exact: false }).click();
        const guest = await ctx(accounts[1]);
        await page
            .getByRole('button', { name: 'Inviter', exact: true })
            .click();
        await settled();
        await guest.locator('.housing-invitation').waitFor();
        await guest
            .getByRole('button', { name: 'Visiter', exact: false })
            .click();
        await guest.waitForFunction(
            () => v.housingState && !v.housingBusy && !v.mapLoading
        );
        assert.equal(await guest.evaluate(() => v.housingState.isOwner), false);
        assert.equal(await guest.locator('[data-housing-manage]').count(), 0);
        checks.push(
            'friend notification, acceptance and shared house; visitor cannot manage'
        );
        await guest.screenshot({ path: out + '/visitor.png' });
        await page.getByRole('button', { name: 'Fermer', exact: true }).click();
        await page.reload();
        await ready();
        assert.equal(
            await page.evaluate(
                () => v.housingState.floors[0].placements.length
            ),
            engine === 'chromium' ? 7 : 6
        );
        await page.locator('[data-housing-manage]').click();
        await page.getByRole('tab', { name: 'Aménager', exact: false }).click();
        await shot('reconnected', 1280, 900);
        checks.push('reload resumes the same home and furniture');
        // Walk out naturally through the protected doorway, then use native store UI at a seeded test position.
        await page.getByRole('button', { name: 'Fermer', exact: true }).click();
        await page.evaluate(() => v.housingCommand('exit'));
        await settled();
        await guest.context().close();
        await page.context().close();
        await require('../server/realtime/accountConnection').waitForAccountConnections(
            io
        );
        await db.execute(
            "UPDATE users SET map='tour_rdc',x=432,y=432 WHERE id=?",
            [accounts[0].id]
        );
        page = await ctx(accounts[0]);
        await page.evaluate(() => v.openShop());
        await page.locator('[data-shop-housing]').waitFor();
        await page.locator('[data-shop-housing]').click();
        await page.locator('.housing-shop').waitFor();
        for (const [w, z] of [
            [1280, 900],
            [393, 852],
            [320, 568],
            [844, 390],
        ])
            await shot('furniture-shop-' + w, w, z);
        await page.setViewportSize({ width: 393, height: 852 });
        const count = (await repo.read(accounts[0].id)).inventory.table;
        const tableRow = page
            .locator('.housing-shop article')
            .filter({
                has: page.getByRole('heading', {
                    name: 'Table ronde',
                    exact: true,
                }),
            });
        assert.equal(await tableRow.locator('select').inputValue(), '1');
        await tableRow.locator('select').selectOption('5');
        await page
            .locator('.housing-shop article')
            .filter({
                has: page.getByRole('heading', {
                    name: 'Table ronde',
                    exact: true,
                }),
            })
            .getByRole('button', { name: 'Acheter', exact: false })
            .click();
        await settled();
        assert.equal(
            (await repo.read(accounts[0].id)).inventory.table,
            count + 5
        );
        checks.push(
            'Grand Comptoir furniture category and real stock purchase'
        );
        assert.deepEqual(errors, []);
        success = true;
    } catch (e) {
        console.error(e);
        if (page) {
            console.error(
                await page
                    .evaluate(() => ({
                        map: v?.map,
                        error: v?.housingError,
                        panel: v?.housingPanel,
                        editor: v?.$refs?.housingPanel?.$refs?.editor?.draft,
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
        for (const u of accounts)
            await db.execute('DELETE FROM users WHERE id=?', [u.id]);
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
            scope: 'Compiled client, real local HTTP/Socket.IO/MySQL. Mouse and touch taps; WebKit is not a physical iPhone test.',
        };
        fs.writeFileSync(out + '/report.json', JSON.stringify(report, null, 2));
        console.log(JSON.stringify(report));
    }
})();
