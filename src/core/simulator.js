function plan(actions){return actions.map((a,i)=>({step:i+1,action:a.action,target:a.target?.displayName||a.target?.user?.tag||a.target?.id||null,destination:a.destination?.name||null,allowed:a.allowed!==false,reason:a.reason||null}));}
module.exports={plan};
