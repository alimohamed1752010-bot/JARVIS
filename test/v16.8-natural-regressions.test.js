const fs=require('node:fs');
const path=require('node:path');
const agent=fs.readFileSync(path.join(__dirname,'../src/core/agent.js'),'utf8');
const pc=fs.readFileSync(path.join(__dirname,'../src/core/pcTools.js'),'utf8');
function assert(c,m){if(!c)throw new Error(m)}
assert(agent.includes('comma-separated'), 'search parser does not document delimiter handling');
assert(agent.includes('(?:open|launch|start|play|put\\s+on|set|make|run|fire\\s+up)'), 'search parser is missing action delimiters');
assert(agent.includes("!/^spotify$/i.test(play[1].trim())"), 'Spotify-only play guard missing');
assert(agent.includes("replace(/[\\s,;]+$/,''),reason:'brave'"), 'search cleanup missing');
assert(pc.includes("if(a==='brave'||a==='chrome'||a==='msedge')"), 'browser direct discovery missing');
assert(pc.includes('findBrowserExecutable(a)'), 'browser executable discovery not wired');
console.log('V16.8 regression checks passed');
