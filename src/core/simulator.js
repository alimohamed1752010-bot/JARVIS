function plan(actions){return actions.map((a,i)=>({step:i+1,action:a.action,target:a.target?.displayName||a.target?.user?.tag||a.target?.id||null,destination:a.destination?.name||null,allowed:a.allowed!==false,reason:a.reason||null}));}
function format(items){return items.map(x=>`${x.step}. ${x.allowed?'✅':'❌'} **${String(x.action).toUpperCase()}**${x.target?` → ${x.target}`:''}${x.destination?` → ${x.destination}`:''}${x.reason&&!x.allowed?` — ${x.reason}`:''}`).join('\n');}
module.exports={plan,format};
