const fs=require('fs');
const path=require('path');
const root=path.join(__dirname,'..');
const agent=fs.readFileSync(path.join(root,'src/core/agent.js'),'utf8');
const tools=fs.readFileSync(path.join(root,'src/core/pcTools.js'),'utf8');
const pcAgent=fs.readFileSync(path.join(root,'src/pc-agent/index.js'),'utf8');
const validator=fs.readFileSync(path.join(root,'src/core/planValidator.js'),'utf8');
const ai=fs.readFileSync(path.join(root,'src/ai/ai.js'),'utf8');
const checks=[
 ['Spotify playback executor exists',/async function spotifyPlay\(query\)/.test(tools)],
 ['Spotify playback verifies media session',/playback could not be verified/.test(tools)],
 ['Spotify session reader exists',/async function spotifySession\(\)/.test(tools)],
 ['Spotify control executor exists',/async function spotifyControl\(mode='toggle'\)/.test(tools)],
 ['PC agent routes spotify control',/action === 'pc_spotify_control'/.test(pcAgent)],
 ['Validator allows spotify control',/pc_spotify_control/.test(validator)],
 ['AI schema includes spotify control',/pc_spotify_control/.test(ai)],
 ['pause command routes to pause',/pc_spotify_control',\{name:'pause'\}/.test(agent)],
 ['resume command routes to play',/pc_spotify_control',\{name:'play'\}/.test(agent)],
 ['natural Spotify track parser preserved',/pc_spotify_play',\{name:track\}/.test(agent)],
];
let pass=0; for(const [n,ok] of checks){console.log(`${ok?'PASS':'FAIL'} ${n}`); if(ok)pass++;}
console.log(`V18.6 Spotify controls: ${pass}/${checks.length} passed`);
if(pass!==checks.length)process.exit(1);
