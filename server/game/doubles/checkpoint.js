const {Battle}=require('@pkmn/sim');
// @pkmn/sim 0.10.15 assumes transformed moveSlots is at least as long as
// baseMoveSlots during restoration. Imposter/Transform can legitimately copy
// a target with fewer moves. Pad only the deserialization input, then remove
// the placeholders; original PP, virtual slots and base identities stay intact.
function restore(state){
 const snapshot=typeof state==='string'?JSON.parse(state):structuredClone(state),padded=[];
 for(const [sideIndex,side]of snapshot.sides.entries())for(const [index,p]of side.pokemon.entries()){
  if(p.baseMoveSlots?.length>p.moveSlots?.length){
   padded.push({sideIndex,index,length:p.moveSlots.length});
   while(p.moveSlots.length<p.baseMoveSlots.length)p.moveSlots.push({move:'',id:'',pp:0,maxpp:0,target:'normal',disabled:true,used:false,virtual:true});
  }
 }
 const sim=Battle.fromJSON(snapshot);
 for(const p of padded)sim.sides[p.sideIndex].pokemon[p.index].moveSlots.length=p.length;
 return sim;
}
module.exports={restore};
