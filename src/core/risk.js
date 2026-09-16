const LEVELS={
  low:new Set(['pc_processes','pc_screenshot','pc_open_app','pc_open_url','pc_browser_search','pc_spotify_play','voicemove','voicemute','voiceunmute','voicedeafen','voiceundeafen','warn','untimeout']),
  medium:new Set(['pc_key','pc_mouse','pc_hotkey','pc_type','pc_volume','pc_file_read','pc_file_copy','pc_file_move','role_add','role_remove','member_nickname','textmute','textunmute','channel_edit','role_create','channel_create']),
  high:new Set(['pc_close_app','pc_file_write','pc_file_delete','pc_shell','timeout','kick','channel_permissions','role_permissions','role_delete','channel_delete']),
  critical:new Set(['ban'])
};
function level(step){const a=String(step?.action||'').toLowerCase();if(LEVELS.critical.has(a))return 4;if(LEVELS.high.has(a))return 3;if(LEVELS.medium.has(a))return 2;return 1;}
function label(n){return ['LOW','LOW','MEDIUM','HIGH','CRITICAL'][Math.max(1,Math.min(4,n))];}
function summarize(steps){const max=Math.max(1,...steps.map(level));return {level:max,label:label(max)};}
module.exports={level,label,summarize};
