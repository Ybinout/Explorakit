// The saved encounter map is authoritative. Old jungle snapshots without a
// region keep their existing rules; a display colour never changes the policy.
function permanentDeaths(rift) {
    return !require('../world/safari').isMap(rift?.map);
}
module.exports = { permanentDeaths };
