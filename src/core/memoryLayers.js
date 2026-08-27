function ensure(config){
  config.v9 ??= {};
  config.v9.memory ??= {server:{},users:{},preferences:{}};
  config.v9.memory.server ??= {};
  config.v9.memory.users ??= {};
  config.v9.memory.preferences ??= {};
  return config.v9.memory;
}
function setServer(config,key,value){ensure(config).server[key]=value;}
function setUser(config,userId,key,value){ensure(config).users[userId]??={};ensure(config).users[userId][key]=value;}
function setPreference(config,userId,key,value){ensure(config).preferences[userId]??={};ensure(config).preferences[userId][key]=value;}
function getAll(config,userId){const m=ensure(config);return {server:m.server,user:m.users[userId]||{},preferences:m.preferences[userId]||{}};}
module.exports={ensure,setServer,setUser,setPreference,getAll};
