// A live negotiation owns both inventories; tokens cannot release another trade.
const locks=new Map();
function locked(id){return locks.has(Number(id));}
function assertUnlocked(id,token=null){if(locked(id)&&locks.get(Number(id))!==token)throw Object.assign(Error(String(locks.get(Number(id))).startsWith('training:')?'Arrête les relances automatiques avant de modifier ton équipe ou ton sac.':String(locks.get(Number(id))).startsWith('draft:')?'Termine ou quitte ta draft avant de modifier ton équipe ou ton sac.':String(locks.get(Number(id))).startsWith('raid:')?'Termine ou quitte ton raid avant de modifier ton équipe ou ton sac.':'Termine ou annule ton échange avant de modifier ton équipe ou ton sac.'),{statusCode:409});}
function acquire(ids,token){for(const id of ids)if(locks.has(id)&&locks.get(id)!==token)throw Error('Un autre échange est déjà en cours.');for(const id of ids)locks.set(id,token);}
function release(ids,token){for(const id of ids)if(locks.get(id)===token)locks.delete(id);}
module.exports={locked,assertUnlocked,acquire,release};
