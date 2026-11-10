const { dbPool, withTransaction } = require("../config/database"),
  moduleRules = require("../game/items/darkAerialModule");
async function state(id, c = dbPool) {
  const [rows] = await c.execute(
    "SELECT item_key,quantity FROM user_items WHERE user_id=? AND item_key IN (?,?,?,?,?,?,?,?,?,?)",
    [id, moduleRules.KEY, ...moduleRules.fragments]
  );
  const stock = Object.fromEntries(
    rows.map((r) => [r.item_key, Number(r.quantity)])
  );
  const [[flag]] = await c.execute(
    "SELECT flag_value FROM player_story_flags WHERE user_id=? AND flag_key=?",
    [id, moduleRules.ACTIVE]
  );
  return {
    owned: stock[moduleRules.KEY] > 0,
    active: stock[moduleRules.KEY] > 0 && flag?.flag_value === "true",
    fragments: moduleRules.fragments.map((k) => Math.max(0, stock[k] || 0)),
  };
}
async function award(id, map, random, c) {
  if (!require("../game/world/darkContinent").isMap(map)) return [];
  const chance = random();
  if (chance >= moduleRules.CHANCE) return [];
  await c.execute("SELECT id FROM users WHERE id=? FOR UPDATE", [id]);
  const [rows] = await c.execute(
    "SELECT item_key,quantity FROM user_items WHERE user_id=? AND item_key IN (?,?,?,?,?,?,?,?,?,?) FOR UPDATE",
    [id, moduleRules.KEY, ...moduleRules.fragments]
  );
  const stock = Object.fromEntries(
      rows.map((r) => [r.item_key, Number(r.quantity)])
    ),
    key = moduleRules.roll(
      stock,
      (() => {
        let first = true;
        return () => {
          if (first) {
            first = false;
            return chance;
          }
          return random();
        };
      })()
    );
  if (!key) return [];
  await c.execute(
    "INSERT INTO user_items(user_id,item_key,quantity) VALUES(?,?,1) ON DUPLICATE KEY UPDATE quantity=quantity+1",
    [id, key]
  );
  stock[key] = (stock[key] || 0) + 1;
  const catalog = require("../../data/game/items.json").items,
    found = [{ ...catalog.find((i) => i.key === key), quantity: 1 }];
  if (!moduleRules.missing(stock).length) {
    for (const piece of moduleRules.fragments) {
      const [r] = await c.execute(
        "UPDATE user_items SET quantity=quantity-1 WHERE user_id=? AND item_key=? AND quantity>=1",
        [id, piece]
      );
      if (r.affectedRows !== 1) throw Error("Assemblage interrompu.");
    }
    await c.execute(
      "INSERT INTO user_items(user_id,item_key,quantity) VALUES(?,?,1) ON DUPLICATE KEY UPDATE quantity=GREATEST(quantity,1)",
      [id, moduleRules.KEY]
    );
    found.push({
      ...catalog.find((i) => i.key === moduleRules.KEY),
      quantity: 1,
      assembled: true,
    });
  }
  return found;
}
async function setActive(id, active) {
  if (typeof active !== "boolean") throw Error("État du module invalide.");
  return withTransaction(async (c) => {
    await c.execute("SELECT id FROM users WHERE id=? FOR UPDATE", [id]);
    await require("./darkBattleRepository").assertInactive(id, c);
    require("../game/social/tradeLocks").assertUnlocked(id);
    const current = await state(id, c);
    if (!current.owned)
      throw Error("Réunis les neuf fragments pour assembler ce module.");
    await c.execute(
      "INSERT INTO player_story_flags(user_id,flag_key,flag_value) VALUES(?,?,?) ON DUPLICATE KEY UPDATE flag_value=VALUES(flag_value)",
      [id, moduleRules.ACTIVE, String(active)]
    );
    return { ...current, active };
  });
}
module.exports = { state, award, setActive };
