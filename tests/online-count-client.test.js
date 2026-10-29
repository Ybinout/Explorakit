const test=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events');
test('online badge accepts only valid counts, clears stale numbers on disconnect/reconnect and releases its listeners',async()=>{
 const mixin=(await import('../vue-explorakit/src/services/socialGame.js')).default,socket=new EventEmitter();socket.connected=true;
 const vm={...mixin.data(),socket,preferences:{language:'fr'}};
 mixin.methods.bindSocialSocket.call(vm);assert.equal(socket.listenerCount('presence:count'),1);
 socket.emit('presence:count',{count:3});assert.equal(vm.onlinePlayerCount,3);assert.match(mixin.computed.onlineCountLabel.call(vm),/3 dresseurs en ligne/);
 for(const count of[-1,1.5,'3',Infinity,NaN])socket.emit('presence:count',{count});assert.equal(vm.onlinePlayerCount,3);
 socket.connected=false;socket.emit('disconnect');assert.equal(vm.onlinePlayerCount,null);assert.match(mixin.computed.onlineCountLabel.call(vm),/connexion/);
 socket.connected=true;socket.emit('connect');assert.equal(vm.onlinePlayerCount,null);socket.emit('presence:count',{count:1});assert.match(mixin.computed.onlineCountLabel.call(vm),/1 dresseur en ligne/);
 mixin.methods.bindSocialSocket.call(vm);assert.equal(socket.listenerCount('presence:count'),1);mixin.beforeDestroy.call(vm);assert.equal(socket.listenerCount('presence:count'),0);assert.equal(socket.listenerCount('disconnect'),0);
});

test('directory presence revisions bind once, validate payloads and release the listener',async()=>{
 const {default:mixin}=await import('../vue-explorakit/src/services/socialGame.js');const {EventEmitter}=require('node:events');
 const socket=new EventEmitter();socket.connected=true;const vm={...mixin.data(),socket,preferences:{language:'fr'}};
 mixin.methods.bindSocialSocket.call(vm);socket.emit('social:presenceChanged',{revision:4});assert.equal(vm.socialPresenceRevision,4);
 for(const revision of [-1,'5',NaN,Infinity,1.5])socket.emit('social:presenceChanged',{revision});assert.equal(vm.socialPresenceRevision,4);
 mixin.methods.bindSocialSocket.call(vm);assert.equal(socket.listenerCount('social:presenceChanged'),1);mixin.beforeDestroy.call(vm);assert.equal(socket.listenerCount('social:presenceChanged'),0);
});
