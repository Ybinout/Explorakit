const { createHash } = require('node:crypto'),
    { dbPool, withTransaction } = require('../config/database'),
    rules = require('../game/housing/rules'),
    entries = require('../game/housing/entries');
const parse = (v) => (typeof v === 'string' ? JSON.parse(v) : v);
const empty = (id) => ({
    ownerId: id,
    ownerName: '',
    entryKey: null,
    floors: [],
    inventory: {},
    revision: 0,
});
function decode(r, id) {
    return r
        ? {
              ownerId: Number(r.user_id),
              ownerName: r.username,
              entryKey: r.entry_key,
              floors: parse(r.floors_json),
              inventory: parse(r.inventory_json),
              revision: Number(r.revision),
          }
        : empty(id);
}
async function read(id, c = dbPool, locked = false) {
    const [[r]] = await c.execute(
        'SELECT h.*,u.username FROM housing_profiles h JOIN users u ON u.id=h.user_id WHERE h.user_id=?' +
            (locked ? ' FOR UPDATE' : ''),
        [id]
    );
    const h = decode(r, id);
    h.crops = await require('./berryGardenRepository').crops(id,c);
    return h;
}
async function wallet(id, c = dbPool) {
    const [[r]] = await c.execute('SELECT money FROM users WHERE id=?', [id]);
    return Number(r?.money || 0);
}
async function mutation(id, kind, payload, work) {
    if (!rules.UUID.test(payload?.requestId || ''))
        throw Error('Actualise cette confirmation avant de continuer.');
    const digest = createHash('sha256')
        .update(JSON.stringify({ kind, payload }))
        .digest('hex');
    return withTransaction(async (c) => {
        const [[u]] = await c.execute(
            'SELECT id,money FROM users WHERE id=? FOR UPDATE',
            [id]
        );
        if (!u) throw Error('Dresseur introuvable.');
        require('../game/social/tradeLocks').assertUnlocked(id);
        const [[old]] = await c.execute(
            'SELECT user_id,request_hash,result_json FROM housing_receipts WHERE request_id=? FOR UPDATE',
            [payload.requestId]
        );
        if (old) {
            if (Number(old.user_id) !== id || old.request_hash !== digest)
                throw Error('Cette confirmation a déjà été utilisée.');
            return {
                home: await read(id, c),
                money: Number(u.money),
                receipt: parse(old.result_json),
                duplicate: true,
            };
        }
        await c.execute(
            "INSERT IGNORE INTO housing_profiles(user_id,floors_json,inventory_json) VALUES(?,'[]','{}')",
            [id]
        );
        const h = await read(id, c, true);
        if (
            !Number.isSafeInteger(payload.revision) ||
            payload.revision !== h.revision
        )
            throw Error('La maison a changé. Recharge son aménagement.');
        const receipt = await work(h, c, u);
        h.revision++;
        const [written] = await c.execute(
            'UPDATE housing_profiles SET entry_key=?,floors_json=?,inventory_json=?,revision=? WHERE user_id=? AND revision=?',
            [
                h.entryKey,
                JSON.stringify(h.floors),
                JSON.stringify(h.inventory),
                h.revision,
                id,
                payload.revision,
            ]
        );
        if (written.affectedRows !== 1)
            throw Error('La maison a changé. Recharge son aménagement.');
        const result = { kind, revision: h.revision, ...receipt };
        await c.execute(
            'INSERT INTO housing_receipts(request_id,user_id,request_hash,result_json) VALUES(?,?,?,?)',
            [payload.requestId, id, digest, JSON.stringify(result)]
        );
        return { home: h, money: await wallet(id, c), receipt: result };
    });
}
async function pay(c, id, price) {
    const [r] = await c.execute(
        'UPDATE users SET money=money-? WHERE id=? AND money>=?',
        [price, id, price]
    );
    if (r.affectedRows !== 1) throw Error('Tu n’as pas assez de Pokédollars.');
}
function purchase(id, p) {
    return mutation(id, 'purchase', p, async (h, c) => {
        const e = entries.get(p.entryKey),
            m = rules.model(p.model);
        if (h.entryKey || h.floors.length)
            throw Error('Tu possèdes déjà une maison.');
        await pay(c, id, m.price);
        h.entryKey = e.key;
        h.floors = [
            {
                model: m.key,
                purchasePrice: m.price,
                placements: [],
                stairs: { up: null, down: null },
            },
        ];
        return { cost: m.price };
    });
}
function furniture(id, p) {
    return mutation(id, 'furniture', p, async (h, c) => {
        const item = rules.items.get(p.key);
        if (
            !item ||
            !Number.isInteger(p.quantity) ||
            p.quantity < 1 ||
            p.quantity > 99
        )
            throw Error('Choisis un meuble et une quantité valide.');
        if ((h.inventory[item.key] || 0) + p.quantity > 99)
            throw Error('Tu peux posséder 99 exemplaires de chaque meuble.');
        const price = item.price * p.quantity;
        await pay(c, id, price);
        h.inventory[item.key] = (h.inventory[item.key] || 0) + p.quantity;
        return { key: item.key, quantity: p.quantity, cost: price };
    });
}
function saveFloor(id, p) {
    return mutation(id, 'layout', p, async (h, c) => {
        const f = rules.validateFloor(h, p.floor, p.layout);
        const removed = h.floors[p.floor].placements.filter(x=>!f.placements.some(y=>y.id===x.id&&y.key===x.key));
        if(removed.some(x=>(h.crops||[]).some(crop=>crop.furnitureId===x.id)))throw Error('Récolte tes baies avant de ranger leur pot.');
        const [visitors] = await c.execute(
            'SELECT user_id FROM housing_visits WHERE owner_id=? AND floor_index=? AND inside_house=1 FOR UPDATE',
            [id, p.floor]
        );
        h.floors[p.floor] = f;
        return { floor: p.floor, visitors: visitors.map((v) => v.user_id) };
    });
}
function addFloor(id, p) {
    return mutation(id, 'floor', p, async (h, c) => {
        if (!h.entryKey || h.floors.length >= rules.config.maxFloors)
            throw Error('Trois niveaux maximum par maison.');
        const m = rules.model(p.model),
            index = h.floors.length,
            previous = structuredClone(h.floors[index - 1]);
        previous.stairs.up = p.stair || rules.defaultStair(previous);
        const next = {
            model: m.key,
            purchasePrice: m.price,
            placements: [],
            stairs: { up: null, down: null },
        };
        next.stairs.down = rules.defaultStair(next);
        const candidate = {
            ...h,
            floors: [...h.floors.slice(0, -1), previous, next],
        };
        rules.validateFloor(candidate, index - 1, previous);
        rules.validateFloor(candidate, index, next);
        await pay(c, id, m.price);
        h.floors = candidate.floors;
        return { floor: index, cost: m.price };
    });
}
const saleQuote = rules.saleQuote;

