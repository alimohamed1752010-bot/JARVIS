const pending=new Map();
const TTL=30_000;
function key(message){return `${message.guild.id}:${message.author.id}`;}
function create(message,payload){pending.set(key(message),{...payload,expiresAt:Date.now()+TTL});return pending.get(key(message));}
function consume(message,input){const k=key(message);const p=pending.get(k);if(!p)return null;if(Date.now()>p.expiresAt){pending.delete(k);return null;}const yes=/^(?:yes|y|confirm|confirmed|do it|proceed|go ahead|execute)$/i.test(String(input).trim());const no=/^(?:no|n|cancel|stop|abort)$/i.test(String(input).trim());if(!yes&&!no)return null;pending.delete(k);return {confirmed:yes,payload:p};}
module.exports={create,consume,TTL};
