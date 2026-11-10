const { dbPool, withTransaction } = require("../config/database");
const rules = require("../game/market/rules"),
  teams = require("./teamRepository"),
  pc = require("./pokemonStorageRepository"),
  storage = require("../game/storage/pokemonStorage");
const { fail } = rules;
async function transaction(work) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await withTransaction(work);
    } catch (e) {
      if (
        attempt >= 2 ||
        !["ER_LOCK_DEADLOCK", "ER_LOCK_WAIT_TIMEOUT"].includes(e.code)
      )
        throw e;
      await new Promise((resolve) => setTimeout(resolve, 15 * (attempt + 1)));
    }
  }
}
async function unlocked(id, c = dbPool) {
  const [[r]] = await c.execute(
    "SELECT quantity FROM user_items WHERE user_id=? AND item_key='professional_trainer_card'" +
      (c === dbPool ? "" : " FOR UPDATE"),
    [id]
  );
  return Number(r?.quantity) > 0;
}
async function lockOwners(c, ids) {
  for (const id of [...new Set(ids)].sort((a, b) => a - b)) {
    const [[r]] = await c.execute(
      "SELECT id FROM users WHERE id=? FOR UPDATE",
      [id]
    );
    if (!r) fail("Dresseur introuvable.");
  }
}
async function safeOwner(id, c) {
  await require("./darkBattleRepository").assertInactive(id, c);
  require("../game/social/tradeLocks").assertUnlocked(id);
  const [[r]] = await c.execute(
    "SELECT snapshot FROM super_tournament_profiles WHERE user_id=?",
    [id]
  );
  if (r?.snapshot) {
    const run = require("../game/drift/checkpointCodec").decode(r.snapshot);
    if (run && !run.paused)
      fail("Mets ton parcours en pause avant de modifier ton inventaire.");
  }
}
function view(r) {
  let pokemon = null;
  if (r.pokemon_data)
    pokemon = storage.view([pc.decodePokemon(r.pokemon_data)], []).team[0];
  const i = r.item_key ? rules.item(r.item_key) : null;
  return {
    id: r.id,
    sellerId: Number(r.seller_id),
    seller: r.seller,
    category: r.category,
    kind: r.kind,
    itemKey: r.item_key,
    quantity: Number(r.quantity),
    price: Number(r.price),
    pokemon,
    name: pokemon?.speciesName || i?.name || r.item_key,
    description: i?.description || "",
    status: r.status,
    createdAt: r.created_at,
  };
}
async function inventory(id) {
  return transaction(async (c) => {
    await lockOwners(c, [id]);
    await safeOwner(id, c);
    const open = await unlocked(id, c),
      record = await teams.getTeamRecord(id, c);
    const team = record
        ? (await teams.getTeamPokemons(record.id, c)).map(teams.rowToPokemon)
        : [],
      entries = await pc.loadEntries(id, c);
    const [rows] = await c.execute(
      "SELECT item_key,quantity FROM user_items WHERE user_id=? AND quantity>0 ORDER BY item_key",
      [id]
    );
    const items = rows.flatMap((r) => {
      try {
        const i = rules.saleItem(r.item_key),
          category = rules.category(i);
        return rules.canView(category, open)
          ? [
              {
                key: i.key,
                name: i.name,
                description: i.description,
                category,
                quantity: Number(r.quantity),
              },
            ]
          : [];
      } catch {
        return [];
      }
    });
    const state = storage.view(team, entries);
    for (const p of [...state.team, ...state.entries.map((e) => e.pokemon)])
      p.unavailableReason = p.heldItem
        ? "Retire son objet tenu avant la vente."
        : p.corruption && !open
        ? "Une Carte du Dresseur Professionnel est nécessaire."
        : "";
    return { ...state, items, unlocked: open };
  });
}
async function browse(id, p = {}) {
  const open = await unlocked(id),
    where = ["l.status='open'"],
    values = [];
  if (p.mine === true) {
    where.splice(0, 1, "l.seller_id=?");
    values.push(id);
  }
  if (p.category) {
    if (
      !rules.categories.some((c) => c.key === p.category) ||
      !rules.canView(p.category, open)
    )
      fail("Cette catégorie est inaccessible.");
    where.push("l.category=?");
    values.push(p.category);
  }
  if (!open) {
    where.push(
      `l.category NOT IN (${[...rules.hidden].map(() => "?").join(",")})`
    );
    values.push(...rules.hidden);
  }
  if (p.search) {
    where.push("l.search_text LIKE ?");
    values.push(
      "%" +
        String(p.search)
          .slice(0, 80)
          .replace(/[\\%_]/g, "\\$&") +
        "%"
    );
  }
  for (const [key, column, min, max] of [
    ["minLevel", "pokemon_level", 1, 9999],
    ["maxLevel", "pokemon_level", 1, 9999],
    ["k", "pokemon_k", 1, 4],
  ])
    if (p[key] !== undefined && p[key] !== "") {
      const n = Number(p[key]);
      if (!Number.isInteger(n) || n < min || n > max) fail("Filtre invalide.");
      where.push(
        `l.${column}${
          key === "minLevel" ? ">=" : key === "maxLevel" ? "<=" : "="
        }?`
      );
      values.push(n);
    }
  if (p.shiny === true) where.push("l.pokemon_shiny=1");
  if (p.type) {
    if (
      !Object.keys(require("../game/world/darkContinent").TYPES).includes(
        p.type
      )
    )
      fail("Type invalide.");
    where.push("FIND_IN_SET(?,l.pokemon_types)>0");
    values.push(p.type);
  }
  const page = Math.max(0, Math.min(10000, Math.floor(Number(p.page) || 0))),
    sort =
      {
        new: "l.created_at DESC,l.id DESC",
        price: "l.price ASC,l.id ASC",
        price_desc: "l.price DESC,l.id ASC",
      }[p.sort] || "l.created_at DESC,l.id DESC";
  const [rows] = await dbPool.execute(
    `SELECT l.*,u.username AS seller FROM player_market_listings l JOIN users u ON u.id=l.seller_id WHERE ${where.join(
      " AND "
    )} ORDER BY ${sort} LIMIT 25 OFFSET ${page * 24}`,
    values
  );
  const [[wallet]] = await dbPool.execute(
    "SELECT money FROM users WHERE id=? FOR UPDATE",
    [id]
  );
  return {
    listings: rows.slice(0, 24).map(view),
    hasMore: rows.length > 24,
    page,
    money: Number(wallet.money),
    unlocked: open,
    categories: rules.categories.filter((c) => rules.canView(c.key, open)),
  };
}
async function publish(id, p) {
  const offer = rules.offer(p);
  return transaction(async (c) => {
    await lockOwners(c, [id]);
    await safeOwner(id, c);
    const [[old]] = await c.execute(
      "SELECT * FROM player_market_listings WHERE id=?",
      [offer.id]
    );
    if (old) {
      if (Number(old.seller_id) !== id || old.request_hash !== offer.hash)
        fail("Cette confirmation appartient à une autre annonce.");
      return { listing: view(old), duplicate: true };
    }
    const [[count]] = await c.execute(
      "SELECT COUNT(*) n FROM player_market_listings WHERE seller_id=? AND status='open'",
      [id]
    );
    if (Number(count.n) >= 100) fail("Tu as déjà 100 annonces actives.");
    let pokemon = null,
      encoded = null,
      cat,
      i;
    if (offer.kind === "item") {
      i = rules.saleItem(offer.itemKey);
      cat = rules.category(i);
      if (!rules.canView(cat, await unlocked(id, c)))
        fail("Une Carte du Dresseur Professionnel est nécessaire.");
      const [r] = await c.execute(
        "UPDATE user_items SET quantity=quantity-? WHERE user_id=? AND item_key=? AND quantity>=?",
        [offer.quantity, id, offer.itemKey, offer.quantity]
      );
      if (r.affectedRows !== 1) fail("Tu ne possèdes plus assez de cet objet.");
    } else {
      const record = await teams.getTeamRecord(id, c);
      if (!record) fail("Équipe introuvable.");
      const rows = await teams.getTeamPokemons(record.id, c),
        team = rows.map(teams.rowToPokemon),
        entries = await pc.loadEntries(id, c, true),
        party = team.find((p) => p.uuid === offer.pokemonUuid),
        stored = entries.find((e) => e.pokemon.uuid === offer.pokemonUuid);
      if (Boolean(party) === Boolean(stored))
        fail("Ce Pokémon n’est plus disponible.");
      pokemon = party || stored.pokemon;
      if (pokemon.heldItem || pokemon.isEgg)
        fail("Retire son objet tenu. Les Œufs ne peuvent pas être vendus.");
      cat = require("../game/corruption/pokemon").view(pokemon)
        ? "corrupted_pokemon"
        : "pokemon";
      if (!rules.canView(cat, await unlocked(id, c)))
        fail("Une Carte du Dresseur Professionnel est nécessaire.");
      encoded = pc.encodePokemon(pokemon);
      if (party) {
        const remaining = team.filter((p) => p !== party);
        if (!remaining.some(storage.isAble))
          fail("Garde au moins un Pokémon apte dans ton équipe.");
        await c.execute("DELETE FROM pokemons WHERE team_id=? AND uuid=?", [
          record.id,
          pokemon.uuid,
        ]);
        await c.execute(
          "UPDATE pokemons SET position=position-1 WHERE team_id=? AND position>? ORDER BY position ASC",
          [record.id, rows.find((p) => p.uuid === pokemon.uuid).position]
        );
      } else
        await c.execute(
          "DELETE FROM pokemon_storage WHERE user_id=? AND uuid=?",
          [id, pokemon.uuid]
        );
    }
    const name = pokemon
      ? [
          pokemon.name,
          pokemon.truename,
          pokemon.data.name?.english,
          String(pokemon.data.id).padStart(3, "0"),
          pokemon.passiveAbility,
          require("../../data/game/corruption_labels.fr.json").abilities[pokemon.passiveAbility],
          pokemon.nature,
        ].join(" ")
      : i.name;
    await c.execute(
      "INSERT INTO player_market_listings(id,seller_id,request_hash,category,kind,item_key,quantity,price,pokemon_uuid,pokemon_data,search_text,pokemon_types,pokemon_level,pokemon_k,pokemon_shiny) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
      [
        offer.id,
        id,
        offer.hash,
        cat,
        offer.kind,
        offer.itemKey || null,
        offer.quantity || 1,
        offer.price,
        pokemon?.uuid || null,
        encoded,
        name.slice(0, 255),
        pokemon?.data.type.join(",") || null,
        pokemon?.level || null,
        pokemon?.k || null,
        pokemon?.shiny ? 1 : 0,
      ]
    );
    const [[saved]] = await c.execute(
      "SELECT * FROM player_market_listings WHERE id=?",
      [offer.id]
    );
    return { listing: view(saved), duplicate: false };
  });
}
async function receive(c, id, r) {
  if (r.kind === "pokemon") {
    const [[room]] = await c.execute(
      "SELECT COUNT(*) AS n FROM pokemon_storage WHERE user_id=?",
      [id]
    );
    if (Number(room.n) >= storage.CAPACITY)
      fail("Le PC est plein. Libère une place avant de récupérer ce Pokémon.");
    const pokemon = pc.decodePokemon(r.pokemon_data);
    await pc.storeCapturedPokemon(id, pokemon, c);
  } else {
    const [[current]] = await c.execute(
      "SELECT quantity FROM user_items WHERE user_id=? AND item_key=?",
      [id, r.item_key]
    );
    if (Number(current?.quantity || 0) + Number(r.quantity) > 2147483647)
      fail("Le sac du destinataire est plein.");
    await c.execute(
      "INSERT INTO user_items(user_id,item_key,quantity) VALUES(?,?,?) ON DUPLICATE KEY UPDATE quantity=quantity+VALUES(quantity)",
      [id, r.item_key, r.quantity]
    );
    if (rules.item(r.item_key)?.unique)
      await c.execute(
        "INSERT IGNORE INTO user_item_discoveries(user_id,item_key) VALUES(?,?)",
        [id, r.item_key]
      );
  }
}
async function settle(id, listingId, cancel = false) {
  rules.uuid(listingId);
  // Read the routing hint before BEGIN: do not create an old repeatable-read
  // snapshot while waiting for the sorted account locks. Every asset is read
  // and validated again under those locks.
  const [[hint]] = await dbPool.execute(
    "SELECT seller_id FROM player_market_listings WHERE id=?",
    [listingId]
  );
  if (!hint) fail("Cette annonce n’existe plus.");
  const seller = Number(hint.seller_id);
  return transaction(async (c) => {
    await lockOwners(c, [id, seller]);
    await safeOwner(id, c);
    const [[r]] = await c.execute(
      "SELECT * FROM player_market_listings WHERE id=? FOR UPDATE",
      [listingId]
    );
    if (cancel && seller !== id) fail("Cette annonce ne t’appartient pas.");
    if (!cancel && seller === id)
      fail("Tu ne peux pas acheter ta propre annonce.");
    if (r.status !== "open") {
      if (
        (cancel && r.status === "cancelled" && seller === id) ||
        (!cancel && r.status === "sold" && Number(r.buyer_id) === id)
      )
        return { duplicate: true, sellerId: seller, listing: view(r) };
      fail("Cette annonce a déjà été retirée ou achetée.");
    }
    if (!rules.canView(r.category, await unlocked(id, c)))
      fail("Une Carte du Dresseur Professionnel est nécessaire.");
    if (cancel) {
      await receive(c, id, r);
      await c.execute(
        "UPDATE player_market_listings SET status='cancelled',settled_at=CURRENT_TIMESTAMP,pokemon_uuid=NULL WHERE id=?",
        [listingId]
      );
    } else {
      const [[buyer]] = await c.execute(
          "SELECT money FROM users WHERE id=? FOR UPDATE",
          [id]
        ),
        [[owner]] = await c.execute(
          "SELECT money FROM users WHERE id=? FOR UPDATE",
          [seller]
        );
      if (BigInt(buyer.money) < BigInt(r.price))
        fail("Tu n’as pas assez de Pokédollars.");
      if (
        BigInt(owner.money) + BigInt(r.price) >
        BigInt(Number.MAX_SAFE_INTEGER)
      )
        fail("Le porte-monnaie du vendeur ne peut pas recevoir ce montant.");
      await receive(c, id, r);
      await c.execute("UPDATE users SET money=money-? WHERE id=?", [
        r.price,
        id,
      ]);
      await c.execute("UPDATE users SET money=money+? WHERE id=?", [
        r.price,
        seller,
      ]);
      await c.execute(
        "UPDATE player_market_listings SET status='sold',buyer_id=?,settled_at=CURRENT_TIMESTAMP,pokemon_uuid=NULL WHERE id=?",
        [id, listingId]
      );
      const message = `Vente réussie : ${view(r).name}${
        r.quantity > 1 ? " × " + r.quantity : ""
      }. ${Number(r.price).toLocaleString(
        "fr-FR"
      )} ₽ ont été versés sur ton compte.`;
      await c.execute(
        "INSERT INTO player_market_notices(user_id,listing_id,message) VALUES(?,?,?)",
        [seller, listingId, message]
      );
    }
    r.status = cancel ? "cancelled" : "sold";
    return { duplicate: false, sellerId: seller, listing: view(r) };
  });
}
async function notices(id) {
  const [rows] = await dbPool.execute(
    "SELECT id,message FROM player_market_notices WHERE user_id=? AND read_at IS NULL ORDER BY id LIMIT 100",
    [id]
  );
  return rows.map((r) => ({ id: String(r.id), message: r.message }));
}
async function acknowledge(id, values) {
  if (
    !Array.isArray(values) ||
    values.length > 100 ||
    values.some((v) => !/^\d{1,20}$/.test(String(v)))
  )
    fail("Notifications invalides.");
  if (values.length)
    await dbPool.execute(
      `UPDATE player_market_notices SET read_at=CURRENT_TIMESTAMP WHERE user_id=? AND id IN (${values
        .map(() => "?")
        .join(",")})`,
      [id, ...values]
    );
}
module.exports = {
  unlocked,
  inventory,
  browse,
  publish,
  buy: (id, key) => settle(id, key),
  cancel: (id, key) => settle(id, key, true),
  notices,
  acknowledge,
};
