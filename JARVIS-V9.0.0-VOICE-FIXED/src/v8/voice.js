const { PassThrough } = require('node:stream');
const { spawn } = require('node:child_process');
const prism = require('prism-media');

let voiceModule = null;
const listeners = new Map();

function isEnabled() { return String(process.env.VOICE_ENABLED || 'false').toLowerCase() === 'true'; }
function isVoiceAvailable() {
  try { require.resolve('@discordjs/voice'); require.resolve('ffmpeg-static'); require.resolve('prism-media'); return true; } catch { return false; }
}
function status() { return { enabled:isEnabled(), available:isVoiceAvailable(), ready:isEnabled()&&isVoiceAvailable() }; }
function getVoice() { if(!isVoiceAvailable()) throw new Error('Voice dependencies are not installed.'); if(!voiceModule) voiceModule=require('@discordjs/voice'); return voiceModule; }

async function waitForReady(connection, timeoutMs=20000) {
  const voice=getVoice();
  if(connection.state.status===voice.VoiceConnectionStatus.Ready) return connection;
  await new Promise((resolve,reject)=>{
    let timer;
    const cleanup=()=>{clearTimeout(timer); connection.off(voice.VoiceConnectionStatus.Ready,onReady); connection.off(voice.VoiceConnectionStatus.Disconnected,onDisconnected);};
    const onReady=()=>{cleanup();resolve();};
    const onDisconnected=()=>{cleanup();reject(new Error(`Discord voice disconnected while connecting (state: ${connection.state.status}).`));};
    timer=setTimeout(()=>{cleanup();reject(new Error(`Timed out waiting for Discord voice connection. Current state: ${connection.state.status}.`));},timeoutMs);
    connection.once(voice.VoiceConnectionStatus.Ready,onReady); connection.once(voice.VoiceConnectionStatus.Disconnected,onDisconnected);
  });
  return connection;
}

function pcmToWav(pcm, sampleRate=48000, channels=1) {
  const header=Buffer.alloc(44); const byteRate=sampleRate*channels*2; const blockAlign=channels*2;
  header.write('RIFF',0); header.writeUInt32LE(36+pcm.length,4); header.write('WAVE',8); header.write('fmt ',12); header.writeUInt32LE(16,16); header.writeUInt16LE(1,20); header.writeUInt16LE(channels,22); header.writeUInt32LE(sampleRate,24); header.writeUInt32LE(byteRate,28); header.writeUInt16LE(blockAlign,32); header.writeUInt16LE(16,34); header.write('data',36); header.writeUInt32LE(pcm.length,40); return Buffer.concat([header,pcm]);
}

async function transcribePcm(pcm) {
  const { GoogleGenAI }=await import('@google/genai'); const apiKey=process.env.GEMINI_API_KEY; if(!apiKey) throw new Error('GEMINI_API_KEY is missing.');
  const ai=new GoogleGenAI({apiKey}); const model=process.env.GEMINI_STT_MODEL||'gemini-2.5-flash';
  const wav=pcmToWav(pcm,48000,1);
  const response=await ai.models.generateContent({model,contents:[{parts:[{inlineData:{mimeType:'audio/wav',data:wav.toString('base64')}},{text:'Transcribe only the spoken words. Return plain text, no commentary. If there is no understandable speech, return an empty string.'}]}]});
  return String(response.text||'').trim();
}

