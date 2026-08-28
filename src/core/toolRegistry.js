const awareness=require('./awareness');
const {resolveMember,resolveChannel}=require('./resolver');
const {safeMath}=require('../v8/tools');
const serverBrain=require('./serverBrain');
const snapshots=require('./snapshots');
const journal=require('./journal');
const knowledge=require('./serverKnowledge');

class ToolRegistry {
  constructor(){this.tools=new Map();}
  register(name,description,handler,meta={}){this.tools.set(name,{name,description,handler,meta});return this;}
  get(name){return this.tools.get(name)||null;}
  list(){return [...this.tools.values()].map(({name,description,meta})=>({name,description,...meta}));}
  async call(name,ctx,args={}){const tool=this.get(name);if(!tool)throw new Error(`Unknown tool: ${name}`);return tool.handler(ctx,args);}
}
function createDefaultRegistry(){
  return new ToolRegistry()
    .register('calculator','Safe basic arithmetic',(ctx,args)=>safeMath(args.input),{risk:'low'})
    .register('server.snapshot','Read-only live server overview',ctx=>awareness.snapshot(ctx.message.guild),{risk:'low'})
    .register('server.knowledge','Read persistent server knowledge and recent JARVIS events',ctx=>knowledge.get(ctx.config,ctx.message.guild.id),{risk:'low'})
    .register('server.scan','Refresh the persistent server knowledge cache',async ctx=>knowledge.scan(ctx.message.guild,ctx.config,ctx.saveConfig),{risk:'low'})
    .register('server.analyze','Analyze server health, permissions and structural risks',ctx=>serverBrain.analyze(ctx.message.guild),{risk:'low'})
    .register('server.audit','Fetch recent Discord audit-log entries',async ctx=>{const logs=await ctx.message.guild.fetchAuditLogs({limit:25}).catch(()=>null);return logs?[...logs.entries.values()].map(e=>({id:e.id,action:String(e.action),executor:e.executor?.tag||null,at:new Date(e.createdTimestamp).toISOString(),target:e.target?.name||e.target?.tag||e.target?.id||null,reason:e.reason||null})):[];},{risk:'low'})
    .register('server.journal','Read JARVIS action history',ctx=>journal.ensure(ctx.config).actionJournal.slice(-100).reverse(),{risk:'low'})
    .register('server.snapshots','List saved JARVIS snapshots',ctx=>snapshots.list(ctx.config).map(s=>({id:s.id,at:s.at,reason:s.reason,guildName:s.guildName,roles:s.roles?.length||0,channels:s.channels?.length||0})),{risk:'low'})
    .register('member.resolve','Resolve one member without guessing',(ctx,args)=>resolveMember(ctx.message.guild,args.query),{risk:'low'})
    .register('channel.resolve','Resolve one channel without guessing',(ctx,args)=>resolveChannel(ctx.message.guild,args.query,{voiceOnly:Boolean(args.voiceOnly)}),{risk:'low'});
}
module.exports={ToolRegistry,createDefaultRegistry};
