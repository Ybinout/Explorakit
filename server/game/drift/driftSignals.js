const catalogue=require('../../../data/game/drifts.json');
const definitions=new Map(catalogue.definitions.map(d=>[d.id,d]));
let current=null;
// Synchronous real actions only. Estimates/AI simulations outside this scope stay silent.
function capture(action){const previous=current;current=[];try{return {result:action(),effects:current};}finally{current=previous;}}
function signal(owner,number,detail=''){
    if(!current)return;
    const definition=definitions.get(`DRF-${String(number).padStart(3,'0')}`);if(!definition)return;
    if(current.some(e=>e.owner===owner&&e.definitionId===definition.id))return;
    current.push({owner,definitionId:definition.id,name:definition.name,detail});
}
module.exports={capture,signal};
