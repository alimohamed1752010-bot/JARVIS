const awareness=require('./awareness');
const {resolveMember,resolveChannel}=require('./resolver');
const {safeMath}=require('../v8/tools');

function localTime(){return new Intl.DateTimeFormat('en-GB',{timeZone:'Africa/Cairo',dateStyle:'full',timeStyle:'long'}).format(new Date());}

class ToolRegistry {
  constructor(){this.tools=new Map();}
  register(name,description,handler){this.tools.set(name,{name,description,handler});return this;}
  get(name){return this.tools.get(name)||null;}
  list(){return [...this.tools.values()].map(({name,description})=>({name,description}));}
  async call(name,ctx,args){const tool=this.get(name);if(!tool)throw new Error(`Unknown tool: ${name}`);return tool.handler(ctx,args);}
}

// V11: this registry is the canonical structured tool catalog. The AI chat path
// (src/v8/tools.js runToolRequest) still uses its own natural-language regex
// matching for the same underlying operations (calculator, clock, server status) —
// that behavior is untouched. Registering the same operations here means the V9
// structured command path (diagnostics, v9tools) has access to the full tool set
// too, and future tools only need to be added once, in one place, to be visible
// from both entry points.
function createDefaultRegistry(){
  return new ToolRegistry()
    .register('calculator','Safe basic arithmetic',(ctx,args)=>safeMath(args.input))
    .register('clock','Current date/time (Africa/Cairo)',()=>localTime())
    .register('server.snapshot','Live Discord server state',ctx=>awareness.snapshot(ctx.message.guild))
    .register('server.status','Quick online/member/channel/AI status summary',ctx=>({guild:ctx.message.guild.name,members:ctx.message.guild.memberCount,channels:ctx.message.guild.channels.cache.size,ai:process.env.AI_ENABLED!=='false'}))
    .register('member.resolve','Resolve one member without guessing',(ctx,args)=>resolveMember(ctx.message.guild,args.query))
    .register('channel.resolve','Resolve one channel without guessing',(ctx,args)=>resolveChannel(ctx.message.guild,args.query,{voiceOnly:Boolean(args.voiceOnly)}));
}

module.exports={ToolRegistry,createDefaultRegistry};
