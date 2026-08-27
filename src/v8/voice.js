const { spawn } = require('node:child_process');

let voiceModule = null;
const states = new Map();

function isEnabled() {
  return String(process.env.VOICE_ENABLED || 'true').toLowerCase() === 'true';
}
function isVoiceAvailable() {
  try {
    require.resolve('@discordjs/voice');
    require.resolve('ffmpeg-static');
    return true;
  } catch { return false; }
}
function getVoice() {
  if (!isVoiceAvailable()) throw new Error('Voice dependencies are not installed.');
  if (!voiceModule) voiceModule = require('@discordjs/voice');
  return voiceModule;
}
function getState(guildId) { return states.get(guildId); }
function getConnection(guildId) { return states.get(guildId)?.connection || null; }
function status(guildId) {
  const state = guildId ? states.get(guildId) : null;
  const voice = isVoiceAvailable() ? getVoice() : null;
  return {
    enabled: isEnabled(),
    available: isVoiceAvailable(),
    connected: Boolean(state?.connection),
    ready: Boolean(state?.connection && voice && state.connection.state.status === voice.VoiceConnectionStatus.Ready),
    ttsEnabled: state?.ttsEnabled !== false,
    speaking: Boolean(state?.speaking),
    queue: state?.queue?.length || 0,
    voice: process.env.JARVIS_TTS_VOICE || 'Algenib',
    model: process.env.GEMINI_TTS_MODEL || 'gemini-2.5-flash-preview-tts',
    language: process.env.JARVIS_TTS_LANGUAGE || 'en-GB'
  };
}

async function waitForReady(connection, timeoutMs = 25000) {
  const voice = getVoice();
  if (connection.state.status === voice.VoiceConnectionStatus.Ready) return connection;
  await new Promise((resolve, reject) => {
    let timer;
    const cleanup = () => {
      clearTimeout(timer);
      connection.off(voice.VoiceConnectionStatus.Ready, onReady);
      connection.off(voice.VoiceConnectionStatus.Disconnected, onDisconnected);
    };
    const onReady = () => { cleanup(); resolve(); };
    const onDisconnected = () => { cleanup(); reject(new Error(`Discord voice disconnected while connecting (state: ${connection.state.status}).`)); };
    timer = setTimeout(() => { cleanup(); reject(new Error(`Timed out waiting for Discord voice connection. Current state: ${connection.state.status}.`)); }, timeoutMs);
    connection.once(voice.VoiceConnectionStatus.Ready, onReady);
    connection.once(voice.VoiceConnectionStatus.Disconnected, onDisconnected);
  });
  return connection;
}

async function makeTtsStream(text) {
  const { GoogleGenAI } = await import('@google/genai');
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY is missing.');
  const ai = new GoogleGenAI({ apiKey });
  const model = process.env.GEMINI_TTS_MODEL || 'gemini-2.5-flash-preview-tts';
  const voiceName = process.env.JARVIS_TTS_VOICE || 'Algenib';
  const language = process.env.JARVIS_TTS_LANGUAGE || 'en-GB';
  const prompt = [
    'Speak the transcript below as a mature British male AI butler.',
    'Use natural modern British English pronunciation, calm confidence, restrained warmth, crisp articulation, and measured pacing.',
    'Keep the delivery sophisticated and understated. Do not imitate any specific actor or copyrighted character performance.',
    `Language/accent: ${language}.`,
    '',
    'TRANSCRIPT:',
    String(text).slice(0, 3000)
  ].join('\n');
  const response = await ai.models.generateContent({
    model,
    contents: [{ parts: [{ text: prompt }] }],
    config: {
      responseModalities: ['AUDIO'],
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName } } }
    }
  });
  const data = response.candidates?.[0]?.content?.parts?.find(p => p.inlineData?.data)?.inlineData?.data;
  if (!data) throw new Error('TTS returned no audio.');
  const child = spawn(require('ffmpeg-static'), [
    '-hide_banner', '-loglevel', 'error',
    '-f', 's16le', '-ar', '24000', '-ac', '1', '-i', 'pipe:0',
    '-f', 's16le', '-ar', '48000', '-ac', '2', 'pipe:1'
  ], { stdio: ['pipe', 'pipe', 'pipe'] });
  child.stderr.on('data', b => console.error('[VOICE FFMPEG]', b.toString().trim()));
  child.on('error', e => console.error('[VOICE FFMPEG SPAWN]', e));
  child.stdin.end(Buffer.from(data, 'base64'));
  return child;
}

