const { execFile, spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const IS_WIN = process.platform === 'win32';
const MAX_OUTPUT = 5000;
const SAFE_APPS = new Set(['chrome','brave','msedge','discord','notepad','calculator','calc','explorer','cmd','powershell','code','spotify','steam','taskmgr','settings','paint','mspaint','minecraft','minecraftlauncher']);
const BLOCKED = /\b(format|diskpart|cipher\s+\/w|bcdedit|bootrec|takeown|icacls|reg\s+delete|shutdown|restart-computer|stop-computer|remove-item\s+-recurse\s+.*(c:|windows)|del\s+\/s\s+\/q\s+c:\\windows)\b/i;

function ensureWindows(){ if(!IS_WIN) throw new Error('JARVIS PC control currently requires Windows.'); }
function psEscape(s){ return String(s).replace(/'/g,"''"); }
function runPS(script,{timeout=15000}={}){
  ensureWindows();
  return new Promise((resolve,reject)=>{
    execFile('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-Command',script],{windowsHide:true,timeout,maxBuffer:1024*1024},(error,stdout,stderr)=>{
      if(error){ reject(new Error((stderr||error.message||'PowerShell failed').trim().slice(0,MAX_OUTPUT))); return; }
      resolve(String(stdout||'').trim().slice(0,MAX_OUTPUT));
    });
  });
}
function spawnApp(command,args=[]){
  ensureWindows();
  return new Promise((resolve,reject)=>{
    const child=spawn(command,args,{detached:true,stdio:'ignore',windowsHide:false});
    let settled=false;
    child.once('spawn',()=>{ if(!settled){settled=true; child.unref(); resolve({started:true});} });
    child.once('error',err=>{ if(!settled){settled=true; reject(err);} });
  });
}
async function findStartApp(app){
  const encoded=Buffer.from(String(app),'utf8').toString('base64');
  const ps=`$needle=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encoded}')); $apps=Get-StartApps | Where-Object { $_.Name -like ('*'+$needle+'*') -or $_.AppID -like ('*'+$needle+'*') }; if($apps){ $app=$apps | Select-Object -First 1; Write-Output $app.AppID } else { exit 1 }`;
  return (await runPS(ps)).trim();
}
async function startAppFromStartMenu(app,args=[]){
  const appId=await findStartApp(app);
  if(!appId) throw new Error(`Application not found in Start menu: ${app}`);
  const encoded=Buffer.from(appId,'utf8').toString('base64');
  const argEncoded=Buffer.from(JSON.stringify(args||[]),'utf8').toString('base64');
  const ps=`$id=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encoded}')); $args=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${argEncoded}')); Start-Process ('shell:AppsFolder\\'+$id) -ArgumentList $args`;
  await runPS(ps);
  return {started:true,via:'StartMenu',appId};
}
function normalizeApp(app){
  const a=String(app||'').trim().toLowerCase().replace(/\.exe$/,'');
  const aliases={googlechrome:'chrome','google chrome':'chrome','microsoft edge':'msedge','edge':'msedge','brave browser':'brave','brave browser beta':'brave','discordapp':'discord','file explorer':'explorer','visual studio code':'code','vs code':'code','task manager':'taskmgr','calculator':'calc','minecraft launcher':'minecraftlauncher','minecraft launcher for windows':'minecraftlauncher'};
  return aliases[a]||a;
}
async function openApp(app,args=[]){
  const a=normalizeApp(app); if(!a)throw new Error('Application name is missing.');
  if(!SAFE_APPS.has(a) && !/^[a-z0-9._ -]{1,80}$/i.test(a)) throw new Error('Application name is not allowed.');
  if(a==='settings') { await runPS("Start-Process 'ms-settings:'"); return {started:true,via:'protocol'}; }
  const exe={chrome:'chrome.exe',brave:'brave.exe',msedge:'msedge.exe',discord:'discord.exe',code:'code.exe',spotify:'Spotify.exe',minecraftlauncher:'MinecraftLauncher.exe'}[a] || `${a}.exe`;
  // First verify the executable actually exists on PATH. spawn() can otherwise
  // report success too late, which used to make JARVIS claim it opened apps
  // that Windows never launched.
  try {
    const where=await new Promise((resolve,reject)=>{
      execFile('where.exe',[exe],{windowsHide:true,timeout:5000},(error,stdout,stderr)=>{
        if(error) return reject(error);
        resolve(String(stdout||'').split(/\r?\n/).map(x=>x.trim()).find(Boolean)||'');
      });
    });
    if(where){ await spawnApp(where,args); return {started:true,via:'PATH',executable:where}; }
  } catch {}
  // Common per-user install locations for Chromium/Spotify.
  const candidates=[];
  const local=process.env.LOCALAPPDATA||'';
  const programFiles=process.env.ProgramFiles||'';
  const programFilesX86=process.env['ProgramFiles(x86)']||'';
  if(a==='brave') candidates.push(path.join(local,'BraveSoftware','Brave-Browser','Application','brave.exe'),path.join(programFiles,'BraveSoftware','Brave-Browser','Application','brave.exe'),path.join(programFilesX86,'BraveSoftware','Brave-Browser','Application','brave.exe'));
  if(a==='chrome') candidates.push(path.join(local,'Google','Chrome','Application','chrome.exe'),path.join(programFiles,'Google','Chrome','Application','chrome.exe'),path.join(programFilesX86,'Google','Chrome','Application','chrome.exe'));
  if(a==='msedge') candidates.push(path.join(programFiles,'Microsoft','Edge','Application','msedge.exe'),path.join(programFilesX86,'Microsoft','Edge','Application','msedge.exe'));
  if(a==='spotify') candidates.push(path.join(local,'Microsoft','WindowsApps','Spotify.exe'),path.join(local,'Spotify','Spotify.exe'));
  for(const candidate of candidates){
    if(candidate && fs.existsSync(candidate)){ await spawnApp(candidate,args); return {started:true,via:'known-path',executable:candidate}; }
  }
  // Start-menu fallback handles Microsoft Store/AppX installs and other apps
  // that do not expose a conventional executable path.
  return startAppFromStartMenu(a,args);
}
async function closeApp(app){
  const a=normalizeApp(app); if(!a)throw new Error('Application name is missing.');
  if(!SAFE_APPS.has(a)) throw new Error(`Closing **${a}** is not in the safe application allowlist.`);
  await runPS(`Get-Process -Name '${psEscape(a)}' -ErrorAction SilentlyContinue | Stop-Process -Force`);
  return `Closed ${a}.`;
}
async function listProcesses(){ return runPS("Get-Process | Sort-Object CPU -Descending | Select-Object -First 25 Name,Id,CPU | Format-Table -AutoSize | Out-String"); }
async function setVolume(percent){
  const n=Math.max(0,Math.min(100,Number(percent))); if(!Number.isFinite(n))throw new Error('Volume must be 0-100.');
  const script=`Add-Type -TypeDefinition @'\nusing System; using System.Runtime.InteropServices; public class Audio { [DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo); }\n'@; $w=New-Object -ComObject WScript.Shell; 1..50 | % { $w.SendKeys([char]174) }; 1..${Math.round(n/2)} | % { $w.SendKeys([char]175) }`;
  await runPS(script); return `Volume adjusted to approximately ${Math.round(n)}%.`;
}
async function key(keys){
  const value=String(keys||'').trim(); if(!value)throw new Error('Key is missing.');
  const allowed=/^[A-Za-z0-9 _+^%~(){}\[\]\\.\-]{1,120}$/; if(!allowed.test(value))throw new Error('Key sequence contains unsupported characters.');
  return runPS(`$w=New-Object -ComObject WScript.Shell; $w.SendKeys('${psEscape(value)}')`);
}
async function typeText(text){
  const t=String(text||''); if(!t)throw new Error('Text is empty.'); if(t.length>1000)throw new Error('Text is limited to 1000 characters per action.');
  const encoded=Buffer.from(t,'utf8').toString('base64');
  const script=`$t=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encoded}')); Set-Clipboard -Value $t; $w=New-Object -ComObject WScript.Shell; $w.SendKeys('^v')`;
  return runPS(script);
}
async function hotkey(keys){
  const parts=String(keys||'').split('+').map(x=>x.trim().toUpperCase()).filter(Boolean); if(!parts.length||parts.length>5)throw new Error('Invalid hotkey.');
  const map={CTRL:'^',CONTROL:'^',ALT:'%',SHIFT:'+',WIN:'#',ENTER:'{ENTER}',ESC:'{ESC}',ESCAPE:'{ESC}',TAB:'{TAB}',SPACE:' ',UP:'{UP}',DOWN:'{DOWN}',LEFT:'{LEFT}',RIGHT:'{RIGHT}',DELETE:'{DELETE}',BACKSPACE:'{BACKSPACE}'};
  const seq=parts.map(p=>map[p]||`{${p}}`).join(''); return key(seq);
}
async function screenshot(output){
  const file=path.resolve(String(output||path.join(process.cwd(),'data','screenshots',`jarvis-${Date.now()}.png`)));
  fs.mkdirSync(path.dirname(file),{recursive:true});
  const escaped=psEscape(file);
  await runPS(`Add-Type -AssemblyName System.Windows.Forms; Add-Type -AssemblyName System.Drawing; $b=[System.Windows.Forms.Screen]::PrimaryScreen.Bounds; $bmp=New-Object System.Drawing.Bitmap $b.Width,$b.Height; $g=[System.Drawing.Graphics]::FromImage($bmp); $g.CopyFromScreen($b.Location,[System.Drawing.Point]::Empty,$b.Size); $bmp.Save('${escaped}',[System.Drawing.Imaging.ImageFormat]::Png); $g.Dispose(); $bmp.Dispose()`);
  return file;
}

async function mouse(spec){
  const raw=String(spec||'').trim();
  const m=raw.match(/^(\d{1,5})\s*,\s*(\d{1,5})(?:\s*,\s*(left|right|middle|double))?$/i);
  if(!m) throw new Error('Mouse format must be x,y[,left|right|middle|double].');
  const x=Math.min(Number(m[1]),20000), y=Math.min(Number(m[2]),20000), button=(m[3]||'left').toLowerCase();
  const flags=button==='right'?['0x0008','0x0010']:button==='middle'?['0x0020','0x0040']:['0x0002','0x0004'];
  const script=`Add-Type @'\nusing System; using System.Runtime.InteropServices; public static class MouseCtl { [DllImport("user32.dll")] public static extern bool SetCursorPos(int X,int Y); [DllImport("user32.dll")] public static extern void mouse_event(uint flags,uint dx,uint dy,uint data,UIntPtr extra); }\n'@; [MouseCtl]::SetCursorPos(${x},${y}); [MouseCtl]::mouse_event(${flags[0]},0,0,0,[UIntPtr]::Zero); Start-Sleep -Milliseconds 50; [MouseCtl]::mouse_event(${flags[1]},0,0,0,[UIntPtr]::Zero); ${button==='double'?"Start-Sleep -Milliseconds 70; [MouseCtl]::mouse_event(0x0002,0,0,0,[UIntPtr]::Zero); Start-Sleep -Milliseconds 50; [MouseCtl]::mouse_event(0x0004,0,0,0,[UIntPtr]::Zero);":''}`;
  return runPS(script);
}


async function browserSearch(query, browser='brave') {
  const q=String(query||'').trim();
  if(!q) throw new Error('Search query is empty.');
  const b=normalizeApp(browser||'brave');
  if(b!=='brave' && b!=='chrome' && b!=='msedge') throw new Error(`Unsupported browser: ${browser}`);
  const url=`https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`;
  const result=await openBrowserUrl(url,b);
  return {text:`Opened YouTube search for “${q}” in ${b}.`,details:result};
}

async function findBrowserExecutable(browser='brave') {
  const b=normalizeApp(browser);
  const exe={brave:'brave.exe',chrome:'chrome.exe',msedge:'msedge.exe'}[b];
  if(!exe) throw new Error(`Unsupported browser: ${browser}`);
  try {
    const where=await new Promise((resolve,reject)=>{
      execFile('where.exe',[exe],{windowsHide:true,timeout:5000},(error,stdout)=>{
        if(error) return reject(error);
        resolve(String(stdout||'').split(/\r?\n/).map(x=>x.trim()).find(Boolean)||'');
      });
    });
    if(where) return where;
  } catch {}
  const local=process.env.LOCALAPPDATA||'';
  const programFiles=process.env.ProgramFiles||'';
  const programFilesX86=process.env['ProgramFiles(x86)']||'';
  const candidates={
    brave:[path.join(local,'BraveSoftware','Brave-Browser','Application','brave.exe'),path.join(programFiles,'BraveSoftware','Brave-Browser','Application','brave.exe'),path.join(programFilesX86,'BraveSoftware','Brave-Browser','Application','brave.exe')],
    chrome:[path.join(local,'Google','Chrome','Application','chrome.exe'),path.join(programFiles,'Google','Chrome','Application','chrome.exe'),path.join(programFilesX86,'Google','Chrome','Application','chrome.exe')],
    msedge:[path.join(programFiles,'Microsoft','Edge','Application','msedge.exe'),path.join(programFilesX86,'Microsoft','Edge','Application','msedge.exe')]
  }[b]||[];
  const found=candidates.find(x=>x&&fs.existsSync(x));
  if(found) return found;
  throw new Error(`${b} was not found on this PC.`);
}

async function openBrowserUrl(url,browser='brave') {
  ensureWindows();
  const u=String(url||'').trim();
  if(!/^https?:\/\//i.test(u)) throw new Error('URL must start with http:// or https://');
  const executable=await findBrowserExecutable(browser);
  await spawnApp(executable,[u]);
  await new Promise(r=>setTimeout(r,900));
  const processName=path.basename(executable,'.exe');
  const check=await runPS(`$p=Get-Process -Name '${psEscape(processName)}' -ErrorAction SilentlyContinue; if($p){'running'} else {exit 1}`).catch(()=>null);
  if(check!=='running') throw new Error(`Browser process did not remain running after launch: ${browser}.`);
  return {started:true,browser:normalizeApp(browser),url:u,executable};
}

async function spotifyPlay(query) {
  const q=String(query||'').trim(); if(!q) throw new Error('Spotify search is empty.');
  await openApp('spotify');
  await new Promise(r=>setTimeout(r,1400));
  await hotkey('CTRL+K').catch(()=>{});
  await new Promise(r=>setTimeout(r,250));
  await typeText(q);
  await new Promise(r=>setTimeout(r,700));
  await key('{ENTER}');
  await new Promise(r=>setTimeout(r,500));
  return `Spotify search opened for “${q}”.`;
}

async function openUrl(url){
  const u=String(url||'').trim();
  if(!/^https?:\/\//i.test(u))throw new Error('URL must start with http:// or https://');
  if(u.length>2000)throw new Error('URL is too long.');
  await spawnApp('cmd.exe',['/c','start','',u]);
  return `Opened ${u}`;
}
async function fileAction(action,src,dst){
  const s=path.resolve(String(src||'')); if(!s||s===path.parse(s).root)throw new Error('Unsafe file path.');
  if(action==='read'){ const st=fs.statSync(s); if(st.size>1024*1024)throw new Error('File is larger than 1 MB.'); return fs.readFileSync(s,'utf8').slice(0,10000); }
  if(action==='write'){ if(String(dst||'').length>100000)throw new Error('Content too large.'); fs.mkdirSync(path.dirname(s),{recursive:true}); fs.writeFileSync(s,String(dst||''),'utf8'); return `Wrote ${s}`; }
  if(action==='copy'){const d=path.resolve(String(dst||''));fs.copyFileSync(s,d);return `Copied to ${d}`;}
  if(action==='move'){const d=path.resolve(String(dst||''));fs.mkdirSync(path.dirname(d),{recursive:true});fs.renameSync(s,d);return `Moved to ${d}`;}
  if(action==='delete'){fs.rmSync(s,{recursive:true,force:false});return `Deleted ${s}`;}
  throw new Error(`Unknown file action ${action}`);
}
async function shell(command){
  const c=String(command||'').trim(); if(!c)throw new Error('Command is empty.'); if(c.length>2000)throw new Error('Command too long.'); if(BLOCKED.test(c))throw new Error('That system command is blocked by JARVIS safety policy.');
  return runPS(c,{timeout:20000});
}
module.exports={openApp,closeApp,listProcesses,setVolume,key,typeText,hotkey,mouse,screenshot,openUrl,browserSearch,spotifyPlay,fileAction,shell,IS_WIN};
