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
    out =
        (process.env.PRESENTATION_OUT || '/tmp/riftmon-housing-polish-') +
        engine;
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
    // WebKit commits viewport media queries after resize asynchronously.
    // Wait for the requested viewport and the actual bounds, never ignore overflow.
    await page.waitForFunction(
        ({ w, h, sel }) => {
            const el = document.querySelector(sel);
            if (!el || window.innerWidth !== w) return false;
            const r = el.getBoundingClientRect();
            return (
                r.left >= -1 &&
                r.top >= -1 &&
                r.right <= w + 1 &&
                r.bottom <= h + 1 &&
                document.documentElement.scrollWidth <= w + 1
            );
        },
        { w, h, sel },
        { timeout: 5000 }
    );
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
    await page.getByRole('button',{name:/Meubles.*\/ 10/}).click();
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
    const manager = require('../server/realtime/housing').getHousingManager(io),
        entries = require('../server/game/housing/entries'),
        teams = require('../server/persistence/teamRepository');
    let guest;
    async function move(destination) {
        const c = manager.contexts.get(accounts[0].id);
        await c.travel(destination);
        await page.waitForFunction(() => !v.mapLoading);
        await page.waitForTimeout(150);
    }
    async function closeHouse() {
        await page.getByRole('button', { name: 'Fermer', exact: true }).click();
    }
    async function chooseStock(name) {
        await page.getByRole('button',{name:/Meubles.*\/ 10/}).click();
        await page
            .locator('.house-stock button')
            .filter({ has: page.getByText(name, { exact: true }) })
            .click();
    }
    async function deselect() {
        const b = page
            .locator('.house-selected button')
            .filter({ hasText: 'Désélectionner' });
        if (await b.count()) await b.click();
    }
    async function save() {
        await page
            .getByRole('button', { name: 'Sauvegarder', exact: false })
            .click();
        await settled();
    }
    try {
        server.listen(0, '127.0.0.1');
        await once(server, 'listening');
        for (let i = 0; i < 2; i++) {
            const u = await users.createUserWithStarter(
                'HousingPolishUI_' + randomUUID().slice(0, 8),
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
                fly_module_received: 'true',
            }))
                await db.execute(
                    'INSERT INTO player_story_flags(user_id,flag_key,flag_value) VALUES(?,?,?) ON DUPLICATE KEY UPDATE flag_value=VALUES(flag_value)',
                    [u.id, k, value]
                );
            await db.execute(
                "INSERT INTO user_items(user_id,item_key,quantity) VALUES(?,'fly_module',1) ON DUPLICATE KEY UPDATE quantity=1",
                [u.id]
            );
            await require('../server/persistence/patchNotesRepository').acknowledge(
                u.id,
                require('../data/game/latest_patch.json').version
            );
        }
        await social.friendAction(accounts[0].id, accounts[1].id, 'request');
        await social.friendAction(accounts[1].id, accounts[0].id, 'accept');
        const request = (h, p) => ({
            ...p,
            revision: h.revision,
            requestId: randomUUID(),
        });
        let home = await repo.read(accounts[0].id);
        home = (
            await repo.purchase(
                accounts[0].id,
                request(home, {
                    model: 'loft',
                    entryKey: entries.entries[0].key,
                })
            )
        ).home;
        for (const key of [
            'bed',
            'blue_bed',
            'wardrobe',
            'chair',
            'pokemon_pc',
            'healing_station',
            'sofa',
            'green_sofa',
            'desk',
        ])
            home = (
                await repo.furniture(
                    accounts[0].id,
                    request(home, { key, quantity: 1 })
                )
            ).home;
        const stock = structuredClone(home.inventory);
        await repo.enter(
            accounts[0].id,
            accounts[0].id,
            0,
            entries.outside(entries.get(home.entryKey))
        );
        browser = await require('playwright')[engine].launch({
            headless: true,
        });
        page = await ctx(accounts[0]);
        await page.locator('[data-housing-manage]').click();
        await page.locator('[data-housing-editor]').waitFor();
        // Fit the entire native room on initial open and on each resize; no clipped edge.
        for(const [width,height]of [[1280,900],[393,852],[320,568],[844,390]]){
          await page.setViewportSize({width,height});await page.waitForTimeout(350);
          const fit=await page.locator('[data-housing-editor]').evaluate(el=>{const e=el.__vue__,v=e.$refs.viewport.getBoundingClientRect(),c=e.$refs.scene.getBoundingClientRect();return {v:{l:v.left,t:v.top,r:v.right,b:v.bottom},c:{l:c.left,t:c.top,r:c.right,b:c.bottom,w:c.width,h:c.height},ratio:e.bounds.w/e.bounds.h,zoom:e.zoom};});
          assert.equal(fit.zoom,1);assert(fit.c.l>=fit.v.l&&fit.c.t>=fit.v.t&&fit.c.r<=fit.v.r&&fit.c.b<=fit.v.b,JSON.stringify(fit));assert(Math.abs(fit.c.w/fit.c.h-fit.ratio)<.015);
          assert.equal(await page.getByRole('button',{name:'Déplacer la vue',exact:false}).count(),0);
        }
        for(const model of config.models){
          await page.setViewportSize({width:393,height:852});
          await page.locator('[data-housing-editor]').evaluate(async(el,key)=>{const e=el.__vue__;e.draft.model=key;await e.$nextTick();await e.loadBackground();e.draw();},model.key);
          await page.waitForTimeout(100);
          const fit=await page.locator('[data-housing-editor]').evaluate(el=>{const e=el.__vue__,v=e.$refs.viewport.getBoundingClientRect(),r=e.$refs.scene.getBoundingClientRect();return {ok:r.left>=v.left&&r.top>=v.top&&r.right<=v.right&&r.bottom<=v.bottom,ratio:r.width/r.height,expected:e.bounds.w/e.bounds.h};});assert(fit.ok,model.key);assert(Math.abs(fit.ratio-fit.expected)<.015,model.key);
        }
        await page.locator('[data-housing-editor]').evaluate(async el=>{const e=el.__vue__;e.reset();await e.loadBackground();await e.$nextTick();e.draw();});
        checks.push('Fit is verified for all six native room models using the real backgrounds and aspect ratios, without changing the saved home');
        await page.setViewportSize({width:393,height:852});await page.waitForTimeout(300);
        const slider=await page.getByRole('slider',{name:'Zoom de la pièce'}).boundingBox();await page.touchscreen.tap(slider.x+slider.width/2,slider.y+slider.height*.15);await page.waitForTimeout(100);assert(slider.x>=0&&slider.x+slider.width<=393);assert(await page.getByRole('slider').inputValue()>2);
        await page.touchscreen.tap(slider.x+slider.width/2,slider.y+slider.height*.85);await page.waitForTimeout(100);assert(await page.getByRole('slider').inputValue()<1.2);
        await page.getByRole('slider').evaluate(el=>{el.value=1;el.dispatchEvent(new Event('input',{bubbles:true}));});
        await page.setViewportSize({width:1280,height:900});await page.waitForTimeout(300);
        checks.push('Whole room fits and keeps its aspect ratio at four screen sizes; vertical touch slider increases upward and decreases downward; legacy pan/zoom buttons absent');
        await chooseStock('Lit grenat');
        let target = await tile(10, 5);
        await page.mouse.click(target.x, target.y);
        for (const rotation of [90, 180, 270]) {
            await page.locator('[data-housing-rotate]').click();
            assert.equal(
                await page.evaluate(
                    () =>
                        v.$refs.housingPanel.$refs.editor.draft.placements.find(
                            (p) => p.key === 'bed'
                        ).rotation
                ),
                rotation
            );
            await shot('bed-' + rotation, 1280, 900);
        }
        await deselect();
        let point=await tile(10,5);const initial=await page.evaluate(()=>JSON.stringify(v.$refs.housingPanel.$refs.editor.draft));
        await page.mouse.click(point.x,point.y);assert.equal(await page.evaluate(()=>JSON.stringify(v.$refs.housingPanel.$refs.editor.draft)),initial);
        let destination=await tile(11,6);await page.mouse.move(point.x,point.y);await page.mouse.down();await page.mouse.move(destination.x,destination.y,{steps:8});await page.mouse.up();
        assert.deepEqual(await page.evaluate(()=>{const p=v.$refs.housingPanel.$refs.editor.draft.placements[0];return[p.x,p.y];}),[11,6]);
        const moved=await page.evaluate(()=>JSON.stringify(v.$refs.housingPanel.$refs.editor.draft));point=await tile(11,6);destination=await tile(0,0);
        await page.mouse.move(point.x,point.y);await page.mouse.down();await page.mouse.move(destination.x,destination.y,{steps:8});await page.mouse.up();assert.equal(await page.evaluate(()=>JSON.stringify(v.$refs.housingPanel.$refs.editor.draft)),moved);
        if(engine==='chromium'){
          await page.setViewportSize({width:393,height:852});await page.waitForTimeout(350);
          const cdp=await page.context().newCDPSession(page);
          async function touchDrag(from,to,cancel=false){
            await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:from.x,y:from.y}]});
            for(let n=1;n<=8;n++)await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:from.x+(to.x-from.x)*n/8,y:from.y+(to.y-from.y)*n/8}]});
            await cdp.send('Input.dispatchTouchEvent',{type:cancel?'touchCancel':'touchEnd',touchPoints:[]});await page.waitForTimeout(100);
          }
          await touchDrag(await tile(11,6),await tile(12,7));
          assert.deepEqual(await page.evaluate(()=>{const p=v.$refs.housingPanel.$refs.editor.draft.placements[0];return[p.x,p.y];}),[12,7]);
          const beforeCancel=await page.evaluate(()=>JSON.stringify(v.$refs.housingPanel.$refs.editor.draft));
          await touchDrag(await tile(12,7),await tile(13,8),true);assert.equal(await page.evaluate(()=>JSON.stringify(v.$refs.housingPanel.$refs.editor.draft)),beforeCancel);
          checks.push('Actual mobile touch drag moves the selected furniture; OS touch cancellation discards the preview without committing');
          await cdp.detach();await page.setViewportSize({width:1280,height:900});await page.waitForTimeout(300);
        }
        await deselect();destination=await tile(17,14);await page.mouse.click(destination.x,destination.y);assert.equal(await page.locator('[data-housing-rotate]').count(),0);
        checks.push('Tap selects without moving; native pointer drag moves on-grid; invalid drop preserves the previous placement and empty tap clears selection');
        await save();
        assert.equal(
            (await repo.read(accounts[0].id)).floors[0].placements[0].rotation,
            270
        );
        await deselect();
        await place('Lit océan', 15, 5);
        await deselect();
        await place('Armoire en chêne', 19, 5);
        await deselect();
        await place('PC Pokémon', 12, 10);
        await deselect();
        await chooseStock('Machine de soin Pokémon');
        await page.locator('[data-housing-rotate]').click();
        target = await tile(17, 10);
        await page.mouse.click(target.x, target.y);
        await save();
        for (const [w, h] of [
            [1280, 900],
            [393, 852],
            [320, 568],
            [844, 390],
        ])
            await shot('editor-' + w, w, h);
        checks.push(
            'native editor rotates a placed bed through all four orientations; new PC and healing station are saved with their orientation and stock unchanged'
        );
        await page.setViewportSize({ width: 393, height: 852 });
        await deselect();
        await chooseStock('Chaise en bois');
        await page.locator('[data-housing-rotate]').tap();
        target = await tile(10, 11);
        await page.touchscreen.tap(target.x, target.y);
        await save();
        assert.equal(
            (await repo.read(accounts[0].id)).floors[0].placements.find(
                (p) => p.key === 'chair'
            ).rotation,
            90
        );
        checks.push(
            'mobile tap rotates and places furniture without HTML drag/drop'
        );
        await page.setViewportSize({width:1280,height:900});await page.waitForTimeout(400);
        // Profile regression fixtures use the same rotate/place/save UI as players.
        for (const [name,x,y] of [['Canapé azur',8,12],['Canapé sauge',20,12],['Bureau',13,13]]) {
            await deselect();await chooseStock(name);
            await page.locator('[data-housing-rotate]').tap();
            const position=await tile(x,y);await page.mouse.click(position.x,position.y);await save();
        }
        checks.push('both long sofa profiles and desk occupy their native rotated footprints in the actual room');
        await closeHouse();
        await page.reload();
        await ready();
        assert.equal(
            await page.evaluate(
                () =>
                    v.housingState.floors[0].placements.find(
                        (p) => p.key === 'bed'
                    ).rotation
            ),
            270
        );
        await shot('room-mobile', 393, 852, '.game-stage');
        await shot('room-desktop', 1280, 900, '.game-stage');
        checks.push(
            'reload restores rotations, clean south-facing doorway and complete furniture layout'
        );
        await move({ map: 'housing_loft', x: 11 * 32 + 16, y: 10 * 32 + 16 });
        await page.keyboard.press('Space');
        await page.waitForFunction(() => v.pc.visible);
        await page.screenshot({ path: out + '/native-pc.png' });
        await page.evaluate(() => (v.pc.visible = false));
        const team = await teams.loadEquipe(accounts[0].id);
        for (const p of team.pokemons) {
            p.currentHp = 1;
            p.status = 'poison';
            p.movePp = p.movePp.map(() => 0);
        }
        await teams.editEquipe(accounts[0].id, team);
        manager.contexts.get(accounts[0].id).getPlayer().equipe = team;
        manager.contexts.get(accounts[0].id).socket.emit('teamStateChanged', {
            reason: 'fixture',
            equipe: team,
        });
        await page.waitForFunction(() =>
            v.teamPokemons.every((p) => p.currentHp === 1)
        );
        await move({ map: 'housing_loft', x: 16 * 32 + 16, y: 10 * 32 + 16 });
        await page.keyboard.press('Space');
        await page.waitForFunction(() =>
            v.teamPokemons.every(
                (p) => p.currentHp === p.maxHp && p.status === 'normal'
            )
        );
        const healed = await teams.loadEquipe(accounts[0].id);
        assert(
            healed.pokemons.every(
                (p) =>
                    p.currentHp === p.maxHp &&
                    p.status === 'normal' &&
                    p.movePp.every((n) => n > 0)
            )
        );
        checks.push(
            'Space near installed furniture opens the native Pokémon PC and heals HP/status/PP through the normal persisted party path'
        );
        await page.evaluate(() => v.handleMenuAction('minimap'));
        await page.locator('[data-house-marker]').waitFor();
        await page.locator('[data-map-node="owned-house"]').click();
        await shot('house-flight', 1280, 900, '.region-panel');
        assert(await page.locator('[data-fly]').isEnabled());
        await page.locator('[data-fly]').click();
        await page.waitForFunction(
            () => !v.flight && !v.mapLoading && !v.housingState
        );
        assert.equal(await page.evaluate(() => v.map), entries.entries[0].map);
        await page.keyboard.press('Space');
        await page.waitForFunction(() => !!v.housingState && !v.mapLoading);
        checks.push(
            'own house marker uses native flight and lands at the validated doorstep; Space re-enters the same home'
        );
        guest = await ctx(accounts[1]);
        await page.locator('[data-housing-manage]').click();
        await page.getByRole('tab', { name: 'Étages', exact: false }).click();
        await page
            .getByRole('button', { name: 'Ajouter Le Nid', exact: false })
            .click();
        await settled();
        await page.getByRole('tab', { name: 'Inviter', exact: false }).click();
        await page
            .getByRole('button', { name: 'Inviter', exact: true })
            .click();
        await settled();
        await guest.locator('.housing-invitation').waitFor();
        await guest
            .getByRole('button', { name: 'Visiter', exact: false })
            .click();
        await guest.waitForFunction(
            () => !!v.housingState && !v.mapLoading && !v.housingBusy
        );
        await page
            .getByRole('tab', { name: 'Paramètres', exact: false })
            .click();
        await page
            .getByRole('button', { name: 'Revendre ma maison', exact: true })
            .click();
        for (const [w, h] of [
            [1280, 900],
            [393, 852],
            [320, 568],
            [844, 390],
        ])
            await shot('sale-confirm-' + w, w, h);
        await page
            .getByRole('button', { name: 'Garder ma maison', exact: true })
            .click();
        assert((await repo.read(accounts[0].id)).entryKey);
        await page
            .getByRole('button', { name: 'Revendre ma maison', exact: true })
            .click();
        const beforeSale = await repo.wallet(accounts[0].id);
        await page.getByRole('button', { name: /Confirmer ·/ }).click();
        await page.waitForFunction(
            () => !v.housingBusy && !v.housingState && !v.mapLoading
        );
        await guest.waitForFunction(() => !v.housingState && !v.mapLoading);
        assert.equal(await repo.wallet(accounts[0].id), beforeSale + 2240000);
        assert.deepEqual((await repo.read(accounts[0].id)).inventory, stock);
        assert.equal(
            await page.evaluate(() => v.progressionState.flight.house),
            null
        );
        await page.evaluate(() => v.handleMenuAction('minimap'));
        await page.locator('.region-panel').waitFor();
        assert.equal(await page.locator('[data-house-marker]').count(), 0);
        await page
            .getByRole('button', { name: 'Fermer la carte', exact: true })
            .click();
        checks.push(
            'sale confirmation can cancel; confirmed sale credits 80% once, returns all stock, ejects owner and guest and removes flight marker'
        );
        const entry = entries.entries[1];
        await move(entries.outside(entry));
        await page.keyboard.press('Space');
        await page.locator('[data-housing-panel]').waitFor();
        await page
            .getByRole('button', { name: 'Acheter Le Nid', exact: false })
            .click();
        await settled();
        await page.waitForFunction(
            (key) => v.housingState?.entryKey === key,
            entry.key
        );
        assert.deepEqual((await repo.read(accounts[0].id)).inventory, stock);
        assert.equal(
            await page.evaluate(() => v.progressionState.flight.house.entryKey),
            entry.key
        );
        await page.setViewportSize({width:1280,height:900});await page.waitForTimeout(400);
        await page.getByRole('tab',{name:'Aménager',exact:true}).click();
        await page.locator('[data-housing-editor]').waitFor();
        await place('Lit grenat', 10, 10);
        await save();
        checks.push(
            'buying another house retains furniture and updates flight destination; returned bed can be installed again'
        );
        await closeHouse();
        await page.evaluate(() => v.housingCommand('exit'));
        await settled();
        await move({ map: 'ville1', x: 720, y: 432 });
        await page.waitForFunction(() =>
            v.pnjs.some((p) => p.name === 'town_lina')
        );
        const maria = await page.evaluate(() => {
            const p = v.pnjs.find((p) => p.name === 'town_lina');
            return { x: p.x, y: p.y, sprite: p.sprite };
        });
        await move({
            map: 'ville1',
            x: (maria.x - 1) * 32 + 16,
            y: maria.y * 32 + 16,
        });
        await shot('maria-compare-desktop', 1280, 900, '.game-stage');
        await shot('maria-compare-mobile', 393, 852, '.game-stage');
        assert.equal(maria.sprite, 'maria-blue-v1.png');
        checks.push(
            'Maria rendered beside the real player at the same ground anchor on desktop and mobile, source artwork unchanged'
        );
        assert.deepEqual(errors, []);
        success = true;
    } catch (e) {
        console.error(e.stack);
        if (page) {
            console.error(
                await page
                    .evaluate(() => ({
                        map: v?.map,
                        error: v?.housingError,
                        panel: v?.housingPanel,
                        pc: v?.pc?.visible,
                        flight: v?.progressionState?.flight,
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
        manager.stop();
        await require('../server/realtime/casinoSlots')
            .getSlotsManager(io)
            .stop();
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
            scope: 'Compiled client with real HTTP/Socket.IO/MySQL, disposable accounts only; fixture positioning through native server travel. Mouse and touch interactions; WebKit is not a physical iPhone test.',
        };
        fs.writeFileSync(out + '/report.json', JSON.stringify(report, null, 2));
        console.log(JSON.stringify(report));
    }
})();
