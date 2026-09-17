const fs=require('fs');
const agent=fs.readFileSync('src/core/agent.js','utf8');
const pc=fs.readFileSync('src/core/pcTools.js','utf8');
const checks=[
  ['blind TAB loop removed', !/for\(let attempt=0; attempt<6; attempt\+\+\)/.test(pc)],
  ['safe UI automation exists', /spotifyUiPlay\(query\)/.test(pc)],
  ['no safe play button fails closed', /No safe Play button associated/.test(pc)],
  ['bare pause supported', /\^\\s\*\(\?:pause\|stop\)/.test(agent)],
  ['bare play supported', /\^\\s\*\(\?:play\|start\)/.test(agent)],
  ['media-session verification retained', /Spotify did not enter playback/.test(pc)],
];
let passed=0; for(const [n,ok] of checks){console.log(`${ok?'PASS':'FAIL'} ${n}`); if(ok)passed++;}
console.log(`V18.7 Spotify safety regressions: ${passed}/${checks.length} passed`);
if(passed!==checks.length)process.exit(1);
