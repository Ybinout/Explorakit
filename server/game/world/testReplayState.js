// Derived from the SQL account identity by loadProgressState; never accepted from clients.
function active(progress, name) { return progress?.testReplays?.includes(name) === true; }
function obstacleFlag(obstacle) { return `admin_room_obstacle:${obstacle.id}`; }
module.exports = { active, obstacleFlag };
