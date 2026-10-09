const path = require('node:path');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');

module.exports = Object.freeze({
    PROJECT_ROOT,
    DIST_DIR: path.join(PROJECT_ROOT, 'dist'),
    GAME_DATA_DIR: path.join(PROJECT_ROOT, 'data', 'game'),
    MAPS_DIR: path.join(PROJECT_ROOT, 'data', 'maps')
});
