const {onAccountEvent}=require('../accountConnection');
const lab=require('../../game/experienceExchange/laboratory');
const repository=require('../../persistence/experienceExchangeRepository');

function registerExperienceExchangeHandlers({socket,userId,getPlayer,getPeers,canUse,canInteract,store=repository}) {
    function authorize(interacting=false) {
        const p=getPlayer();
        if(!p || !lab.nearby(p) || p.inbattle || p.inventoryBusy || p.superTournamentActive || !(interacting?canInteract():canUse()))
            throw Error('Rejoins le scientifique et termine ton action avant cet échange.');
        return p;
    }
    async function run(action,payload,interacting=false) {
        authorize(interacting);
        const peers=getPeers();
        for(const p of peers)p.inventoryBusy=true;
        try {
            const result=await store[action](userId,payload);
            if(result.equipe) {
                for(const p of getPeers())p.equipe=result.equipe;
                socket.emit('teamStateChanged',{reason:'experience_exchange',equipe:result.equipe});
                socket.emit('experienceExchange:wallet',{balance:result.money});
            }
            return {success:true,...result};
        } finally {for(const p of peers)p.inventoryBusy=false;}
    }
    for(const [event,action] of [['open','open'],['preview','preview'],['confirm','exchange']]) {
        onAccountEvent(socket,'experienceExchange:'+event,async(payload,ack)=>{
            try {const result=await run(action,payload);if(typeof ack==='function')ack(result);}
            catch(error){
                if(error.code)console.error('Échange d’expérience non enregistré :',error.code);
                if(typeof ack==='function')ack({success:false,uncertain:!!error.code,message:error.code?'Sauvegarde indisponible. Réessaie la même confirmation pour vérifier son résultat.':error.message});
            }
        });
    }
    return {async interact(){
        if(!lab.nearby(getPlayer()))return false;
        try {socket.emit('experienceExchangePanel',await run('open',null,true));}
        catch(error){socket.emit('progressionNotice',{message:error.code?'Le laboratoire est momentanément indisponible.':error.message});}
        return true;
    }};
}
module.exports={registerExperienceExchangeHandlers};
