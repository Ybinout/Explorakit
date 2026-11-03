// Persistent bounded-size maps: legacy arrays still mean one copy per listed key.
const LIMIT=Number.MAX_SAFE_INTEGER;
function count(owner,key,listField,countField){
 if(owner?.currentmap!=='super_tournament_room'||!owner[listField]?.includes(key))return 0;
 const n=owner[countField]?.[key];return Number.isSafeInteger(n)&&n>0?n:1;
}
function add(owner,key,listField,countField){
 const next=count(owner,key,listField,countField)+1;if(!Number.isSafeInteger(next))throw Error('Ce bonus a atteint sa limite.');
 owner[listField]=[...new Set([...(owner[listField]||[]),key])];owner[countField]={...(owner[countField]||{}),[key]:next};return next;
}
// Numeric guard only for fantastically long attempts; ordinary products stay exact.
function factor(base,n){return Math.max(1e-6,Math.min(1e6,Math.pow(base,n)));}
function percent(base,n){return `${Math.round(Math.abs(factor(base,n)-1)*10000)/100} %`;}
module.exports={count,add,factor,percent,LIMIT};
