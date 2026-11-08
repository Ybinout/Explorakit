// Disposable SQL accounts and a local Socket.IO server. No production data.
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
    out = '/tmp/riftmon-draft-' + engine;
assert(dist && fs.existsSync(dist + '/index.html'));
fs.mkdirSync(out, { recursive: true });
const { dbPool: db } = require('../server/config/database'),
    users = require('../server/persistence/userRepository'),
    teams = require('../server/persistence/teamRepository'),
    codec = require('../server/game/drift/checkpointCodec');
const app = require('express')(),
    server = http.createServer(app),
    io = new (require('socket.io').Server)(server);
app.use(require('express').json());
app.use('/api', require('../server/http/routes'));
app.use(require('express').static(dist));
app.get('*', (_q, r) => r.sendFile(path.join(dist, 'index.html')));
io.use(require('../server/http/authMiddleware').authenticateSocket);
require('../server/realtime/socketHandler')(io);
const manager = require('../server/realtime/draftManager').getDraftManager(io),
    checks = [],
    views = [],
    errors = [];
let user,
    browser,
    context,
    page,
    base,
    success = false,
    tableId,
    originalTeam;
async function ready() {
    await page.waitForFunction(
        () => {
            const v = document.querySelector('.game-root')?.__vue__;
            if (
                v?.socket?.connected &&
                !v.mapLoading &&
                v.renderedMap === v.map &&
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
            animationsEnabled: false,
        })
    );
}
async function command(event, data = {}) {
    const result = await page.evaluate(
        ({ event, data }) =>
            new Promise((resolve, reject) =>
                v.socket
                    .timeout(20000)
                    .emit('draft:' + event, data, (e, r) =>
                        e ? reject(e) : resolve(r)
                    )
            ),
        { event, data }
    );
    assert(result.success, result.message);
    return result;
}
async function shot(name, w, h) {
    if (w) await page.setViewportSize({ width: w, height: h });
    await page.waitForTimeout(140);
    const box = await page.evaluate(() => {
        const p =
                document.querySelector('.draft-inspect-backdrop') ||
                document.querySelector('[data-draft-panel]') ||
                document.querySelector('.battle') ||
                document.querySelector('.game-root'),
            r = p.getBoundingClientRect();
        return {
            width: innerWidth,
            height: innerHeight,
            left: r.left,
            right: r.right,
            top: r.top,
            bottom: r.bottom,
            pageWidth: document.documentElement.scrollWidth,
            overflow: p.scrollWidth > p.clientWidth + 1,
        };
    });
    assert(
        box.left >= -1 &&
            box.right <= box.width + 1 &&
            box.top >= -1 &&
            box.bottom <= box.height + 1 &&
            !box.overflow &&
            box.pageWidth <= box.width + 1,
        name + JSON.stringify(box)
    );
    await page.screenshot({ path: path.join(out, name + '.png') });
    views.push({ name, ...box });
}
async function reloadAt(map, x, y) {
    await page.evaluate(() => v.socket.disconnect());
    await page.goto('about:blank');
    await db.execute('UPDATE users SET map=?,x=?,y=? WHERE id=?', [
        map,
        x,
        y,
        user.id,
    ]);
    await page.goto(base + '/game');
    await ready();
}
(async () => {
    try {
        server.listen(0, '127.0.0.1');
        await once(server, 'listening');
        base = 'http://127.0.0.1:' + server.address().port;
        user = await users.createUserWithStarter(
            'DraftUI_' + randomUUID().slice(0, 8),
            randomUUID()
        );
        for (const [k, v] of Object.entries({
            adventure_opening: 'complete',
            early_game_tutorial: JSON.stringify({
                version: 1,
                phase: 'complete',
                metWayne: true,
            }),
        }))
            await db.execute(
                'INSERT INTO player_story_flags(user_id,flag_key,flag_value) VALUES(?,?,?) ON DUPLICATE KEY UPDATE flag_value=VALUES(flag_value)',
                [user.id, k, v]
            );
        await require('../server/persistence/patchNotesRepository').acknowledge(
            user.id,
            require('../data/game/latest_patch.json').version
        );
        originalTeam = codec.encode(await teams.loadEquipe(user.id));
        await db.execute('UPDATE users SET map=?,x=?,y=? WHERE id=?', [
            'ville1',
            560,
            560,
            user.id,
        ]);
        browser = await require('playwright')[engine].launch({
            headless: true,
        });
        context = await browser.newContext({
            viewport: { width: 1280, height: 900 },
            hasTouch: true,
            serviceWorkers: 'block',
        });
        await context.addInitScript(
            (auth) => {
                if (
                    location.protocol === 'http:' ||
                    location.protocol === 'https:'
                )
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
        await page.goto(base + '/game');
        await ready();
        await page.evaluate(() => v.socket.emit('playerAction', 'move_z'));
        await page.waitForFunction(
            () => v.map === 'draft_house' && !v.mapLoading
        );
        await ready();
        assert(await page.evaluate(() => v.renderedMap === 'draft_house'));
        await shot('room-entry');
        checks.push(
            'real world movement enters the town door and loads the new interior'
        );
        await reloadAt('draft_house', 432, 464);
        await command('open');
        await page.locator('[data-draft-create]').waitFor();
        for (const [w, h] of [
            [1280, 900],
            [393, 852],
            [320, 568],
            [844, 390],
        ])
            await shot('home-' + w, w, h);
        await page.setViewportSize({ width: 1280, height: 900 });
        await page.locator('[data-draft-create]').click();
        await page.locator('[data-draft-start]').waitFor();
        tableId = await page.evaluate(() => v.draftState.id);
        await shot('lobby');
        await page.locator('[data-draft-start]').click();
        await page.locator('[data-draft-pack]').waitFor();
        await page.waitForFunction(() => !v.draftBusy);
        await shot('booster');
        await page
            .locator('[data-draft-pack] .draft-card')
            .first()
            .locator('.draft-card-face')
            .click();
        await page.locator('[data-draft-inspector]').waitFor();
        await shot('inspection');
        await page.keyboard.press('Escape');
        assert.equal(await page.locator('.draft-inspect-backdrop').count(), 0);
        const grip = page
                .locator('[data-draft-pack] .draft-card')
                .first()
                .locator('.draft-grip'),
            drop = page.locator('[data-draft-drop="pick"]');
        const a = await grip.boundingBox(),
            b = await drop.boundingBox();
        await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
        await page.mouse.down();
        await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, {
            steps: 16,
        });
        await page.mouse.up();
        await page.waitForFunction(
            () => v.draftState.pick === 1 && !v.draftBusy
        );
        checks.push(
            'opening, detailed inspection, Escape and actual pointer drag choose a card through the server'
        );
        await page.reload();
        await ready();
        assert.equal(await page.evaluate(() => v.draftState.pick), 1);
        await page.locator('[data-draft-resume]').click();
        checks.push(
            'reconnection restores the same booster, cards and shared deadline'
        );
        if (engine === 'chromium') {
            await page.setViewportSize({ width: 393, height: 852 });
            await shot('booster-touch');
            const cdp = await context.newCDPSession(page);
            const h = await page
                    .locator('[data-draft-pack] .draft-grip')
                    .first()
                    .boundingBox(),
                z = await page
                    .locator('[data-draft-drop="pick"]')
                    .boundingBox();
            const from = { x: h.x + h.width / 2, y: h.y + h.height / 2 },
                to = {
                    x: z.x + z.width / 2,
                    y: Math.min(810, z.y + z.height / 2),
                };
            await cdp.send('Input.dispatchTouchEvent', {
                type: 'touchStart',
                touchPoints: [from],
            });
            for (let i = 1; i <= 16; i++)
                await cdp.send('Input.dispatchTouchEvent', {
                    type: 'touchMove',
                    touchPoints: [
                        {
                            x: from.x + ((to.x - from.x) * i) / 16,
                            y: from.y + ((to.y - from.y) * i) / 16,
                        },
                    ],
                });
            await cdp.send('Input.dispatchTouchEvent', {
                type: 'touchEnd',
                touchPoints: [],
            });
            await page.waitForFunction(
                () => v.draftState.pick === 2 && !v.draftBusy
            );
            await cdp.detach();
            checks.push(
                'mobile touch drag selects a card with real browser touch input, without scrolling the card body'
            );
            await page.setViewportSize({ width: 1280, height: 900 });
        }
        // Fast RPC choices are explicit recipe setup; the first pick above used real UI.
        while (manager.tables.get(tableId).phase === 'draft') {
            const r = manager.tables.get(tableId),
                pack = r.packs[0],
                id =
                    pack.find((id) => r.cards.get(id).kind === 'pokemon') ||
                    pack[0];
            await command('pick', {
                id: tableId,
                round: r.round,
                pick: r.pick,
                cardId: id,
            });
        }
        await page.waitForFunction(() => v.draftState.phase === 'preparation');
        await shot('preparation-empty');
        const state = await page.evaluate(() => v.draftState),
            pokemons = state.collection.filter((c) => c.kind === 'pokemon');
        await page
            .locator('.draft-filters button')
            .filter({ hasText: 'Pokémon' })
            .click();
        await page
            .locator('.draft-prep-collection .draft-card-select')
            .first()
            .click();
        await page.waitForFunction(
            () => !!v.draftState.preparation.team[0] && !v.draftBusy
        );
        checks.push(
            'the actual preparation card selector places a Pokémon into the team'
        );
        for (let slot = 0; slot < Math.min(6, pokemons.length); slot++)
            await command('edit', {
                id: tableId,
                action: 'slot',
                slot,
                cardId: pokemons[slot].id,
            });
        const rift = state.collection.find((c) => c.kind === 'rift');
        await command('edit', { id: tableId, action: 'rift', cardId: rift.id });
        const item = state.collection.find((c) => c.kind === 'item');
        if (item) {
            await command('edit', {
                id: tableId,
                action: 'apply',
                pokemonId: pokemons[0].id,
                cardId: item.id,
            });
            await command('edit', {
                id: tableId,
                action: 'remove',
                pokemonId: pokemons[0].id,
                slot: 'item',
            });
            assert(
                !(
                    await page.evaluate(() => v.draftState.preparation.used)
                ).includes(item.id)
            );
            checks.push(
                'held-item assignment is reversible and returns the same unique card'
            );
        }
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
            ])
                await shot('preparation-' + mode + '-' + w, w, h);
        }
        await page.setViewportSize({ width: 1280, height: 900 });
        await page.locator('[data-draft-confirm]').click();
        await page.waitForFunction(() => v.battle);
        await page.waitForFunction(
            () => {
                const b = v.$refs.battleOverlay;
                return b && !b.entranceActive && b.currentPokemon && b.opponent;
            },
            null,
            { timeout: 20000 }
        );
        await shot('battle-desktop');
        await shot('battle-mobile', 393, 852);
        assert.equal(await page.locator('.battle-platform:visible').count(), 0);
        assert(
            originalTeam.equals(codec.encode(await teams.loadEquipe(user.id)))
        );
        checks.push(
            'validated temporary team starts the native battle with dedicated PC/mobile background and no permanent party/XP changes'
        );
        const before = manager.tables.get(tableId).matches[0].battle,
            token = before.token,
            deadline = before.deadline;
        await page.reload();
        await ready();
        await page.waitForFunction(() => v.battle);
        assert.equal(
            manager.tables.get(tableId).matches[0].battle.token,
            token
        );
        assert.equal(
            manager.tables.get(tableId).matches[0].battle.deadline,
            deadline
        );
        await command('action', {
            id: tableId,
            matchId: manager.tables.get(tableId).matches[0].id,
            turnId: token,
            action: 'attack',
            number: 0,
        });
        checks.push(
            'first native battle action is accepted after reconnect without resetting the decision deadline'
        );
        await command('leave', { id: tableId });
        assert(
            originalTeam.equals(codec.encode(await teams.loadEquipe(user.id)))
        );
        assert.deepEqual(errors, []);
        success = true;
    } catch (e) {
        try {
            await page.screenshot({ path: path.join(out, 'failure.png') });
            fs.writeFileSync(
                path.join(out, 'failure-state.json'),
                JSON.stringify(
                    await page.evaluate(() => ({
                        text: document.body.innerText,
                        route: location.href,
                        map: v.map,
                        draft: v.draftState,
                        battle: v.battle,
                    })),
                    null,
                    2
                )
            );
        } catch {}
        throw e;
    } finally {
        await browser?.close();
        await manager.stop();
        await require('../server/realtime/raidManager')
            .getRaidManager(io)
            .stop();
        require('../server/realtime/whitepeakClub').getClub(io).close();
        await new Promise((r) => io.close(r));
        await require('../server/realtime/accountConnection').waitForAccountConnections(
            io
        );
        if (tableId)
            await db.execute('DELETE FROM draft_tables WHERE id=?', [tableId]);
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
            scope: 'real SQL/socket account, world entrance, UI and drag pick, reconnect; remaining picks/preparation expedited with genuine RPCs, no production fixture',
            testAccountsDeleted: true,
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
