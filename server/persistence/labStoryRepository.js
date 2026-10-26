const {withTransaction}=require('../config/database');
const story=require('../game/world/labStory'),policy=require('../game/world/arenaTests');
const {meetsRequirements}=require('../game/world/storyProgression');
const events=require('../../data/game/progression.json').storyEvents;
const replayEvents=new Set(['wanda_professor','professor_lab_door','professor_lab_rock','lucie_lab_rescue']);
async function noteExit(userId) {
 return withTransaction(async c=>{
  const [[owner]]=await c.execute('SELECT id,username FROM users WHERE id=? FOR UPDATE',[userId]);
  if(!owner)return false;
  const [rows]=await c.execute('SELECT flag_key,flag_value FROM player_story_flags WHERE user_id=?',[userId]),flags=Object.fromEntries(rows.map(r=>[r.flag_key,r.flag_value]));
  const replay=policy.isOwner(owner)&&story.fullReplay({flags});
  if(flags[replay?'admin_lucie_departure':'lucie_departure']!=='seen')return false;
  const key=replay?'admin_lucie_house_exited':'lucie_house_exited';
  if(flags[key]==='true')return false;
  await c.execute("INSERT INTO player_story_flags(user_id,flag_key,flag_value) VALUES(?,?,'true') ON DUPLICATE KEY UPDATE flag_value='true'",[userId,key]);return true;
 });
}
async function completeReplay(userId,name) {
 if(!replayEvents.has(name))return {handled:false};
 return withTransaction(async c=>{
  const [[owner]]=await c.execute('SELECT id,username FROM users WHERE id=? FOR UPDATE',[userId]);
  if(!policy.isOwner(owner))return {handled:false};
  const [rows]=await c.execute('SELECT flag_key,flag_value FROM player_story_flags WHERE user_id=?',[userId]),f=Object.fromEntries(rows.map(r=>[r.flag_key,r.flag_value]));
  const p={flags:f},rescue=name==='lucie_lab_rescue';
  if(rescue?!story.replay(p):!story.fullReplay(p))return {handled:false};
  const flags=story.view(p).flags,definition=events[name];
  if(!meetsRequirements(definition,{flags})||(rescue&&f.admin_professor_departure!=='seen'))return {handled:true,changed:false,reason:'requirements_not_met'};
  const key=story.replayFlags[definition.completionFlag];
  if(flags[definition.completionFlag]==='true')return {handled:true,changed:false,reason:'already_completed'};
  await c.execute("INSERT INTO player_story_flags(user_id,flag_key,flag_value) VALUES(?,?,'true') ON DUPLICATE KEY UPDATE flag_value='true'",[userId,key]);
  return {handled:true,changed:true};
 });
}
async function rescueReplay(userId) {return (await completeReplay(userId,'lucie_lab_rescue')).changed===true;}
module.exports={noteExit,completeReplay,rescueReplay};
