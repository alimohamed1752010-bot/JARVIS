const awareness=require('./awareness');
const {resolveMember,resolveChannel}=require('./resolver');
const {safeMath}=require('../v8/tools');

class ToolRegistry {
  constructor(){this.tools=new Map();}
  register(name,description,handler){this.tools.set(name,{name,description,handler});return this;}
  get(name){return this.tools.get(name)||null;}
  list(){return [...this.tools.values()].map(({name,description})=>({name,description}));}
  async call(name,ctx,args){const tool=this.get(name);if(!tool)throw new Error(`Unknown tool: ${name}`);return tool.handler(ctx,args);}
}

function createDefaultRegistry(){
  return new ToolRegistry()
    .register('calculator','Safe basic arithmetic',(ctx,args)=>safeMath(args.input))
    .register('server.snapshot','Live Discord server state',ctx=>awareness.snapshot(ctx.message.guild))
    .register('member.resolve','Resolve one member without guessing',(ctx,args)=>resolveMember(ctx.message.guild,args.query))
    .register('channel.resolve','Resolve one channel without guessing',(ctx,args)=>resolveChannel(ctx.message.guild,args.query,{voiceOnly:Boolean(args.voiceOnly)}));
}

module.exports={ToolRegistry,createDefaultRegistry};
