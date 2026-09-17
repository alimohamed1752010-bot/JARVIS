require('dotenv').config();
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {spawn}=require('node:child_process');
const WebSocket=require('ws');
const {GoogleGenAI}=require('@google/genai');
const ffmpeg=require('ffmpeg-static');

const TOKEN=String(process.env.JARVIS_PC_TOKEN||'').trim();
const GUILD_ID=String(process.env.JARVIS_VOICE_GUILD_ID||'').trim();
const USER_ID=String(process.env.JARVIS_VOICE_USER_ID||'').trim();
const RAW_URL=String(process.env.JARVIS_PC_URL||'').trim();
const VOICE_URL=String(process.env.JARVIS_VOICE_URL||RAW_URL.replace(/^wss:/i,'https:').replace(/^ws:/i,'http:')).replace(/\/$/,'');
const GEMINI_KEY=String(process.env.GEMINI_API_KEY||'').trim();
const STT_MODEL=String(process.env.GEMINI_STT_MODEL||'gemini-2.5-flash').trim();
const TTS_MODEL=String(process.env.GEMINI_TTS_MODEL||'gemini-2.5-flash-preview-tts').trim();
const TTS_VOICE=String(process.env.JARVIS_TTS_VOICE||'Algenib').trim();
const TMP=path.join(os.tmpdir(),'jarvis-voice'); fs.mkdirSync(TMP,{recursive:true});
if(!TOKEN||!GUILD_ID||!USER_ID||!VOICE_URL||!GEMINI_KEY) { console.error('Voice setup requires JARVIS_PC_TOKEN, JARVIS_VOICE_GUILD_ID, JARVIS_VOICE_USER_ID, JARVIS_PC_URL and GEMINI_API_KEY.'); process.exit(1); }
const ai=new GoogleGenAI({apiKey:GEMINI_KEY});

