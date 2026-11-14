const test=require('node:test'),assert=require('node:assert/strict');
test('move announcements are recognized without treating status, rewards or prompts as attacks',async()=>{
 const {isMoveAnnouncement,moveAnnouncementDuration}=await import('../vue-explorakit/src/services/battleNarration.js');
 for(const text of['Staross utilise Hydro Pump !','Wanda: Métalosse utilise Bullet Punch !','Mr. Mime uses Psychic !']){assert(isMoveAnnouncement(text));assert(moveAnnouncementDuration(text)>=1400);}
 for(const text of[null,'Choisis une action.','Staross ne peut plus utiliser Hydro Pump.','Staross est paralysé !','Staross gagne 100 XP !'])assert(!isMoveAnnouncement(text));
 assert.equal(moveAnnouncementDuration('x'.repeat(1000)),2600);
});
