const config = require('./content').config;
// Absolute deadlines remain authoritative. Upgrade legacy snapshots only once;
// reconnecting must never restart a pick or grant another preparation window.
function upgrade(run) {
    if ((run.timingVersion || 1) >= config.timingVersion) return false;
    const previous = { draft: 30000, preparation: 300000 };
    const current = { draft: config.pickMs, preparation: config.preparationMs };
    if (previous[run.phase] && Number.isFinite(run.deadline))
        run.deadline += current[run.phase] - previous[run.phase];
    run.timingVersion = config.timingVersion;
    return true;
}
function view() {
    return { pickMs: config.pickMs, preparationMs: config.preparationMs };
}
module.exports = { upgrade, view };
