const LEVELS={
  low:new Set(['voicemove','voicemute','voiceunmute','voicedeafen','voiceundeafen','warn','untimeout']),
  medium:new Set(['role_add','role_remove','member_nickname','textmute','textunmute','channel_edit','role_create','channel_create']),
  high:new Set(['timeout','kick','channel_permissions','role_permissions','role_delete','channel_delete']),
  critical:new Set(['ban'])
};
function level(step){const a=String(step?.action||'').toLowerCase();if(LEVELS.critical.has(a))return 4;if(LEVELS.high.has(a))return 3;if(LEVELS.medium.has(a))return 2;return 1;}
function label(n){return ['LOW','LOW','MEDIUM','HIGH','CRITICAL'][Math.max(1,Math.min(4,n))];}
function summarize(steps){const max=Math.max(1,...steps.map(level));return {level:max,label:label(max)};}
module.exports={level,label,summarize};
