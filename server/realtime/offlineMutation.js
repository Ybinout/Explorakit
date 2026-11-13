// Legacy HTTP team writes must not race an authoritative live party or its
// disconnect save. Register leases synchronously, before the first database await.
const accounts = new Map();
function state(id) {
    if (!accounts.has(id)) accounts.set(id, {sessions: 0, mutation: null});
    return accounts.get(id);
}
function prune(id, entry) {
    if (!entry.sessions && !entry.mutation && accounts.get(id) === entry) accounts.delete(id);
}
function beginSession(id) {
    const entry = state(id); entry.sessions++;
    const ready = entry.mutation || Promise.resolve(); let released = false;
    return {ready, release() {if (released) return; released = true; entry.sessions--; prune(id, entry);}};
}
async function withOfflineMutation(id, work) {
    const entry = state(id);
    if (entry.sessions || entry.mutation) {
        throw Object.assign(Error('Une session de jeu est active ou une sauvegarde est en cours. Utilise les commandes du jeu, puis réessaie.'), {statusCode: 409});
    }
    let release;
    entry.mutation = new Promise(resolve => {release = resolve;});
    try {return await work();}
    finally {entry.mutation = null; release(); prune(id, entry);}
}
module.exports = {beginSession, withOfflineMutation};
