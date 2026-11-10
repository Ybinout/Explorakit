const test = require("node:test"),
  assert = require("node:assert/strict"),
  { randomUUID } = require("node:crypto");
test(
  "market SQL: escrow, races, exact payment, receipts, offline notices and corruption access",
  { skip: process.env.RUN_MYSQL_TESTS !== "1" },
  async () => {
    assert.equal(process.env.DB_NAME, "explorakit_test");
    const {
        dbPool: db,
        withTransaction,
      } = require("../server/config/database"),
      users = require("../server/persistence/userRepository"),
      repo = require("../server/persistence/marketRepository"),
      pc = require("../server/persistence/pokemonStorageRepository"),
      teams = require("../server/persistence/teamRepository"),
      factory = require("../server/game/drift/pokemonFactory");
    const ids = [];
    try {
      for (let n = 0; n < 3; n++)
        ids.push(
          (
            await users.createUserWithStarter(
              "Market_" + randomUUID().slice(0, 8),
              randomUUID()
            )
          ).id
        );
      const [a, b, c] = ids;
      for (const id of ids)
        await db.execute("UPDATE users SET money=100000 WHERE id=?", [id]);
      await db.execute(
        "INSERT INTO user_items(user_id,item_key,quantity) VALUES(?,'pokeball',8) ON DUPLICATE KEY UPDATE quantity=8",
        [a]
      );
      const p = {
        requestId: randomUUID(),
        kind: "item",
        itemKey: "pokeball",
        quantity: 3,
        price: 5000,
      };
      assert.equal((await repo.publish(a, p)).duplicate, false);
      assert.equal((await repo.publish(a, p)).duplicate, true);
      await assert.rejects(
        repo.publish(a, { ...p, price: 6000 }),
        /confirmation/
      );
      const [[held]] = await db.execute(
        "SELECT quantity FROM user_items WHERE user_id=? AND item_key='pokeball'",
        [a]
      );
      assert.equal(held.quantity, 5);
      const race = await Promise.allSettled([
        repo.buy(b, p.requestId),
        repo.buy(c, p.requestId),
      ]);
      assert.equal(race.filter((r) => r.status === "fulfilled").length, 1);
      const buyer = race[0].status === "fulfilled" ? b : c;
      assert.equal((await repo.buy(buyer, p.requestId)).duplicate, true);
      const [wallets] = await db.execute(
          "SELECT id,money FROM users WHERE id IN (?,?,?) ORDER BY id",
          ids
        ),
        money = Object.fromEntries(wallets.map((r) => [r.id, Number(r.money)]));
      assert.equal(money[a], 105000);
      assert.equal(money[buyer], 95000);
      assert.equal(
        Object.values(money).reduce((a, b) => a + b),
        300000
      );
      const notices = await repo.notices(a);
      assert.equal(notices.length, 1);
      await repo.acknowledge(
        b,
        notices.map((n) => n.id)
      );
      assert.equal((await repo.notices(a)).length, 1);
      await repo.acknowledge(
        a,
        notices.map((n) => n.id)
      );
      assert.equal((await repo.notices(a)).length, 0);
      const cancel = { ...p, requestId: randomUUID(), quantity: 2 };
      await repo.publish(a, cancel);
      await assert.rejects(repo.cancel(b, cancel.requestId), /appartient/);
      await repo.cancel(a, cancel.requestId);
      assert.equal((await repo.cancel(a, cancel.requestId)).duplicate, true);
      const pokemon = factory.create(94, 66);
      pokemon.heldItem = "leftovers";
      await pc.storeCapturedPokemon(a, pokemon);
      const sale = {
        requestId: randomUUID(),
        kind: "pokemon",
        pokemonUuid: pokemon.uuid,
        price: 65000,
      };
      await assert.rejects(repo.publish(a, sale), /objet tenu/);
      assert(
        (await pc.loadEntries(a)).some((e) => e.pokemon.uuid === pokemon.uuid)
      );
      pokemon.heldItem = null;
      await db.execute(
        "UPDATE pokemon_storage SET pokemon_data=? WHERE user_id=? AND uuid=?",
        [pc.encodePokemon(pokemon), a, pokemon.uuid]
      );
      const encoded = pc.encodePokemon(pokemon);
      await repo.publish(a, sale);
      assert(
        !(await pc.loadEntries(a)).some((e) => e.pokemon.uuid === pokemon.uuid)
      );
      await repo.buy(c, sale.requestId);
      const got = (await pc.loadEntries(c)).find(
        (e) => e.pokemon.uuid === pokemon.uuid
      );
      assert(got);
      assert.equal(pc.encodePokemon(got.pokemon), encoded);
      const ordinary = await repo.browse(a, {
        category: "pokemon",
        k: 4,
        minLevel: 50,
      });
      assert(Array.isArray(ordinary.listings));
      await db.execute(
        "INSERT INTO user_items(user_id,item_key,quantity) VALUES(?,'cmod_offense_normal',2)",
        [a]
      );
      const corrupted = {
        requestId: randomUUID(),
        kind: "item",
        itemKey: "cmod_offense_normal",
        quantity: 1,
        price: 4000,
      };
      await assert.rejects(repo.publish(a, corrupted), /Carte/);
      await db.execute(
        "INSERT INTO user_items(user_id,item_key,quantity) VALUES(?,'professional_trainer_card',1)",
        [a]
      );
      await repo.publish(a, corrupted);
      assert(
        !(await repo.browse(b)).listings.some(
          (l) => l.id === corrupted.requestId
        )
      );
      await assert.rejects(
        repo.browse(b, { category: "corruption" }),
        /inaccessible/
      );
      await assert.rejects(repo.buy(b, corrupted.requestId), /Carte/);
      await db.execute(
        "INSERT INTO user_items(user_id,item_key,quantity) VALUES(?,'professional_trainer_card',1)",
        [b]
      );
      await repo.buy(b, corrupted.requestId);
      const mutant = factory.create(94, 77);
      mutant.corruption = {
        version: 1,
        revision: 1,
        permanent: true,
        modules: { combat: { itemKey: "cmod_offense_normal" } },
      };
      mutant.heldItem = null;
      await pc.storeCapturedPokemon(a, mutant);
      const mutationSale = {
        requestId: randomUUID(),
        kind: "pokemon",
        pokemonUuid: mutant.uuid,
        price: 1000,
      };
      await repo.publish(a, mutationSale);
      assert.equal(
        (await repo.browse(b, { category: "corrupted_pokemon" })).listings[0]
          .pokemon.corruption.modules.combat.itemKey,
        "cmod_offense_normal"
      );
      await repo.buy(b, mutationSale.requestId);
      assert.deepEqual(
        (await pc.loadEntries(b)).find((e) => e.pokemon.uuid === mutant.uuid)
          .pokemon.corruption,
        mutant.corruption
      );
      const expensive = {
        requestId: randomUUID(),
        kind: "item",
        itemKey: "pokeball",
        quantity: 1,
        price: 999999,
      };
      await repo.publish(a, expensive);
      const [[balanceBefore]] = await db.execute(
        "SELECT money FROM users WHERE id=?",
        [c]
      );
      await assert.rejects(repo.buy(c, expensive.requestId), /assez/);
      const [[balanceAfter]] = await db.execute(
        "SELECT money FROM users WHERE id=?",
        [c]
      );
      assert.equal(balanceAfter.money, balanceBefore.money);
      assert.equal(
        (await repo.browse(a, { mine: true })).listings.find(
          (l) => l.id === expensive.requestId
        ).status,
        "open"
      );
      const team = (await teams.loadEquipe(a)).pokemons;
      assert.equal(team.length, 1);
      await assert.rejects(
        repo.publish(a, {
          requestId: randomUUID(),
          kind: "pokemon",
          pokemonUuid: team[0].uuid,
          price: 1,
        }),
        /au moins un/
      );
      await assert.rejects(
        repo.publish(a, {
          requestId: randomUUID(),
          kind: "item",
          itemKey: "fly_module",
          quantity: 1,
          price: 1,
        }),
        /personnel/
      );
      // A failed destination never charges either wallet or consumes the escrow.
      const noStock = { ...p, requestId: randomUUID(), quantity: 9999 };
      await assert.rejects(repo.publish(a, noStock), /assez/);
      const [[missing]] = await db.execute(
        "SELECT COUNT(*) n FROM player_market_listings WHERE id=?",
        [noStock.requestId]
      );
      assert.equal(Number(missing.n), 0);
      const shard = require("../server/persistence/darkAerialRepository"),
        mod = require("../server/game/items/darkAerialModule");
      for (const key of mod.fragments.slice(0, 8))
        await db.execute(
          "INSERT INTO user_items(user_id,item_key,quantity) VALUES(?,?,1)",
          [a, key]
        );
      const award = await withTransaction((c) =>
        shard.award(a, "DC2_44", () => 0, c)
      );
      assert.equal(award.length, 2);
      assert.equal(award[0].key, mod.fragments[8]);
      assert.equal(award[1].key, mod.KEY);
      const st = await shard.state(a);
      assert.equal(st.owned, true);
      assert.deepEqual(st.fragments, Array(9).fill(0));
      assert.equal(st.active, false);
      await shard.setActive(a, true);
      assert.equal((await shard.state(a)).active, true);
      assert.equal(
        (await withTransaction((c) => shard.award(a, "jungle1", () => 0, c)))
          .length,
        0
      );
      // Unit price must remain ascending for identical items, independently of
      // publication order, lot size, the old client's preference and pagination.
      await db.execute("UPDATE user_items SET quantity=100 WHERE user_id=? AND item_key='pokeball'",[a]);
      for (const [quantity,price] of [[25,5000],[1,500],[2,2000],...Array.from({length:27},(_,i)=>[1,1500-i*10])]) {
        await repo.publish(a,{requestId:randomUUID(),kind:'item',itemKey:'pokeball',quantity,price});
      }
      for (const sort of [undefined,'new','price_desc']) {
        const all=[];
        for(let page=0;;page++) {
          const result=await repo.browse(a,{mine:true,category:'balls',sort,page});
          all.push(...result.listings.filter(l=>l.status==='open'&&l.itemKey==='pokeball'));
          if(!result.hasMore)break;
        }
        assert(all.length>24,'Must cross an actual server page boundary');
        assert.equal(all[0].price,5000,'Large lot is cheaper per unit');
        assert.equal(all[0].quantity,25);
        for(let i=1;i<all.length;i++)assert(
          BigInt(all[i-1].price)*BigInt(all[i].quantity)<=BigInt(all[i].price)*BigInt(all[i-1].quantity)
        );
      }
    } finally {
      for (const id of ids) {
        await db.execute("DELETE FROM player_market_notices WHERE user_id=?", [
          id,
        ]);
      }
      for (const id of ids) {
        await db.execute(
          "DELETE FROM player_market_listings WHERE seller_id=? OR buyer_id=?",
          [id, id]
        );
      }
      for (const id of ids)
        await db.execute("DELETE FROM users WHERE id=?", [id]);
      await db.end();
    }
  }
);
