const test = require("node:test"),
  assert = require("node:assert/strict"),
  { randomUUID } = require("node:crypto");
const rules = require("../server/game/market/rules"),
  moduleRules = require("../server/game/items/darkAerialModule");
test("market categories match bag semantics and keep personal items out", () => {
  assert.equal(rules.category(rules.saleItem("pokeball")), "balls");
  assert.equal(rules.category(rules.saleItem("oran_berry")), "berries");
  assert.equal(
    rules.category(rules.saleItem("corrupted_oran_berry")),
    "corrupted_berries"
  );
  assert.equal(
    rules.category(rules.saleItem("cmod_offense_water")),
    "corruption"
  );
  assert.throws(() => rules.saleItem("professional_trainer_card"), /personnel/);
  for (const price of [0, -1, 1.5, Infinity, Number.MAX_SAFE_INTEGER + 1])
    assert.throws(() =>
      rules.offer({
        requestId: randomUUID(),
        kind: "item",
        itemKey: "pokeball",
        quantity: 1,
        price,
      })
    );
  assert.equal(rules.canView("corrupted_pokemon", false), false);
  assert.equal(rules.canView("pokemon", false), true);
});
test("nine missing fragments have a one-percent server roll and assemble without duplicate pieces", () => {
  assert.equal(
    moduleRules.roll({}, () => 0.01),
    null
  );
  assert.equal(
    moduleRules.roll({}, () => 0),
    moduleRules.fragments[0]
  );
  const eight = Object.fromEntries(
    moduleRules.fragments.slice(0, 8).map((k) => [k, 1])
  );
  assert.equal(
    moduleRules.roll(eight, () => 0),
    moduleRules.fragments[8]
  );
  assert.equal(
    moduleRules.roll({ [moduleRules.KEY]: 1 }, () => 0),
    null
  );
  assert.equal(
    moduleRules.destination("DC2_44", {
      darkAerial: { active: true },
      darkDestinations: ["DC2_44"],
    }),
    true
  );
  assert.equal(
    moduleRules.destination("DC2_44", {
      darkAerial: { active: false },
      darkDestinations: ["DC2_44"],
    }),
    false
  );
});
test("every town clerk occupies open ground and leaves a clear path around it", () => {
  const base = require("../server/game/world/pnjStore"),
    terrain = require("../server/game/world/mapRepository"),
    clerks = require("../server/game/market/clerks");
  const towns = require("../server/game/world/regionMap")
    .getRegionMap()
    .nodes.filter((n) => n.kind === "town");
  assert(towns.length >= 8);
  for (const town of towns) {
    const a = clerks.actor(town.id, base),
      grid = terrain.loadCollisionData(town.id);
    assert(a);
    for (let dy = -2; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++)
        assert.equal(grid[a.y + dy][a.x + dx], 0);
    assert(
      clerks.nearby({
        currentmap: town.id,
        x: (a.x + 1) * 32 + 16,
        y: a.y * 32 + 16,
      })
    );
  }
  assert.equal(clerks.actor("route1", base), null);
});
