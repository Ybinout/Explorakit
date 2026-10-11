const { dbPool } = require('../config/database');
const { normalizeCenterReturnPoint } = require('../game/world/pokemonCenterTravel');

const DEFAULT_SPRITE = 'sprite.png';

function sanitizeSpriteName(spriteName) {
    if (typeof spriteName !== 'string') {
        return DEFAULT_SPRITE;
    }

    const normalized = spriteName.trim().toLowerCase();
    if (!/^sprite\d*\.png$/.test(normalized)) {
        return DEFAULT_SPRITE;
    }

    return normalized;
}

async function loadUserPosition(userId) {
    let rows;
    try {
        [rows] = await dbPool.execute(
            `SELECT x, y, map, sprite,
                    respawn_x, respawn_y, respawn_map,
                    center_return_x, center_return_y, center_return_map
             FROM users WHERE id = ? LIMIT 1`,
            [userId]
        );
    } catch (error) {
        if (error && error.code === 'ER_BAD_FIELD_ERROR') {
            [rows] = await dbPool.execute(
                'SELECT x, y, map FROM users WHERE id = ? LIMIT 1',
                [userId]
            );
        } else {
            throw error;
        }
    }

    if (!rows.length) {
        return null;
    }

    const row = rows[0];
    const hasRespawnPoint = typeof row.respawn_map === 'string'
        && row.respawn_map.trim()
        && Number.isFinite(Number(row.respawn_x))
        && Number.isFinite(Number(row.respawn_y));

    return {
        ...row,
        sprite: sanitizeSpriteName(row.sprite),
        centerReturnPoint: normalizeCenterReturnPoint({ map: row.center_return_map, x: row.center_return_x, y: row.center_return_y }),
        respawnPoint: hasRespawnPoint
            ? { map: row.respawn_map, x: Number(row.respawn_x), y: Number(row.respawn_y) }
            : null
    };
}

async function saveUserPosition(userId, { x, y, map, centerReturnPoint }) {
    const point = normalizeCenterReturnPoint(centerReturnPoint);
    await dbPool.execute(
        `UPDATE users
         SET x = ?, y = ?, map = ?, center_return_x = ?, center_return_y = ?, center_return_map = ?
         WHERE id = ?
         AND NOT (
             x <=> ? AND y <=> ? AND map <=> ?
             AND center_return_x <=> ? AND center_return_y <=> ? AND center_return_map <=> ?
         )`,
        [x, y, map, point?.x ?? null, point?.y ?? null, point?.map ?? null,
            userId, x, y, map, point?.x ?? null, point?.y ?? null, point?.map ?? null]
    );
}

async function saveUserSprite(userId, spriteName) {
    const safeSprite = sanitizeSpriteName(spriteName);

    try {
        await dbPool.execute(
            `UPDATE users
             SET sprite = ?
             WHERE id = ?
             AND (
                 sprite IS NULL OR sprite <> ?
             )`,
            [safeSprite, userId, safeSprite]
        );
    } catch (error) {
        if (error && error.code === 'ER_BAD_FIELD_ERROR') {
            return safeSprite;
        }
        throw error;
    }

    return safeSprite;
}

async function saveUserRespawnPoint(userId, { x, y, map }) {
    await dbPool.execute(
        `UPDATE users
         SET respawn_x = ?, respawn_y = ?, respawn_map = ?
         WHERE id = ?`,
        [x, y, map, userId]
    );
}

module.exports = {
    loadUserPosition,
    saveUserPosition,
    saveUserRespawnPoint,
    saveUserSprite,
    sanitizeSpriteName
};
