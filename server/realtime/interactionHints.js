const servers=new WeakMap();
function getInteractionHints(io){
 if(servers.has(io))return servers.get(io);
 const entries=new Set();
 function attach(socket,read){let previous='';const update=()=>{if(!socket.connected)return;try{const state=read(),signature=JSON.stringify(state);if(signature!==previous){previous=signature;socket.emit('interactionHint',state);}}catch{const off=JSON.stringify({map:null,available:false});if(previous!==off){previous=off;socket.emit('interactionHint',{map:null,available:false});}}};const entry={update};entries.add(entry);const stop=()=>entries.delete(entry);socket.once('disconnect',stop);return{update,stop};}
 const timer=setInterval(()=>{for(const e of entries)e.update();},200);timer.unref?.();io.httpServer?.once('close',()=>{clearInterval(timer);entries.clear();});
 const api={attach};servers.set(io,api);return api;
}
module.exports={getInteractionHints};
