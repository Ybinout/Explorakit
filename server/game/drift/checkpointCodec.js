const { gzipSync, gunzipSync } = require('node:zlib');
const { createHash } = require('node:crypto');
const Pokemon = require('../models/Pokemon');
const { DriftBattle } = require('./driftBattle');
const { BattleSummaryTracker } = require('../battle/battleOutcome');
const effects = require('./driftEffects');

// Trusted server state only. References preserve battle participants, Maps and
// shared one-use effect counters. No client-supplied state is ever decoded.
const omitted = new Set(['pnjs', 'pnjDeadlines', 'settling']);
function encode(root) {
    const nodes = [],
        ids = new Map();
    function ref(value) {
        if (value === undefined || typeof value === 'function') return { u: 1 };
        if (typeof value === 'number' && !Number.isFinite(value)) return { n: String(value) };
        if (value === null || typeof value !== 'object') return value;
        if (ids.has(value)) return { r: ids.get(value) };
        const id = nodes.length;
        ids.set(value, id);
        const type =
            value instanceof BattleSummaryTracker
                ? 'BattleSummaryTracker'
                : value instanceof Pokemon
                ? 'Pokemon'
                : value instanceof DriftBattle
                ? 'DriftBattle'
                : value instanceof Map
                ? 'Map'
                : value instanceof Set
                ? 'Set'
                : Array.isArray(value)
                ? 'Array'
                : 'Object';
        const node = { type };
        nodes.push(node);
        if (type === 'Map') node.values = [...value].map(([k, v]) => [ref(k), ref(v)]);
        else if (type === 'Set' || type === 'Array') node.values = [...value].map(ref);
        else {
            node.values = Object.entries(Object.getOwnPropertyDescriptors(value))
                .filter(([key, d]) => !omitted.has(key) && 'value' in d && typeof d.value !== 'function')
                .map(([key, d]) => [key, ref(d.value), d.enumerable]);
            if (type === 'Pokemon' && effects.states.has(value)) node.drift = ref(effects.states.get(value));
        }
        return { r: id };
    }
    const pointer = ref(root);
    const data = JSON.stringify({ version: 1, root: pointer, nodes });
    return gzipSync(JSON.stringify({ hash: createHash('sha256').update(data).digest('hex'), data }));
}
function decode(buffer) {
    const envelope = JSON.parse(gunzipSync(buffer, { maxOutputLength: 128 * 1024 * 1024 }).toString());
    if (createHash('sha256').update(envelope.data).digest('hex') !== envelope.hash)
        throw Error('Checkpoint RiftMon corrompu.');
    const data = JSON.parse(envelope.data);
    if (data.version !== 1 || !Array.isArray(data.nodes))
        throw Error('Version de checkpoint RiftMon inconnue.');
    const prototypes = {
        BattleSummaryTracker: BattleSummaryTracker.prototype,
        Pokemon: Pokemon.prototype,
        DriftBattle: DriftBattle.prototype,
        Object: Object.prototype,
    };
    const values = data.nodes.map((n) =>
        n.type === 'Map'
            ? new Map()
            : n.type === 'Set'
            ? new Set()
            : n.type === 'Array'
            ? []
            : Object.hasOwn(prototypes, n.type)
            ? Object.create(prototypes[n.type])
            : (() => {
                  throw Error('Type de checkpoint invalide.');
              })()
    );
    function val(v) {
        if (v && typeof v === 'object') {
            if (Object.hasOwn(v, 'r')) {
                if (!values[v.r]) throw Error('Référence de checkpoint invalide.');
                return values[v.r];
            }
            if (v.u) return undefined;
            if (v.n) return Number(v.n);
        }
        return v;
    }
    data.nodes.forEach((n, i) => {
        const target = values[i];
        if (n.type === 'Map') n.values.forEach(([k, v]) => target.set(val(k), val(v)));
        else if (n.type === 'Set') n.values.forEach((v) => target.add(val(v)));
        else if (n.type === 'Array') n.values.forEach((v) => target.push(val(v)));
        else
            n.values.forEach(([key, v, enumerable]) => {
                if (['__proto__', 'prototype', 'constructor'].includes(key))
                    throw Error('Clé de checkpoint interdite.');
                Object.defineProperty(target, key, {
                    value: val(v),
                    enumerable,
                    configurable: true,
                    writable: true,
                });
            });
    });
    data.nodes.forEach((n, i) => {
        if (n.drift) {
            const state = val(n.drift);
            state.random = Math.random;
            effects.states.set(values[i], state);
        }
    });
    return val(data.root);
}
module.exports = { encode, decode };
