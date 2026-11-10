// Compiled UI + native HTTP/Socket/SQL, disposable accounts on a dedicated DB.
const assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path"),
  http = require("node:http"),
  { once } = require("node:events"),
  { randomUUID } = require("node:crypto");
assert.equal(process.env.DB_TEST_NAME, "explorakit_test");
process.env.DB_NAME = "explorakit_test";
process.env.NODE_ENV = "test";
const { dbPool: db } = require("../server/config/database"),
  users = require("../server/persistence/userRepository"),
  pc = require("../server/persistence/pokemonStorageRepository"),
  factory = require("../server/game/drift/pokemonFactory");
const dist = process.env.RELEASE_DIST_DIR,
  engine = process.env.PRESENTATION_BROWSER || "chromium",
  out = "/tmp/riftmon-player-market-" + engine;
assert(fs.existsSync(dist + "/index.html"));
fs.mkdirSync(out, { recursive: true });
const app = require("express")(),
  server = http.createServer(app),
  io = new (require("socket.io").Server)(server);
app.use(require("express").json());
app.use("/api", require("../server/http/routes"));
app.use(require("express").static(dist));
app.get("*", (_q, r) => r.sendFile(path.join(dist, "index.html")));
io.use(require("../server/http/authMiddleware").authenticateSocket);
require("../server/realtime/socketHandler")(io);
const accounts = [],
  checks = [],
  views = [],
  errors = [];
let browser,
  page,
  partner,
  success = false;
