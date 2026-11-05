const COLORS=Object.freeze({blue:'#4b82b4',sage:'#608b72',lavender:'#9176af',sand:'#aa864c',rose:'#b76c89',coral:'#bf745d',teal:'#498f95',slate:'#738396'});
const prefix='friend_color:';
function normalize(value){return Object.hasOwn(COLORS,value)?value:null;}
module.exports={COLORS,prefix,normalize};
