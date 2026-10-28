// A live negotiation owns both inventories; tokens cannot release another trade.
const locks=new Map();
function locked(id){return locks.has(Number(id));}
function assertUnlocked(id){if(locked(id))throw Object.assign(Error('Termine ou annule ton échange avant de modifier ton équipe ou ton sac.'),{statusCode:409});}
function acquire(ids,token){for(const id of ids)if(locks.has(id)&&locks.get(id)!==token)throw Error('Un autre échange est déjà en cours.');for(const id of ids)locks.set(id,token);}
function release(ids,token){for(const id of ids)if(locks.get(id)===token)locks.delete(id);}
module.exports={locked,assertUnlocked,acquire,release};
