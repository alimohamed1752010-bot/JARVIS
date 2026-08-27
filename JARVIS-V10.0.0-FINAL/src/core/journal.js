const crypto=require('node:crypto');

function ensure(config){
  config.v9 ??= {};
  config.v9.actionJournal ??= [];
  config.v9.nextActionId ??= 1;
  return config.v9;
}

function record(config, data){
  const v9=ensure(config);
  const entry={id:v9.nextActionId++,uuid:crypto.randomUUID(),at:new Date().toISOString(),status:'SUCCESS',reversible:false,...data};
  v9.actionJournal.push(entry);
  if(v9.actionJournal.length>2000) v9.actionJournal=v9.actionJournal.slice(-2000);
  return entry;
}

function latest(config, filter=()=>true){
  return [...ensure(config).actionJournal].reverse().find(filter)||null;
}
function get(config,id){ return ensure(config).actionJournal.find(x=>String(x.id)===String(id))||null; }

module.exports={ensure,record,latest,get};
