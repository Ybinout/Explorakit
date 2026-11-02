const STATIONS=Object.freeze([
 {family:'move',label:'CS corrompues',x:7,y:8,screen:{x:6,y:6}},
 {family:'ability',label:'Talents',x:20,y:8,screen:{x:21,y:6}},
 {family:'type',label:'Types',x:7,y:13,screen:{x:6,y:11}},
 {family:'combat',label:'Offense / Défense',x:20,y:13,screen:{x:21,y:11}}
]);
function stationAt(player){if(player?.currentmap!=='professor_lab')return null;const x=Math.floor(player.x/32),y=Math.floor(player.y/32);return STATIONS.find(s=>s.x===x&&s.y===y)||null;}
module.exports={STATIONS,stationAt};
