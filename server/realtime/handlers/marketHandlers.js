const repo = require("../../persistence/marketRepository"),
  clerks = require("../../game/market/clerks");
const { dbPool } = require("../../config/database");
function createHandlers({
  socket,
  account,
  userId,
  getPlayer,
  canUse,
  canInteract,
  io,
}) {
  let busy = false,
    lastOpen = 0,
    windowUntil = 0,
    count = 0;
  async function refreshSelf() {
    const p = getPlayer();
    if (!p) return;
    const team = await require("../../persistence/teamRepository").loadEquipe(
      userId
    );
    p.equipe = team;
    socket.emit("teamStateChanged", { reason: "market", equipe: team });
    socket.emit("bagUpdated", {
      items: await require("../../persistence/itemRepository").loadUserItems(
        userId
      ),
    });
    const [[r]] = await dbPool.execute("SELECT money FROM users WHERE id=?", [
      userId,
    ]);
    socket.emit("whitepeak:wallet", { balance: Number(r.money) });
  }
  async function deliver(id) {
    const notices = await repo.notices(id);
    if (notices.length) io.to("account:" + id).emit("market:notices", notices);
  }
  for (const op of ["browse", "inventory", "publish", "buy", "cancel", "read"])
    account.on("market:" + op, async (data = {}, ack) => {
      const reply = typeof ack === "function" ? ack : () => {},
        p = getPlayer();
      if (Date.now() >= windowUntil) {
        windowUntil = Date.now() + 10000;
        count = 0;
      }
      if (++count > 50)
        return reply({
          success: false,
          message: "Patiente un instant entre deux actions.",
        });
      if (op === "read") {
        try {
          await repo.acknowledge(userId, data.ids);
          reply({ success: true });
        } catch (e) {
          reply({ success: false, message: e.message });
        }
        return;
      }
      if (
        busy ||
        !p ||
        p.inbattle ||
        p.inventoryBusy ||
        p.superTournamentActive ||
        !canUse() ||
        !clerks.nearby(p)
      )
        return reply({
          success: false,
          message: "Adresse-toi au commissaire de l’hôtel des ventes.",
        });
      busy = true;
      p.inventoryBusy = true;
      try {
        let result;
        if (op === "browse") result = await repo.browse(userId, data);
        else if (op === "inventory")
          result = { inventory: await repo.inventory(userId) };
        else if (op === "publish") result = await repo.publish(userId, data);
        else result = await repo[op](userId, data.id);
        if (["publish", "buy", "cancel"].includes(op)) {
          await refreshSelf();
          if (op === "buy") {
            const notices = await repo.notices(result.sellerId);
            if (notices.length)
              io.to("account:" + result.sellerId).emit(
                "market:notices",
                notices
              );
            const [[seller]] = await dbPool.execute(
              "SELECT money FROM users WHERE id=?",
              [result.sellerId]
            );
            io.to("account:" + result.sellerId).emit("whitepeak:wallet", {
              balance: Number(seller.money),
            });
          }
        }
        if (["publish", "buy", "cancel"].includes(op) && !result.duplicate)
          io.emit("market:changed");
        reply({ success: true, ...result });
      } catch (e) {
        if (!e.statusCode) console.error("Hôtel des ventes :", e.message);
        reply({
          success: false,
          message: e.statusCode
            ? e.message
            : "Opération indisponible. Réessaie avec la même confirmation.",
        });
      } finally {
        busy = false;
        p.inventoryBusy = false;
      }
    });
  return {
    async initialize() {
      await socket.join("account:" + userId);
      await deliver(userId);
    },
    async interact() {
      const p = getPlayer();
      if (!p || !canInteract() || !clerks.nearby(p)) return false;
      if (Date.now() - lastOpen < 800) return true;
      lastOpen = Date.now();
      socket.emit("market:open", await repo.browse(userId));
      return true;
    },
  };
}
module.exports = { createHandlers };
