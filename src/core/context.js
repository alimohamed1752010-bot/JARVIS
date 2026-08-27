const contexts=new Map();
const TTL=60_000;
function key(message){return `${message.guild.id}:${message.author.id}`;}
function set(message,data){contexts.set(key(message),{...data,createdAt:Date.now()});}
function get(message){const x=contexts.get(key(message));if(!x)return null;if(Date.now()-x.createdAt>TTL){contexts.delete(key(message));return null;}return x;}
function clear(message){contexts.delete(key(message));}
function cleanup(){const now=Date.now();for(const [k,v] of contexts)if(now-v.createdAt>TTL)contexts.delete(k);}
setInterval(cleanup,15_000).unref();
module.exports={set,get,clear,TTL};
