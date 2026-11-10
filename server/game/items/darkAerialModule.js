const KEY = "dark_aerial_module",
  ACTIVE = "dark_aerial_active",
  CHANCE = 0.01;
const fragments = Array.from(
  { length: 9 },
  (_, i) => "dark_module_fragment_" + (i + 1)
);
function missing(stock) {
  return fragments.filter((key) => Number(stock[key] || 0) < 1);
}
function roll(stock, random = Math.random) {
  if (Number(stock[KEY]) > 0 || random() >= CHANCE) return null;
  const choices = missing(stock);
  return choices.length
    ? choices[
        Math.min(choices.length - 1, Math.floor(random() * choices.length))
      ]
    : null;
}
function destination(map, state) {
  return (
    state?.darkAerial?.active &&
    state.darkDestinations?.includes(map) &&
    ["jungle1", "DC2_44"].includes(map)
  );
}
module.exports = { KEY, ACTIVE, CHANCE, fragments, missing, roll, destination };