function sell(id, p) {
    return mutation(id, 'sale', p, async (h, c, user) => {
        const v = await visit(id, c);
        if (!h.entryKey || !v?.inside || v.ownerId !== id)
            throw Error('Entre dans ta maison pour la revendre.');
        if(h.crops?.length)throw Error('Récolte tes cultures avant de revendre la maison.');
        const refund = saleQuote(h);
        if (p.refund !== refund)
            throw Error('Le prix a changé. Rouvre la confirmation.');
        if (!Number.isSafeInteger(Number(user.money) + refund))
            throw Error('Ton portefeuille ne peut pas recevoir ce montant.');
        const entryKey = h.entryKey,
            destination = entries.outside(entries.get(entryKey));
        const [visitors] = await c.execute(
            'SELECT user_id,return_map,return_x,return_y FROM housing_visits WHERE owner_id=? AND inside_house=1 FOR UPDATE',
            [id]
        );
        const departures = visitors.map((v) => ({
            userId: Number(v.user_id),
            destination:
                Number(v.user_id) === id
                    ? destination
                    : {
                          map: v.return_map,
                          x: Number(v.return_x),
                          y: Number(v.return_y),
                      },
        }));
        for (const v of departures)
            await c.execute('UPDATE users SET map=?,x=?,y=? WHERE id=?', [
                v.destination.map,
                v.destination.x,
                v.destination.y,
                v.userId,
            ]);
        await c.execute(
            'UPDATE housing_visits SET inside_house=0 WHERE owner_id=? AND inside_house=1',
            [id]
        );
        await c.execute('UPDATE users SET money=money+? WHERE id=?', [
            refund,
            id,
        ]);
        // inventory is the TOTAL owned stock, including placed furniture. Never add it twice.
        h.entryKey = null;
        h.floors = [];
        return { refund, entryKey, departures };
    });
}
async function enter(id, ownerId, floor, returnPoint) {
    return withTransaction(async (c) => {
        for (const userId of [...new Set([id, ownerId])].sort((a, b) => a - b))
            await c.execute('SELECT id FROM users WHERE id=? FOR UPDATE', [
                userId,
            ]);
        require('../game/social/tradeLocks').assertUnlocked(id);
        if (
            id !== ownerId &&
            (await require('./trainerRepository').relationship(
                id,
                ownerId,
                c
            )) !== 'friends'
        )
            throw Error('Cette invitation est réservée à un ami.');
        const h = await read(ownerId, c, true);
        if (!h.entryKey || !Number.isInteger(floor) || !h.floors[floor])
            throw Error('Cette maison n’est pas disponible.');
        const map = 'housing_' + h.floors[floor].model,
            position = rules.arrival(rules.model(h.floors[floor].model));
        await c.execute(
            'INSERT INTO housing_visits(user_id,owner_id,floor_index,inside_house,return_map,return_x,return_y) VALUES(?,?,?,1,?,?,?) ON DUPLICATE KEY UPDATE owner_id=VALUES(owner_id),floor_index=VALUES(floor_index),inside_house=1,return_map=VALUES(return_map),return_x=VALUES(return_x),return_y=VALUES(return_y)',
            [id, ownerId, floor, returnPoint.map, returnPoint.x, returnPoint.y]
        );
        await c.execute('UPDATE users SET map=?,x=?,y=? WHERE id=?', [
            map,
            position.x,
            position.y,
            id,
        ]);
        return {
            home: h,
            visit: { ownerId, floor, returnPoint },
            position: { map, ...position },
        };
    });
}
async function floor(id, index, position) {
    return withTransaction(async (c) => {
        await c.execute('SELECT id FROM users WHERE id=? FOR UPDATE', [id]);
        const [[v]] = await c.execute(
            'SELECT owner_id,return_map,return_x,return_y FROM housing_visits WHERE user_id=? AND inside_house=1 FOR UPDATE',
            [id]
        );
        if (!v) throw Error('Tu n’es plus dans cette maison.');
        const h = await read(v.owner_id, c);
        if (!h.floors[index]) throw Error('Étage introuvable.');
        const map = 'housing_' + h.floors[index].model;
        await c.execute(
            'UPDATE housing_visits SET floor_index=? WHERE user_id=?',
            [index, id]
        );
        await c.execute('UPDATE users SET map=?,x=?,y=? WHERE id=?', [
            map,
            position.x,
            position.y,
            id,
        ]);
        return {
            home: h,
            visit: {
                ownerId: Number(v.owner_id),
                floor: index,
                returnPoint: {
                    map: v.return_map,
                    x: v.return_x,
                    y: v.return_y,
                },
            },
            position: { map, ...position },
        };
    });
}
async function visit(id, c = dbPool) {
    const [[v]] = await c.execute(
        'SELECT * FROM housing_visits WHERE user_id=?',
        [id]
    );
    return v
        ? {
              ownerId: Number(v.owner_id),
              floor: Number(v.floor_index),
              inside: !!v.inside_house,
              returnPoint: {
                  map: v.return_map,
                  x: Number(v.return_x),
                  y: Number(v.return_y),
              },
          }
        : null;
}
async function leave(id, destination = null) {
    return withTransaction(async (c) => {
        await c.execute('SELECT id FROM users WHERE id=? FOR UPDATE', [id]);
        const v = await visit(id, c);
        if (!v) return destination;
        const d = destination || v.returnPoint;
        await c.execute(
            'UPDATE housing_visits SET inside_house=0 WHERE user_id=?',
            [id]
        );
        await c.execute('UPDATE users SET map=?,x=?,y=? WHERE id=?', [
            d.map,
            d.x,
            d.y,
            id,
        ]);
        return d;
    });
}
async function restore(id, saved, supported) {
    const v = await visit(id);
    if (v?.inside && supported) {
        const h = await read(v.ownerId);
        if (h.entryKey && h.floors[v.floor]) {
            const map = 'housing_' + h.floors[v.floor].model;
            return {
                home: h,
                visit: v,
                position:
                    saved?.map === map
                        ? { map, x: saved.x, y: saved.y }
                        : {
                              map,
                              ...rules.arrival(
                                  rules.model(h.floors[v.floor].model)
                              ),
                          },
            };
        }
    }
    if (v?.inside) {
        await leave(id);
        return { position: v.returnPoint };
    }
    if (rules.isMap(saved?.map))
        return { position: v?.returnPoint || { map: 'start', x: 80, y: 208 } };
    return null;
}
module.exports = {
    mutation,
    read,
    wallet,
    purchase,
    furniture,
    saveFloor,
    addFloor,
    sell,
    saleQuote,
    enter,
    floor,
    visit,
    leave,
    restore,
};
