const ITEM_KEY='experience_module',ACTIVE_FLAG='experience_module_active',RECEIPT_FLAG='experience_module_received',LEVEL_BONUS=10;
function view(owned,enabled){const active=Boolean(owned)&&enabled==='true';return {owned:Boolean(owned),active,levelBonus:active?LEVEL_BONUS:0};}
function encounterLevel(level,active=false){return active===true?level+LEVEL_BONUS:level;}
// Later progress snapshots may predate a completed switch RPC. Only prime the cache once.
function initializePlayer(player,state){if(player&&typeof player.experienceModuleActive!=='boolean')player.experienceModuleActive=state?.active===true;}
module.exports={ITEM_KEY,ACTIVE_FLAG,RECEIPT_FLAG,LEVEL_BONUS,view,encounterLevel,initializePlayer};
