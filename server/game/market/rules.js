const { createHash } = require("node:crypto");
const catalog = new Map(
  require("../../../data/game/items.json").items.map((i) => [i.key, i])
);
const corruption = require("../corruption/modules");
const categories = [
  ["pokemon", "Pokémon"],
  ["corrupted_pokemon", "Pokémon corrompus"],
  ["medicine", "Soins et Repousses"],
  ["training", "Entraînement"],
  ["machines", "CS"],
  ["balls", "Balls"],
  ["berries", "Baies"],
  ["corrupted_berries", "Baies corrompues"],
  ["held", "Objets tenus"],
  ["corrupted_held", "Objets corrompus"],
  ["corruption", "Modules de corruption"],
  ["evolution", "Évolution"],
  ["treasures", "Trésors"],
  ["other", "Autres"],
].map(([key, name]) => ({ key, name }));
const hidden = new Set([
  "corrupted_pokemon",
  "corrupted_berries",
  "corrupted_held",
  "corruption",
]);
// Legacy listings remain recoverable by their owner, but cannot be listed or bought.
const removed = new Set(['medicine', 'training', 'machines', 'balls', 'berries', 'held']);
const fail = (message) => {
  throw Object.assign(Error(message), { statusCode: 409 });
};
const uuid = (id) => {
  if (
    typeof id !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      id
    )
  )
    fail("Annonce invalide.");
  return id;
};
function item(key) {
  return catalog.get(key) || corruption.get(key);
}
function category(i) {
  if (i.corruptionModule || i.category === "corruption") return "corruption";
  if (i.corruptedHeldItem) return "corrupted_held";
  if (i.berryKind) return "corrupted_berries";
  if (i.category === "treasure") return "treasures";
  if (i.category === "machine") return "machines";
  if (i.category === "ball") return "balls";
  if (["heal", "field"].includes(i.category)) return "medicine";
  if (
    Object.keys(i.fieldUse || {}).some((k) =>
      [
        "potentialIncrease",
        "levelUp",
        "effort",
        "ivReroll",
        "effortReset",
        "abilityReroll",
        "natureReroll",
      ].includes(k)
    )
  )
    return "training";
  if (i.category === "held" && /_berry$/.test(i.key)) return "berries";
  return ["held", "evolution"].includes(i.category) ? i.category : "other";
}
function saleItem(key) {
  const i = item(key);
  if (
    !i ||
    i.category === "key" ||
    i.purchaseLimit ||
    key === "exp_share" ||
    /^dark_module_fragment_/.test(key)
  )
    fail("Cet objet personnel ne peut pas être vendu.");
  if (removed.has(category(i))) fail("Cette catégorie n’est plus disponible à l’hôtel des ventes.");
  return i;
}
function offer(p = {}) {
  const id = uuid(p.requestId),
    price = Number(p.price);
  if (
    !Number.isSafeInteger(price) ||
    price < 1 ||
    price > Number.MAX_SAFE_INTEGER
  )
    fail("Indique un prix entier positif.");
  let value;
  if (p.kind === "pokemon")
    value = { kind: "pokemon", pokemonUuid: uuid(p.pokemonUuid), price };
  else if (p.kind === "item") {
    saleItem(p.itemKey);
    if (!Number.isInteger(p.quantity) || p.quantity < 1 || p.quantity > 9999)
      fail("Choisis entre 1 et 9 999 objets.");
    value = { kind: "item", itemKey: p.itemKey, quantity: p.quantity, price };
  } else fail("Choisis un objet ou un Pokémon.");
  return {
    id,
    ...value,
    hash: createHash("sha256").update(JSON.stringify(value)).digest("hex"),
  };
}
function canView(category, unlocked) {
  return !hidden.has(category) || unlocked;
}
module.exports = {
  categories,
  hidden,
  removed,
  item,
  category,
  saleItem,
  offer,
  uuid,
  fail,
  canView,
};
