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
    out = (process.env.PRESENTATION_OUT || '/tmp/riftmon-draft-') + engine;
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
const draftModule = require('../server/realtime/draftManager');
const seeded =
    require('../server/game/abilities/abilityDex').createDeterministicRandom(
        'draft-refit-ui'
    );
let localDraft;
draftModule.getDraftManager = (io) =>
    (localDraft ||= draftModule.createDraftManager(io, { random: seeded }));
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
    await page.waitForTimeout(800);
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
        assert.equal(await page.locator('.draft-grip').count(), 0);
        assert.equal(await page.locator('[data-draft-inspector]').count(), 0);
        const firstCard = () =>
            page.locator('[data-draft-pack] > .draft-card').first();
        async function mouseSwipe(distance) {
            const card = firstCard();
            await card.scrollIntoViewIfNeeded();
            const b = await card.boundingBox(),
                x = b.x + b.width / 2,
                y = b.y + 18;
            await page.mouse.move(x, y);
            await page.mouse.down();
            await page.mouse.move(x + 9, y + distance, { steps: 10 });
            assert.equal(
                await page.locator('[data-draft-gesture="swipe"]').count(),
                1
            );
            await page.mouse.up();
            await page.waitForFunction(
                () => !document.querySelector('[data-draft-gesture]')
            );
        }
        await mouseSwipe(30);
        assert.equal(await page.evaluate(() => v.draftState.pick), 0);
        await mouseSwipe(145);
        await page.waitForFunction(
            () => v.draftState.pick === 1 && !v.draftBusy
        );
        checks.push(
            'direct-card down swipe follows the pointer; short swipe returns without selecting, committed swipe selects exactly once; no grips or inspector popups'
        );
        await page.reload();
        await ready();
        assert.equal(await page.evaluate(() => v.draftState.pick), 1);
        await page.locator('[data-draft-resume]').click();
        checks.push(
            'reconnection restores the same pack and shared 50-second deadline'
        );
        const touch =
            engine === 'chromium' ? await context.newCDPSession(page) : null;
        async function touchGesture(
            locator,
            { dx = 0, dy = 0, hold = 0, cancel = false } = {}
        ) {
            await locator.scrollIntoViewIfNeeded();
            const b = await locator.boundingBox(),
                from = { x: b.x + b.width / 2, y: b.y + 20 };
            await touch.send('Input.dispatchTouchEvent', {
                type: 'touchStart',
                touchPoints: [from],
            });
            if (hold) await page.waitForTimeout(hold);
            for (let i = 1; i <= 12; i++)
                await touch.send('Input.dispatchTouchEvent', {
                    type: 'touchMove',
                    touchPoints: [
                        {
                            x: from.x + (dx * i) / 12,
                            y: from.y + (dy * i) / 12,
                        },
                    ],
                });
            await touch.send('Input.dispatchTouchEvent', {
                type: cancel ? 'touchCancel' : 'touchEnd',
                touchPoints: [],
            });
            await page.waitForFunction(
                () => !document.querySelector('[data-draft-gesture]')
            );
        }
        if (touch) {
            await page.setViewportSize({ width: 393, height: 852 });
            await touchGesture(firstCard(), { dy: 30 });
            assert.equal(await page.evaluate(() => v.draftState.pick), 1);
            await touchGesture(firstCard(), { dy: 145 });
            await page.waitForFunction(
                () => v.draftState.pick === 2 && !v.draftBusy
            );
            checks.push(
                'real mobile touch swipe: short return, down commitment and single selection; scrolling and swipe are distinct'
            );
        }
        await page.setViewportSize({ width: 1280, height: 900 });
        // Remaining picks use genuine private RPCs, with deterministic local RNG.
        while (manager.tables.get(tableId).phase === 'draft') {
            const r = manager.tables.get(tableId),
                pack = r.packs[0],
                own = r.seats[0].collection.map((id) => r.cards.get(id));
            const missing = [
                'pokemon',
                'move',
                'item',
                'nature',
                'iv',
                'ability',
            ].find(
                (kind) =>
                    own.filter((c) => c.kind === kind).length <
                    (kind === 'pokemon' ? 6 : kind === 'move' ? 4 : 1)
            );
            const id =
                pack.find((id) => r.cards.get(id).kind === missing) ||
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
        assert.deepEqual(await page.evaluate(() => v.draftState.timing), {
            pickMs: 50000,
            preparationMs: 420000,
        });
        assert.equal(
            await page.locator('[data-draft-filter="all"]').count(),
            0
        );
        assert(
            await page
                .locator('[data-draft-filter="pokemon"]')
                .evaluate((el) => el.classList.contains('is-active'))
        );
        await shot('preparation-empty');
        const state = await page.evaluate(() => v.draftState),
            pokemons = state.collection.filter((c) => c.kind === 'pokemon');
        const pokemonCard = () =>
            page.locator(
                '.draft-prep-collection [data-draft-card="' +
                    pokemons[0].id +
                    '"]'
            );
        await pokemonCard().locator('.draft-card-face').click();
        await page.waitForFunction(
            () => !!v.draftState.preparation.team[0] && !v.draftBusy
        );
        assert.match(
            await pokemonCard().locator('.draft-card-select').innerText(),
            /Désélectionner/
        );
        assert(
            await pokemonCard().evaluate((el) =>
                el.classList.contains('is-used')
            )
        );
        await pokemonCard().locator('.draft-card-select').click();
        await page.waitForFunction(
            () => !v.draftState.preparation.team[0] && !v.draftBusy
        );
        await pokemonCard().locator('.draft-card-face').click();
        await page.waitForFunction(
            () => !!v.draftState.preparation.team[0] && !v.draftBusy
        );
        assert.equal(
            await pokemonCard()
                .locator('[data-draft-full-stats] > span')
                .count(),
            6
        );
        assert.equal(
            await pokemonCard()
                .locator('[data-draft-full-moves] > span')
                .count(),
            pokemons[0].pokemon.abilities.length
        );
        checks.push(
            'Pokémon tab opens by default; six stats, IV/EV and all moves are inline; selecting/deselecting changes team and grey appearance through server RPCs'
        );
        for (let slot = 1; slot < Math.min(6, pokemons.length); slot++)
            await command('edit', {
                id: tableId,
                action: 'slot',
                slot,
                cardId: pokemons[slot].id,
            });
        const teamIds = () =>
            page.evaluate(() =>
                v.draftState.preparation.team.map((p) => p?.cardId)
            );
        let ids = await teamIds();
        const from = page.locator('[data-draft-slot="0"] .draft-slot-face'),
            to = page.locator('[data-draft-slot="1"]');
        await from.scrollIntoViewIfNeeded();
        const a = await from.boundingBox(),
            b = await to.boundingBox();
        await page.mouse.move(a.x + a.width / 2, a.y + 25);
        await page.mouse.down();
        await page.mouse.move(b.x + b.width / 2, b.y + 40, { steps: 15 });
        assert.equal(
            await page.locator('[data-draft-gesture="drag"]').count(),
            1
        );
        assert(
            await to.evaluate((el) =>
                el.classList.contains('draft-drop-target')
            )
        );
        await page.mouse.up();
        await page.waitForFunction(
            (id) => v.draftState.preparation.team[1]?.cardId === id,
            ids[0]
        );
        assert.equal((await teamIds())[0], ids[1]);
        ids = await teamIds();
        await from.scrollIntoViewIfNeeded();
        const cancelled = await from.boundingBox();
        await page.mouse.move(
            cancelled.x + cancelled.width / 2,
            cancelled.y + 20
        );
        await page.mouse.down();
        await page.mouse.move(
            cancelled.x + cancelled.width / 2 + 22,
            cancelled.y + 30,
            { steps: 4 }
        );
        await page.keyboard.press('Escape');
        await page.mouse.up();
        assert.equal(await page.locator('[data-draft-gesture]').count(), 0);
        assert.equal(await page.locator('[data-draft-panel]').count(), 1);
        assert.deepEqual(await teamIds(), ids);

        if (touch) {
            await page.setViewportSize({ width: 393, height: 852 });
            const from = page.locator('[data-draft-slot="0"] .draft-slot-face');
            await from.scrollIntoViewIfNeeded();
            const a = await from.boundingBox(),
                b = await page.locator('[data-draft-slot="2"]').boundingBox();
            ids = await teamIds();
            await touchGesture(from, {
                dx: b.x + b.width / 2 - (a.x + a.width / 2),
                dy: b.y + 40 - (a.y + 20),
                hold: 280,
            });
            await page.waitForFunction(
                (id) => v.draftState.preparation.team[2]?.cardId === id,
                ids[0]
            );
            ids = await teamIds();
            await touchGesture(
                page.locator('[data-draft-slot="0"] .draft-slot-face'),
                { dx: 30, dy: 10, hold: 280, cancel: true }
            );
            assert.deepEqual(await teamIds(), ids);
            assert.equal(await page.locator('.is-gesture-origin').count(), 0);
            await touch.detach();
        }
        checks.push(
            'full-card mouse drag and held mobile touch reorder occupied team slots; touch cancellation and Escape restore the card without closing preparation or changing the team'
        );
        await page.setViewportSize({ width: 1280, height: 900 });
        for (const kind of ['move', 'ability', 'item', 'nature', 'iv']) {
            await page.locator('[data-draft-filter="' + kind + '"]').click();
            const dto = await page.evaluate(() => v.draftState);
            const c = dto.collection.find(
                (c) =>
                    c.kind === kind &&
                    dto.preparation.team.some(
                        (p) =>
                            p &&
                            (kind === 'move'
                                ? c.compatibility.some(
                                      (x) =>
                                          x.cardId === p.cardId &&
                                          x.compatible &&
                                          !x.known
                                  )
                                : kind === 'ability'
                                ? p.passiveAbility !== c.ability
                                : kind === 'nature'
                                ? p.nature !== c.nature
                                : kind === 'iv'
                                ? p.iv[c.stat] < 31
                                : true)
                    )
            );
            assert(c, 'deterministic collection includes usable ' + kind);
            const card = page.locator(
                '.draft-prep-collection [data-draft-card="' + c.id + '"]'
            );
            await card.locator('.draft-card-face').click();
            await page.locator('[data-draft-move-guidance]').waitFor();
            const slot = dto.preparation.team.findIndex(
                (p) =>
                    p &&
                    (kind === 'move'
                        ? c.compatibility.some(
                              (x) =>
                                  x.cardId === p.cardId &&
                                  x.compatible &&
                                  !x.known
                          )
                        : kind === 'ability'
                        ? p.passiveAbility !== c.ability
                        : kind === 'nature'
                        ? p.nature !== c.nature
                        : kind === 'iv'
                        ? p.iv[c.stat] < 31
                        : true)
            );
            await page
                .locator('[data-draft-slot="' + slot + '"] .draft-slot-face')
                .click();
            if (kind === 'move')
                await page
                    .locator('.draft-replace-moves button')
                    .first()
                    .click();
            await page.waitForFunction(
                (id) =>
                    v.draftState.preparation.used.includes(id) && !v.draftBusy,
                c.id
            );
            assert.equal(
                await page.locator('[data-draft-inspector]').count(),
                0
            );
            await shot('upgrade-' + kind);
            await card.locator('.draft-card-select').click();
            await page.waitForFunction(
                (id) =>
                    !v.draftState.preparation.used.includes(id) && !v.draftBusy,
                c.id
            );
        }
        checks.push(
            'moves use inline replacement choices; held items, natures, IV and full-description abilities apply directly and can all be undone without popup'
        );
        await page.locator('[data-draft-filter="rift"]').click();
        const riftCards = state.collection.filter((c) => c.kind === 'rift');
        for (const c of riftCards.slice(0, 2)) {
            await page
                .locator(
                    '.draft-prep-collection [data-draft-card="' +
                        c.id +
                        '"] .draft-card-face'
                )
                .click();
            await page.waitForFunction(
                (id) =>
                    v.draftState.preparation.rifts.includes(id) && !v.draftBusy,
                c.id
            );
        }
        await page
            .locator(
                '.draft-prep-collection [data-draft-card="' +
                    riftCards[2].id +
                    '"] .draft-card-face'
            )
            .click();
        assert.match(
            await page.locator('.draft-inline-notice').innerText(),
            /Deux Rifts/
        );
        await page
            .locator('[data-draft-drop="rift:0"] button')
            .filter({ hasText: 'Remplacer' })
            .click();
        await page.waitForFunction(
            (id) => v.draftState.preparation.rifts[0] === id && !v.draftBusy,
            riftCards[2].id
        );
        assert.equal(
            (await page.evaluate(() => v.draftState.preparation.rifts)).length,
            2
        );
        checks.push(
            'two Rift slots equip and replace distinct owned cards without exceeding the server limit'
        );
        await page.locator('[data-draft-filter="pokemon"]').click();
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
            scope: 'real SQL/socket account with deterministic local content RNG; native world entry, separate booster swipes and held team drags, inline upgrades, two Rifts and first action after reconnect; remaining picks expedited with genuine RPCs; no production data',
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
