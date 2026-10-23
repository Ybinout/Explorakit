// Generate identity bindings only. No source sprite, map or dialogue text is edited.
const fs=require('node:fs'),path=require('node:path'),{createHash}=require('node:crypto');
const root=path.resolve(__dirname,'..'),pnjs=JSON.parse(fs.readFileSync(path.join(root,'data/game/pnjs.jsonc'),'utf8')).pnjs;
const interactions=require('../data/game/interact.json');
const actors={};
for(const actor of pnjs.filter(p=>p.sprite==='townspeople.png')){
    const queue=[actor.interactionName || actor.name],seen=new Set();
    for(const name of queue){if(seen.has(name))continue;seen.add(name);const entry=interactions.find(d=>d.name===name);if(!entry)continue;
        actors[name]={name:actor.name,spriteFrame:actor.spriteFrame};
        for(const key of ['after','locked'])if(entry[key])queue.push(entry[key]);
    }
}
const assets=['a','b'].map((suffix,i)=>{const imageName=`civilian-portraits-${suffix}.png`,bytes=fs.readFileSync(path.join(root,'vue-explorakit/src/assets/image',imageName));return {imageName,width:bytes.readUInt32BE(16),height:bytes.readUInt32BE(20),columns:6,rows:3,rowBounds:i?[0,326,602,887]:[0,296,591,887],sha256:createHash('sha256').update(bytes).digest('hex')};});
const data={source:'src/assets/6931.png',sourceSha256:require('../vue-explorakit/src/data/classicNpcFrames.json').sha256,generatedBy:'Built-in imagegen, 2026-10-23. Illustrated references from the actual 36 world sprite frames; champions excluded.',assets,actors};
const output=path.join(root,'vue-explorakit/src/data/npcDialoguePortraits.json'),text=JSON.stringify(data,null,2)+'\n';
if(process.argv.includes('--check')){if(fs.readFileSync(output,'utf8')!==text)throw Error('Dialogue portrait bindings are stale');}else fs.writeFileSync(output,text);
console.log(`${Object.keys(actors).length} dialogue identities, ${assets.length} illustrated atlases`);
