const archive=require('../../../data/game/patch_history.json');
const latest=require('../../../data/game/latest_patch.json');
function history({since=archive.since,patches=archive.patches,current=latest}={}){
 const versions=new Map();
 for(const patch of [...patches,current])if(patch&&typeof patch.version==='string'&&patch.date>=since&&!patch.internal){versions.delete(patch.version);versions.set(patch.version,patch);}
 return [...versions.values()].map((patch,index)=>({patch,index})).sort((a,b)=>b.patch.date.localeCompare(a.patch.date)||b.index-a.index).map(v=>v.patch);
}
module.exports={history};
