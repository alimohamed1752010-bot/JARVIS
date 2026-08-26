const http=require('node:http');
function startDashboard(client,getConfig){
  if(String(process.env.DASHBOARD_ENABLED||'false').toLowerCase()!=='true') return;
  const token=String(process.env.DASHBOARD_TOKEN||''); if(!token){console.error('[DASHBOARD] DASHBOARD_TOKEN missing; disabled.');return;}
  const port=Number(process.env.PORT||3000);
  const server=http.createServer((req,res)=>{
    const auth=(req.headers.authorization||'').replace(/^Bearer\s+/i,''); if(auth!==token){res.writeHead(401);return res.end('Unauthorized');}
    const data={bot:client.user?.tag,guilds:client.guilds.cache.map(g=>({id:g.id,name:g.name,members:g.memberCount,config:getConfig(g.id)})),uptime:process.uptime(),memory:process.memoryUsage()};
    res.writeHead(200,{'Content-Type':'application/json; charset=utf-8'}); res.end(JSON.stringify(data,null,2));
  }); server.listen(port,()=>console.log(`[DASHBOARD] listening on ${port}`));
}
module.exports={startDashboard};
