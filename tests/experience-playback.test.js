const test=require('node:test'),assert=require('node:assert/strict');
test('XP presentation fills crossed levels then shows the exact remainder, bounding huge gains',async()=>{
 const {experienceFrames}=await import('../vue-explorakit/src/services/experiencePlayback.js');
 const frames=experienceFrames({pokemon:{level:9,experience:600,experienceRate:1},previousLevel:6,previousExperience:200,xpGained:400});
 assert.deepEqual(frames.map(f=>[f.level,f.to]),[[6,100],[7,100],[8,100],[9,88/217*100]]);
 assert.equal(frames[0].from,75/91*100);
 const huge=experienceFrames({pokemon:{level:500,experience:499**3,experienceRate:1},previousLevel:1,previousExperience:0,xpGained:499**3});
 assert(huge.length<=6);assert.equal(huge.at(-1).level,500);
 assert.deepEqual(experienceFrames({xpGained:0}),[]);
});
test('aborted XP playback resolves without late frames or a hanging finish',async()=>{
 const {playExperienceGain}=await import('../vue-explorakit/src/services/experiencePlayback.js');
 const abort=new AbortController(),frames=[];
 const pending=playExperienceGain({pokemon:{level:6,experience:125},previousLevel:5,previousExperience:64,xpGained:61},f=>frames.push(f),abort.signal);
 assert.equal(frames.length,1);abort.abort();await pending;assert.equal(frames.length,1);
});
