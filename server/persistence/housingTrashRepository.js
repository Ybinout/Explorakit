const housing=require('./housingRepository');
const rules=require('../game/housing/rules');
const trash=require('../game/housing/trash');
async function panel(id,home,payload) {
    const items=(await require('./itemRepository').loadUserItems(id)).filter(trash.disposable);
    return {kind:'trash',home,floor:payload.floor,furnitureId:payload.furnitureId,items};
}
async function discard(id,payload) {
    const items=trash.selection(payload);
    return housing.mutation(id,'trash-discard',payload,async(home,c)=>{
        if(!home.floors[payload.floor]?.placements.some(p=>p.id===payload.furnitureId&&rules.items.get(p.key)?.device==='trash'))
            throw Error('Cette poubelle n’est plus installée.');
        for(const {key,quantity} of items){
            const [r]=await c.execute('UPDATE user_items SET quantity=quantity-? WHERE user_id=? AND item_key=? AND quantity>=?',[quantity,id,key,quantity]);
            if(r.affectedRows!==1)throw Error('Le stock a changé. Vérifie les quantités. Aucun objet supprimé.');
        }
        return {discarded:items};
    });
}
module.exports={panel,discard};
