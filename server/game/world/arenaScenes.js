const scenes = require('../../../data/game/arena_scenes.json');
function entry(player, flags = {}) {
    const scene = scenes.find(s => s.map === player?.currentmap);
    return scene && Math.floor(player.y / 32) >= 14 && flags[scene.flag] !== 'true' ? scene : null;
}
module.exports = { scenes, entry };
