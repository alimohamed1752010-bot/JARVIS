const fs=require('fs');
const s=fs.readFileSync('/mnt/data/v188work/src/core/agent.js','utf8');
const checks=[
 ['raw is mutable',/let raw=String\(prompt\|\|''\)/.test(s)],
 ['mixed timeout extraction',/V18\.8: preserve mixed PC \+ Discord commands/.test(s)],
 ['timeout action appended',/base\('timeout',\{targets:\[extractedTimeout\.target\]/.test(s)],
 ['chained web navigation',/\(\?:and\|then\)\\\\s\+/.test(s)],
 ['ordered web steps',/webOpenSteps\.sort\(\(a,b\)=>a\.index-b\.index\)/.test(s)],
 ['mixed confirmation',/needsConfirmation:Boolean\(extractedTimeout\)/.test(s)]
];
for(const [n,ok] of checks) console.log((ok?'PASS':'FAIL')+' '+n);
if(checks.some(x=>!x[1])) process.exit(1);