function ensurePlayer(guildId, connection) {
  const voice = getVoice();
  let state = states.get(guildId);
  if (state?.player) return state.player;
  const player = voice.createAudioPlayer({ behaviors: { noSubscriber: voice.NoSubscriberBehavior.Play } });
  state ||= { connection, player, queue: [], speaking: false, ttsEnabled: true };
  state.connection = connection;
  state.player = player;
  state.queue ||= [];
  state.ttsEnabled ??= true;
  player.on('error', error => {
    state.speaking = false;
    console.error(`[VOICE PLAYER ${guildId}]`, error);
    playNext(guildId).catch(e => console.error('[VOICE QUEUE]', e));
  });
  player.on(voice.AudioPlayerStatus.Playing, () => { state.speaking = true; console.log(`[VOICE TTS] playing guild=${guildId}`); });
  player.on(voice.AudioPlayerStatus.Idle, () => { state.speaking = false; console.log(`[VOICE TTS] finished guild=${guildId}`); playNext(guildId).catch(e => console.error('[VOICE QUEUE]', e)); });
  connection.subscribe(player);
  states.set(guildId, state);
  return player;
}

async function playNext(guildId) {
  const state = states.get(guildId);
  if (!state || state.speaking || !state.ttsEnabled || !state.queue.length) return;
  const text = state.queue.shift();
  try {
    const child = await makeTtsStream(text);
    const voice = getVoice();
    const resource = voice.createAudioResource(child.stdout, { inputType: voice.StreamType.Raw, inlineVolume: false });
    state.speaking = true;
    state.player.play(resource);
  } catch (e) {
    state.speaking = false;
    console.error(`[VOICE TTS ERROR ${guildId}]`, e);
    setImmediate(() => playNext(guildId));
  }
}

async function join(channel) {
  if (!isEnabled()) throw new Error('Voice is disabled. Set VOICE_ENABLED=true.');
  const voice = getVoice();
  const existing = states.get(channel.guild.id);
  if (existing?.connection && existing.connection.joinConfig?.channelId === channel.id) return existing.connection;
  if (existing?.connection) { try { existing.connection.destroy(); } catch {} }
  const connection = voice.joinVoiceChannel({
    channelId: channel.id,
    guildId: channel.guild.id,
    adapterCreator: channel.guild.voiceAdapterCreator,
    selfDeaf: true,
    selfMute: false
  });
  connection.on('error', e => console.error(`[VOICE CONNECTION ${channel.guild.id}]`, e));
  connection.on(voice.VoiceConnectionStatus.Disconnected, () => {
    console.warn(`[VOICE ${channel.guild.id}] disconnected`);
    const state = states.get(channel.guild.id);
    if (state) { state.speaking = false; state.connection = null; }
  });
  await waitForReady(connection);
  console.log(`[VOICE] READY guild=${channel.guild.id} channel=${channel.name}`);
  const state = states.get(channel.guild.id) || { connection, player: null, queue: [], speaking: false, ttsEnabled: true };
  state.connection = connection;
  state.ttsEnabled ??= true;
  states.set(channel.guild.id, state);
  ensurePlayer(channel.guild.id, connection);
  return connection;
}

async function speakText(connection, text) {
  if (!isEnabled()) return false;
  if (!connection) throw new Error('No active voice connection.');
  const guildId = connection.joinConfig?.guildId;
  if (!guildId) throw new Error('Voice connection has no guild ID.');
  const clean = String(text || '').replace(/<[^>]+>/g, '').replace(/```[\s\S]*?```/g, 'code omitted').trim();
  if (!clean) return false;
  const state = states.get(guildId) || { connection, player: null, queue: [], speaking: false, ttsEnabled: true };
  state.connection = connection;
  state.queue ||= [];
  state.ttsEnabled ??= true;
  states.set(guildId, state);
  ensurePlayer(guildId, connection);
  if (state.queue.length >= 20) state.queue.shift();
  state.queue.push(clean.slice(0, 3000));
  await playNext(guildId);
  return true;
}

function setTtsEnabled(guildId, enabled) {
  const state = states.get(guildId);
  if (state) state.ttsEnabled = Boolean(enabled);
  if (!enabled) stop(guildId, false);
  else playNext(guildId).catch(e => console.error('[VOICE QUEUE]', e));
  return Boolean(enabled);
}
function stop(guildId, clearQueue = true) {
  const state = states.get(guildId);
  if (!state?.player) return false;
  try { state.player.stop(true); } catch {}
  state.speaking = false;
  if (clearQueue) state.queue = [];
  return true;
}
function pause(guildId) { const state = states.get(guildId); return Boolean(state?.player?.pause()); }
function resume(guildId) { const state = states.get(guildId); return Boolean(state?.player?.unpause()); }
function leave(guildId) {
  const state = states.get(guildId);
  if (!state) return false;
  stop(guildId, true);
  try { state.connection?.destroy(); } catch {}
  states.delete(guildId);
  return true;
}

module.exports = { status, join, getConnection, speakText, waitForReady, setTtsEnabled, stop, pause, resume, leave };