function psKeyWatcher(){
  const script=`Add-Type @'\nusing System; using System.Runtime.InteropServices; public static class K { [DllImport("user32.dll")] public static extern short GetAsyncKeyState(int v); }\n'@; $was=$false; while($true){$down=([K]::GetAsyncKeyState(0xA3)-band 0x8000)-ne 0; if($down -and -not $was){'DOWN';[Console]::Out.Flush()}; if(-not $down -and $was){'UP';[Console]::Out.Flush()}; $was=$down; Start-Sleep -Milliseconds 35}`;
  const ps=spawn('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-Command',script],{windowsHide:true,stdio:['ignore','pipe','pipe']});
  ps.stderr.on('data',b=>console.warn('[VOICE KEY]',b.toString().trim())); return ps;
}
async function findMic(){
  if(process.env.JARVIS_MIC_DEVICE) return String(process.env.JARVIS_MIC_DEVICE);
  return new Promise((resolve,reject)=>{
    const p=spawn(ffmpeg,['-hide_banner','-list_devices','true','-f','dshow','-i','dummy'],{windowsHide:true}); let out='';
    p.stderr.on('data',b=>out+=b.toString()); p.on('close',()=>{const m=[...out.matchAll(/\"([^\"]+)\"\s+\(audio\)/g)].map(x=>x[1]); if(m[0]) resolve(m[0]); else reject(new Error('No Windows microphone was detected by FFmpeg. Set JARVIS_MIC_DEVICE to your microphone device name.'));});
  });
}
let micDevice=null; let recorder=null; let recordingPath=null; let busy=false;
function startRecording(){ if(busy||recorder) return; recordingPath=path.join(TMP,`jarvis-${Date.now()}.wav`); recorder=spawn(ffmpeg,['-hide_banner','-loglevel','error','-f','dshow','-i',`audio=${micDevice}`,'-ac','1','-ar','16000','-y',recordingPath],{windowsHide:true,stdio:['ignore','ignore','pipe']}); recorder.stderr.on('data',b=>console.warn('[VOICE REC]',b.toString().trim())); recorder.on('error',e=>console.error('[VOICE REC ERROR]',e.message)); console.log('[VOICE] Listening... release Right Ctrl when done.'); }
function stopRecording(){ if(!recorder) return Promise.resolve(null); const p=recorder; recorder=null; return new Promise(resolve=>{p.once('close',()=>resolve(recordingPath)); try{p.kill('SIGINT');}catch{try{p.kill();}catch{}}}); }
async function transcribe(file){const data=fs.readFileSync(file).toString('base64'); const r=await ai.models.generateContent({model:STT_MODEL,contents:[{role:'user',parts:[{text:'Transcribe this microphone recording exactly. Return only the spoken words. Do not add commentary.'},{inlineData:{mimeType:'audio/wav',data}}]}]}); return String(r.text||'').trim();}
function pcmToWav(pcm,sampleRate=24000,channels=1){const h=Buffer.alloc(44); const byteRate=sampleRate*channels*2; h.write('RIFF',0); h.writeUInt32LE(36+pcm.length,4); h.write('WAVE',8); h.write('fmt ',12); h.writeUInt32LE(16,16); h.writeUInt16LE(1,20); h.writeUInt16LE(channels,22); h.writeUInt32LE(sampleRate,24); h.writeUInt32LE(byteRate,28); h.writeUInt16LE(channels*2,32); h.writeUInt16LE(16,34); h.write('data',36); h.writeUInt32LE(pcm.length,40); return Buffer.concat([h,pcm]);}
async function speakLocal(text){
  const transcript=String(text||'').replace(/<@!?(\d+)>/g,'').replace(/\*\*/g,'').slice(0,2500);
  if(!transcript)return;
  const encoded=Buffer.from(transcript,'utf8').toString('base64');
  const voiceArg=LOCAL_TTS_VOICE ? `$voice=$s.GetVoices() | Where-Object { $_.GetDescription() -eq '${LOCAL_TTS_VOICE.replace(/'/g,"''")}' } | Select-Object -First 1; if($voice){$s.SelectVoice($voice.VoiceInfo.Name)}` : '';
  const script=`Add-Type -AssemblyName System.Speech; $s=New-Object System.Speech.Synthesis.SpeechSynthesizer; ${voiceArg} $s.Rate=0; $t=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encoded}')); $s.Speak($t); $s.Dispose()`;
  await new Promise((resolve,reject)=>{const ps=spawn('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-Command',script],{windowsHide:true,stdio:['ignore','ignore','pipe']}); let err=''; ps.stderr.on('data',b=>err+=b.toString()); ps.on('error',reject); ps.on('close',code=>code===0?resolve():reject(new Error(err.trim()||`Local TTS exited with code ${code}`)));});
}
async function speakGemini(text){
  const prompt=`Speak naturally as a calm, concise British male AI assistant. Do not add words beyond the transcript.\nTRANSCRIPT:\n${String(text).slice(0,2500)}`;
  const r=await ai.models.generateContent({model:TTS_MODEL,contents:[{parts:[{text:prompt}]}],config:{responseModalities:['AUDIO'],speechConfig:{voiceConfig:{prebuiltVoiceConfig:{voiceName:TTS_VOICE}}}}});
  const parts=(r.candidates||[]).flatMap(c=>c?.content?.parts||[]);
  const b=parts.find(p=>p?.inlineData?.data)?.inlineData?.data;
  if(!b) throw new Error('Gemini returned no TTS audio.');
  const wav=path.join(TMP,`tts-${Date.now()}.wav`); fs.writeFileSync(wav,pcmToWav(Buffer.from(b,'base64')));
  await new Promise(resolve=>{const ps=spawn('powershell.exe',['-NoProfile','-Command',`$p=New-Object System.Media.SoundPlayer '${wav.replace(/'/g,"''")}';$p.PlaySync()`],{windowsHide:true,stdio:'ignore'}); ps.on('close',()=>{try{fs.unlinkSync(wav)}catch{};resolve();});});
}
async function speak(text){
  if(!text)return;
  if(TTS_MODE!=='gemini'){
    try { await speakLocal(text); return; }
    catch(e){ console.warn('[VOICE TTS] Local TTS failed:',e.message); if(!TTS_GEMINI_FALLBACK)return; }
  }
  try { await speakGemini(text); }
  catch(e){ console.warn('[VOICE TTS] Gemini TTS failed:',e.message); }
}
async function sendText(text){const r=await fetch(`${VOICE_URL}/voice`,{method:'POST',headers:{'Content-Type':'application/json','x-jarvis-voice-token':TOKEN},body:JSON.stringify({guildId:GUILD_ID,userId:USER_ID,text})}); const data=await r.json().catch(()=>({})); if(!r.ok||!data.ok) throw new Error(data.error||`Voice request failed (${r.status})`); return String(data.text||'');}
async function handle(file){busy=true; try{const text=await transcribe(file); if(!text){await speak('I did not catch that.');return;} console.log(`[VOICE] You: ${text}`); const reply=await sendText(text); console.log(`[VOICE] JARVIS: ${reply}`); if(reply) await speak(reply.replace(/\*\*/g,'').replace(/<@!?\d+>/g,'').slice(0,2500));}catch(e){console.error('[VOICE]',e.message); try{await speak(`I couldn't process that: ${e.message}`)}catch{}} finally{busy=false;try{fs.unlinkSync(file)}catch{}}}
(async()=>{micDevice=await findMic(); console.log(`[VOICE] Microphone: ${micDevice}`); console.log('[VOICE] Hold Right Ctrl to speak. Release to send.'); const key=psKeyWatcher(); let down=false; key.stdout.setEncoding('utf8'); key.stdout.on('data',async chunk=>{for(const line of chunk.split(/\r?\n/)){if(line==='DOWN'&&!down){down=true;startRecording();}else if(line==='UP'&&down){down=false;const file=await stopRecording();if(file&&fs.existsSync(file)&&fs.statSync(file).size>44) await handle(file);}}}); process.on('SIGINT',()=>{try{key.kill()}catch{};process.exit(0)});process.on('SIGTERM',()=>{try{key.kill()}catch{};process.exit(0)});})().catch(e=>{console.error('[VOICE STARTUP]',e.message);process.exit(1);});