async function account(withCard) {
  const u = await users.createUserWithStarter(
    "MarketUI_" + randomUUID().slice(0, 8),
    randomUUID()
  );
  accounts.push(u);
  const clerk = require("../server/game/market/clerks").actor(
    "ville1",
    require("../server/game/world/pnjStore")
  );
  await db.execute(
    "UPDATE users SET money=2000000,map='ville1',x=?,y=? WHERE id=?",
    [(clerk.x + 1) * 32 + 16, clerk.y * 32 + 16, u.id]
  );
  const flags = {
    adventure_opening: "complete",
    early_game_tutorial: JSON.stringify({
      version: 1,
      phase: "complete",
      metWayne: true,
    }),
    fly_module_received: "true",
    "visited_town:start": "true",
    "visited_region:jungle1": "true",
    dc2_arrived: "true",
    dark_rules_read: "true",
  };
  for (const [k, v] of Object.entries(flags))
    await db.execute(
      "INSERT INTO player_story_flags(user_id,flag_key,flag_value) VALUES(?,?,?) ON DUPLICATE KEY UPDATE flag_value=VALUES(flag_value)",
      [u.id, k, v]
    );
  for (const key of [
    "pokeball",
    "dark_aerial_module",
    "fly_module",
    "dark_exploration_chart",
    ...(withCard ? ["professional_trainer_card", "cmod_offense_normal"] : []),
  ])
    await db.execute(
      "INSERT INTO user_items(user_id,item_key,quantity) VALUES(?,?,?) ON DUPLICATE KEY UPDATE quantity=VALUES(quantity)",
      [u.id, key, key === "pokeball" ? 12 : 1]
    );
  for (const [id, held] of [
    [94, null],
    [143, "leftovers"],
  ]) {
    const p = factory.create(id, 80, true);
    p.heldItem = held;
    await pc.storeCapturedPokemon(u.id, p);
  }
  await require("../server/persistence/patchNotesRepository").acknowledge(
    u.id,
    require("../data/game/latest_patch.json").version
  );
  return u;
}
async function connect(u) {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    hasTouch: true,
    serviceWorkers: "block",
  });
  await context.addInitScript(
    (u) => localStorage.setItem("explorakit.user", JSON.stringify(u)),
    { ...u, token: require("../server/config/auth").signAccessToken(u) }
  );
  const p = await context.newPage();
  p.on("pageerror", (e) => errors.push(e.message));
  await p.goto("http://127.0.0.1:" + server.address().port + "/");
  await p.locator(".mode-card.adventure").click();
  await p.waitForFunction(() => {
    const v = document.querySelector(".game-root")?.__vue__;
    if (v?.socket?.connected && !v.mapLoading && v.renderedMap === v.map) {
      window.v = v;
      return true;
    }
    return false;
  });
  await p.evaluate(() =>
    v.updatePreferences({
      ...v.preferences,
      masterVolume: 0,
      animationsEnabled: false,
    })
  );
  return p;
}
async function open(p) {
  await p.evaluate(() => v.socket.emit("Space", { action: "Space" }));
  await p.locator(".market-panel").waitFor();
}
async function settled(p = page) {
  await p.waitForFunction(() => {
    const m = document.querySelector(".market-backdrop")?.__vue__;
    if (m) {
      window.market = m;
      return !m.busy;
    }
    return false;
  });
  assert.equal(
    await p.locator(".market-error").count(),
    0,
    await p.locator(".market-error").allTextContents()
  );
}
async function shot(name, w, h) {
  await page.setViewportSize({ width: w, height: h });
  await page.waitForTimeout(350);
  const top = (await page.locator(".companion-sheet").count())
    ? page.locator(".companion-sheet")
    : page.locator(".market-panel");
  const r = await top.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return {
      x: r.x,
      y: r.y,
      right: r.right,
      bottom: r.bottom,
      scroll: document.documentElement.scrollWidth,
    };
  });
  assert(
    r.x >= 0 &&
      r.y >= 0 &&
      r.right <= w + 1 &&
      r.bottom <= h + 1 &&
      r.scroll <= w + 1,
    JSON.stringify(r)
  );
  await page.screenshot({ path: out + "/" + name + ".png" });
  views.push({ name, w, h });
}
(async () => {
  try {
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const a = await account(true),
      b = await account(false);
    browser = await require("playwright")[engine].launch({ headless: true });
    page = await connect(a);
    partner = await connect(b);
    const sprite = await page.evaluate(async () => {
      const actor=v.pnjs.find(p=>p.name.startsWith('market_clerk'));
      if(!actor)throw Error('Missing town clerk');
      const image=v.ensurePnjSpriteSheet(actor.sprite);await image.decode();
      const canvas=document.createElement('canvas');canvas.width=2048;canvas.height=2048;
      const ctx=canvas.getContext('2d'),draw=ctx.drawImage,calls=[];
      ctx.drawImage=function(img,...args){if(img===image)calls.push(args.slice(0,4));return draw.call(this,img,...args);};
      v.drawPnjs(ctx);
      return {index:actor.spriteFrame.index,crop:calls.find(c=>c[0]===174&&c[1]===930)};
    });
    assert.equal(sprite.index,40);
    assert.deepEqual(sprite.crop,[174,930,19,24]);
    await page.screenshot({path:out+'/requested-clerk-room.png'});
    checks.push('Real town NPC renderer uses exactly the requested blue-cap atlas crop');
    await open(page);
    await settled();
    assert(await page.locator('.market-order').isVisible());
    assert.equal(await page.getByLabel('Trier',{exact:true}).count(),0);
    assert(
      await page
        .locator("aside button")
        .filter({ hasText: "Modules de corruption" })
        .count()
    );
    await open(partner);
    await settled(partner);
    assert.equal(
      await partner
        .locator("aside button")
        .filter({ hasText: "Modules de corruption" })
        .count(),
      0
    );
    for (const [w, h] of [
      [1280, 900],
      [393, 852],
      [320, 568],
      [844, 390],
    ])
      await shot("browse-" + w, w, h);
    checks.push(
      "Native town-clerk interaction opens the market; corruption tabs depend on server ownership; no viewport overflow"
    );
    await page.setViewportSize({ width: 1280, height: 900 });
    await page
      .getByRole("button", { name: "Déposer une annonce", exact: true })
      .click();
    await settled();
    await page
      .locator(".market-inventory button")
      .filter({ hasText: /Pok[eé].*ball/i })
      .click();
    await page.getByLabel("Quantité du lot").fill("3");
    await page.getByLabel("Prix total du lot en ₽").fill("5000");
    await page.getByRole("button", { name: "Préparer l’annonce" }).click();
    await page
      .locator(".market-confirm")
      .getByRole("button", { name: "Confirmer", exact: true })
      .click();
    await settled();
    assert.equal(await page.locator(".listing-status").count(), 0);
    const listing = await page
      .locator("[data-market-listing]")
      .first()
      .getAttribute("data-market-listing");
    await partner
      .getByRole("button", { name: "Rechercher", exact: true })
      .click();
    await settled(partner);
    await partner
      .locator('[data-market-listing="' + listing + '"]')
      .getByRole("button", { name: "Acheter", exact: true })
      .click();
    await partner
      .locator(".market-confirm")
      .getByRole("button", { name: "Confirmer", exact: true })
      .click();
    await settled(partner);
    await page.locator(".market-sale-toast").waitFor();
    await page.reload();
    await page.waitForFunction(() => {
      const v = document.querySelector(".game-root")?.__vue__;
      if (v?.socket?.connected && !v.mapLoading) {
        window.v = v;
        return true;
      }
      return false;
    });
    await page.locator(".market-sale-toast").waitFor();
    await page.getByRole("button", { name: "Compris", exact: true }).click();
    await page.locator(".market-sale-toast").waitFor({ state: "hidden" });
    await open(page);
    await settled();
    const [[wallet]] = await db.execute("SELECT money FROM users WHERE id=?", [
      a.id,
    ]);
    assert.equal(Number(wallet.money), 2005000);
    checks.push(
      "Real UI publishes an escrowed item lot; a second authenticated player buys it, pays exactly once and notifies the online seller"
    );
    await page
      .getByRole("button", { name: "Déposer une annonce", exact: true })
      .click();
    await settled();
    await page
      .getByRole("button", { name: "Équipe et PC", exact: true })
      .click();
    await page.getByLabel("Boîte PC").selectOption("box:0");
    assert.equal(
      await page.locator(".market-inventory button:disabled").count(),
      1
    );
    await page
      .locator(".market-inventory button")
      .filter({ hasText: "Ectoplasma" })
      .click();
    await page.getByLabel("Prix total du lot en ₽").fill("90000");
    await page.getByRole("button", { name: "Préparer l’annonce" }).click();
    await page
      .locator(".market-confirm")
      .getByRole("button", { name: "Confirmer", exact: true })
      .click();
    await settled();
    await page
      .getByRole("button", { name: "Examiner le Pokémon" })
      .first()
      .click();
    await page
      .locator(".companion-sheet")
      .getByRole("tab", { name: "Potentiel", exact: true })
      .click();
    assert((await page.locator(".companion-sheet").innerText()).includes("31"));
    await page
      .locator(".companion-sheet")
      .getByRole("tab", { name: "Entraînement", exact: true })
      .click();
    await shot("pokemon-inspection", 393, 852);
    await page
      .getByRole("button", { name: "Fermer la fiche", exact: true })
      .click();
    await page
      .locator("[data-market-listing]")
      .filter({ hasText: "Ectoplasma" })
      .getByRole("button", { name: "Retirer", exact: true })
      .click();
    await page
      .locator(".market-confirm")
      .getByRole("button", { name: "Confirmer", exact: true })
      .click();
    await settled();
    assert((await pc.loadEntries(a.id)).some((e) => e.pokemon.data.id === 94));
    checks.push(
      "Team/PC seller UI blocks held items, previews exact stats and restores a cancelled Pokémon to its PC"
    );
    await page.locator("header>button").click();
    await page.evaluate(async () => {
      const r = await new Promise((resolve) =>
        v.socket.emit("darkAerial:set", { active: true }, resolve)
      );
      if (!r.success) throw Error(r.message);
    });
    await page.waitForFunction(
      () => v.progressionState.flight?.darkAerial?.active
    );
    await page.evaluate(() => v.flyToTown("DC2_44"));
    await page.waitForFunction(
      () => v.map === "DC2_44" && !v.mapLoading && !v.flight
    );
    await page.waitForTimeout(3100);
    await page.evaluate(() => v.flyToTown("start"));
    await page.waitForFunction(
      () => v.map === "start" && !v.mapLoading && !v.flight
    );
    assert.equal(await page.evaluate(()=>v.pnjs.some(p=>p.name.startsWith('market_clerk'))),false);
    checks.push(
      "The assembled module activates durably and enables native flight to the visited real Dark Continent and back"
    );
    await page.evaluate(() => v.handleMenuAction("minimap"));
    await page.locator(".region-panel").waitFor();
    await page.screenshot({ path: out + "/extended-dark-continent.png" });
    assert(await page.locator("[data-true-dark-continent]").count());
    views.push({ name: "extended-dark-continent", w: 393, h: 852 });
    assert.deepEqual(errors, []);
    success = true;
  } catch (e) {
    console.error(e.stack);
    if (page)
      await page.screenshot({ path: out + "/failure.png" }).catch(() => {});
    process.exitCode = 1;
  } finally {
    await browser?.close();
    await require("../server/realtime/housing").getHousingManager(io).stop();
    await require("../server/realtime/casinoSlots").getSlotsManager(io).stop();
    await require("../server/realtime/raidManager").getRaidManager(io).stop();
    await require("../server/realtime/draftManager").getDraftManager(io).stop();
    require("../server/realtime/whitepeakClub").getClub(io).close();
    await new Promise((r) => io.close(r));
    await require("../server/realtime/accountConnection").waitForAccountConnections(
      io
    );
    for (const u of accounts)
      await db.execute("DELETE FROM player_market_notices WHERE user_id=?", [
        u.id,
      ]);
    for (const u of accounts)
      await db.execute(
        "DELETE FROM player_market_listings WHERE seller_id=? OR buyer_id=?",
        [u.id, u.id]
      );
    for (const u of accounts)
      await db.execute("DELETE FROM users WHERE id=?", [u.id]);
    await db.end();
    const report = {
      success,
      engine,
      checks,
      views,
      errors,
      scope:
        "Compiled UI, native HTTP/Socket/MySQL, disposable users. Automated WebKit is not a physical iPhone.",
    };
    fs.writeFileSync(out + "/report.json", JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report));
  }
})();