function startListening(connection, guildId, onTranscript) {
  const voice=getVoice(); stopListening(guildId);
  const receiver=connection.receiver;
  const speaking=receiver.speaking;
  const handler=async userId=>{
    if(userId===connection.joinConfig?.guildId) return;
    const opus=receiver.subscribe(userId,{end:{behavior:voice.EndBehaviorType.AfterSilence,duration:Number(process.env.VOICE_SILENCE_MS||700)}});
    const decoder=new prism.opus.Decoder({frameSize:960,channels:1,rate:48000}); let chunks=[]; let bytes=0;
    opus.on('data',()=>{});
    opus.pipe(decoder);
    decoder.on('data',b=>{chunks.push(Buffer.from(b));bytes+=b.length; if(bytes>48000*2*15){try{opus.destroy();decoder.destroy();}catch{}}});
    const finish=async()=>{
      if(!chunks.length)return; const pcm=Buffer.concat(chunks);
      console.log(`[VOICE RX] captured ${pcm.length} bytes from ${userId}`);
      try { const text=await transcribePcm(pcm); if(text) { console.log(`[VOICE STT] ${userId}: ${text}`); await onTranscript({userId,text}); } }
      catch(e){console.error('[VOICE STT ERROR]',e);}
    };
    decoder.once('end',finish); decoder.once('error',e=>console.error('[VOICE DECODER ERROR]',e)); opus.on('error',e=>console.error('[VOICE OPUS ERROR]',e));
  };
  speaking.on('start',handler);
  listeners.set(guildId,{connection,handler});
  console.log(`[VOICE RX] listening enabled for guild ${guildId}`);
}
function stopListening(guildId){ const old=listeners.get(guildId); if(!old)return; try{old.connection.receiver.speaking.off('start',old.handler);}catch{} listeners.delete(guildId); }

async function join(channel,{onTranscript}={}) {
  if(!isEnabled()) throw new Error('Voice is disabled. Set VOICE_ENABLED=true.'); const voice=getVoice();
  const connection=voice.joinVoiceChannel({channelId:channel.id,guildId:channel.guild.id,adapterCreator:channel.guild.voiceAdapterCreator,selfDeaf:false,selfMute:false});
  connection.on('error',e=>console.error(`[VOICE CONNECTION ${channel.guild.id}]`,e));
  connection.on(voice.VoiceConnectionStatus.Disconnected,()=>{console.warn(`[VOICE ${channel.guild.id}] disconnected`); stopListening(channel.guild.id);});
  await waitForReady(connection); console.log(`[VOICE] READY ${channel.name}`);
  if(typeof onTranscript==='function') startListening(connection,channel.guild.id,onTranscript);
  return connection;
}

async function speakText(connection,text) {
  if(!isEnabled()) throw new Error('Voice is disabled.'); if(!connection) throw new Error('No active voice connection.'); const {GoogleGenAI}=await import('@google/genai'); const voice=getVoice(); const apiKey=process.env.GEMINI_API_KEY; if(!apiKey) throw new Error('GEMINI_API_KEY is missing.');
  const ai=new GoogleGenAI({apiKey}); const model=process.env.GEMINI_TTS_MODEL||'gemini-2.5-flash-preview-tts'; const voiceName=process.env.JARVIS_TTS_VOICE||'Kore';
  const response=await ai.models.generateContent({model,contents:[{parts:[{text:String(text).slice(0,3000)}]}],config:{responseModalities:['AUDIO'],speechConfig:{voiceConfig:{prebuiltVoiceConfig:{voiceName}}}}});
  const data=response.candidates?.[0]?.content?.parts?.find(p=>p.inlineData?.data)?.inlineData?.data; if(!data) throw new Error('TTS returned no audio.');
  const child=spawn(require('ffmpeg-static'),['-hide_banner','-loglevel','error','-f','s16le','-ar','24000','-ac','1','-i','pipe:0','-f','s16le','-ar','48000','-ac','2','pipe:1'],{stdio:['pipe','pipe','pipe']});
  child.stderr.on('data',b=>console.error('[VOICE FFMPEG]',b.toString().trim())); child.on('error',e=>console.error('[VOICE FFMPEG SPAWN]',e)); child.stdin.end(Buffer.from(data,'base64'));
  const player=voice.createAudioPlayer({behaviors:{noSubscriber:voice.NoSubscriberBehavior.Play}}); player.on('error',e=>console.error('[VOICE PLAYER ERROR]',e)); player.on(voice.AudioPlayerStatus.Playing,()=>console.log('[VOICE TTS] playing')); player.on(voice.AudioPlayerStatus.Idle,()=>console.log('[VOICE TTS] finished'));
  connection.subscribe(player); player.play(voice.createAudioResource(child.stdout,{inputType:voice.StreamType.Raw})); return player;
}
module.exports={status,join,speakText,waitForReady,startListening,stopListening};
