const {DarkBattleController}=require('../../game/battle/darkBattleController');
function createHandlers({socket,account,userId,getPlayer,onFinish}) {
    const fail=error=>{
        console.error('Sauvegarde combat Dark Continent :',error.message);
        socket.emit('progressionNotice',{type:'warning',message:'Le combat n’a pas pu être sauvegardé. Reconnecte-toi pour le reprendre.'});
        // Never unlock movement or allow a second encounter after an uncertain write.
        socket.disconnect();
    };
    const controller=new DarkBattleController({userId,getPlayer,emit:(e,d)=>socket.emit(e,d),onFinish});
    account.on('actionResponse',payload=>{
        if(controller.active)account.track(controller.execute(()=>controller.action(payload)).catch(fail));
    });
    let timer=null,ticking=false;
    async function tick(){if(ticking||!socket.connected||!controller.active)return;ticking=true;try{await controller.execute(()=>controller.tick());}catch(error){fail(error);}finally{ticking=false;}}
    account.onClose(async()=>{clearInterval(timer);await controller.stop();});
    return {
        controller,
        async initialize(saved){await controller.execute(()=>controller.load(saved));timer=setInterval(tick,250);timer.unref?.();},
        async start(enemy,environment){try{return await controller.execute(()=>controller.start(enemy,environment));}catch(error){fail(error);return false;}}
    };
}
module.exports={createHandlers};
