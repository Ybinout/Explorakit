const {randomUUID}=require('node:crypto');
const scene=require('../../game/world/mirrorRift'),repository=require('../../persistence/mirrorRiftRepository');
const {loadProgressState}=require('../../persistence/progressionRepository');
const {healTeam}=require('../../game/world/playerRecovery');
const {editEquipe}=require('../../persistence/teamRepository');
const sleep=ms=>new Promise(r=>setTimeout(r,process.env.NODE_ENV==='test'?ms*Math.max(0,Number(process.env.MIRROR_SCENE_SCALE??1)):ms));
function createMirrorRiftHandlers({socket,io,userId,getPlayer,canUse,setBusy,emitProgression,travel,blackout}){
    let busy=false;
    const live=p=>socket.connected&&getPlayer()===p;
    const refresh=async()=>{const p=await loadProgressState(userId);emitProgression(p);return p;};
    const cinematic=(phase,duration)=>socket.emit('mirrorRiftScene',{id:randomUUID(),map:scene.config.map,phase,duration});
    async function interact(){
        const player=getPlayer();if(busy||!player||player.inbattle||player.inventoryBusy||!canUse())return false;
        const r=await repository.read(userId),action=scene.interaction(player,r.progress);if(!live(player)||!action)return false;
        busy=true;player.inventoryBusy=true;player.isMoving=false;setBusy(true);let awaitingWake=false;
        try{
            if(action!=='battle'){
                if(!await repository.advance(userId,action,player))return true;
                const duration=action==='open'?scene.config.openingMs:scene.config.emergingMs;
                if(live(player))cinematic(action==='open'?'opening':'emerging',duration);
                await refresh();if(!live(player))return true;await sleep(duration);
                if(live(player))socket.emit('mirrorRiftScene',{active:false});return true;
            }
            const enemy=require('../../game/battle/mirrorTeam').mirrorTeam(player.equipe);
            player.inventoryBusy=false;player.inbattle=true;
            socket.emit('battletrigger',{battleType:'trainer',musicKind:'lucie',environment:'lucie-house',trainerKey:'mirror_self',mirror:true});
            try{await require('../../game/battle/trainerBattle')(player,enemy,io,userId,{
                grantBaseMoney:false,grantExperience:false,recordPokedex:false,onVictory:()=>repository.win(userId)
            });}finally{player.inbattle=false;}
            const progress=await refresh();
            if(scene.state(progress).stage==='won'){player.inventoryBusy=true;awaitingWake=true;}
            else if(live(player))await blackout();
            return true;
        }finally{
            player.inventoryBusy=live(player)&&awaitingWake;
            setBusy(false);busy=false;
        }
    }
    async function awaken(){
        const player=getPlayer();if(busy||!player||player.inbattle||!canUse())return false;
        const r=await repository.read(userId);if(r.state.stage!=='won')return false;
        busy=true;player.inventoryBusy=true;player.isMoving=false;setBusy(true);
        try{
            cinematic('closing',scene.config.closingMs);await sleep(scene.config.closingMs);
            if(!live(player))return false;
            healTeam(player.equipe);await editEquipe(userId,player.equipe);
            await travel(scene.config.wake);await repository.completeWake(userId);await refresh();
            if(live(player)){socket.emit('teamStateChanged',{reason:'mirror_awakened',equipe:player.equipe});socket.emit('mirrorRiftScene',{id:randomUUID(),map:scene.config.wake.map,phase:'awakening',duration:scene.config.awakeningMs});}
            return true;
        }finally{player.inventoryBusy=false;busy=false;setBusy(false);}
    }
    return {interact,awaken};
}
module.exports={createMirrorRiftHandlers};
