const { PassThrough } = require('node:stream');
const { spawn } = require('node:child_process');

let voiceModule = null;

function isEnabled() {
  return String(process.env.VOICE_ENABLED || 'false').toLowerCase() === 'true';
}

function isVoiceAvailable() {
  try {
    require.resolve('@discordjs/voice');
    require.resolve('ffmpeg-static');
    return true;
  } catch {
    return false;
  }
}

function status() {
  return {
    enabled: isEnabled(),
    available: isVoiceAvailable(),
    ready: isEnabled() && isVoiceAvailable()
  };
}

function getVoice() {
  if (!isVoiceAvailable()) {
    throw new Error('Voice dependencies are not installed. Run npm install and redeploy.');
  }
  if (!voiceModule) voiceModule = require('@discordjs/voice');
  return voiceModule;
}

async function waitForReady(connection, timeoutMs = 15000) {
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
    const onDisconnected = () => {
      cleanup();
      reject(new Error(`Discord voice connection disconnected while connecting (state: ${connection.state.status}).`));
    };
    timer = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting for Discord voice connection. Current state: ${connection.state.status}.`));
    }, timeoutMs);
    connection.once(voice.VoiceConnectionStatus.Ready, onReady);
    connection.once(voice.VoiceConnectionStatus.Disconnected, onDisconnected);
  });

  return connection;
}

async function join(channel) {
  if (!isEnabled()) throw new Error('Voice is disabled. Set VOICE_ENABLED=true in your Railway variables and redeploy.');

  const voice = getVoice();
  if (!channel?.guild?.voiceAdapterCreator) throw new Error('This channel is not a valid Discord voice channel.');

  const connection = voice.joinVoiceChannel({
    channelId: channel.id,
    guildId: channel.guild.id,
    adapterCreator: channel.guild.voiceAdapterCreator,
    selfDeaf: false,
    selfMute: false
  });

  connection.on('error', error => console.error(`[VOICE CONNECTION ${channel.guild.id}]`, error));
  connection.on(voice.VoiceConnectionStatus.Disconnected, () => {
    console.warn(`[VOICE ${channel.guild.id}] Discord voice connection disconnected.`);
  });

  await waitForReady(connection);
  return connection;
}

async function speakText(connection, text) {
  if (!isEnabled()) throw new Error('Voice is disabled. Set VOICE_ENABLED=true in your Railway variables and redeploy.');
  if (!connection) throw new Error('No active voice connection. Use `jarvis voice` first.');

  const { GoogleGenAI } = await import('@google/genai');
  const voice = getVoice();
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY is missing.');

  const ai = new GoogleGenAI({ apiKey });
  const model = process.env.GEMINI_TTS_MODEL || 'gemini-2.5-flash-preview-tts';
  const voiceName = process.env.JARVIS_TTS_VOICE || 'Kore';

  console.log(`[VOICE TTS] model=${model} voice=${voiceName}`);

  const response = await ai.models.generateContent({
    model,
    contents: [{ parts: [{ text: String(text).slice(0, 3000) }] }],
    config: {
      responseModalities: ['AUDIO'],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: { voiceName }
        }
      }
    }
  });

  const data = response.candidates?.[0]?.content?.parts?.find(p => p.inlineData?.data)?.inlineData?.data;
  if (!data) {
    console.error('[VOICE TTS] Gemini response contained no inline audio:', JSON.stringify(response).slice(0, 2000));
    throw new Error(`TTS returned no audio from model ${model}.`);
  }

  const ffmpeg = require('ffmpeg-static');
  const input = Buffer.from(data, 'base64');
  const child = spawn(ffmpeg, [
    '-hide_banner', '-loglevel', 'error',
    '-f', 's16le', '-ar', '24000', '-ac', '1', '-i', 'pipe:0',
    '-f', 's16le', '-ar', '48000', '-ac', '2', 'pipe:1'
  ], { stdio: ['pipe', 'pipe', 'pipe'] });

  let stderr = '';
  child.stderr.on('data', chunk => { stderr += chunk.toString(); });
  child.on('error', error => console.error('[VOICE FFMPEG SPAWN ERROR]', error));
  child.on('close', code => {
    if (code !== 0) console.error(`[VOICE FFMPEG] exited with code ${code}: ${stderr.trim()}`);
  });

  child.stdin.end(input);

  const pcm = new PassThrough();
  child.stdout.pipe(pcm);

  const player = voice.createAudioPlayer({
    behaviors: { noSubscriber: voice.NoSubscriberBehavior.Play }
  });

  player.on('error', error => console.error('[VOICE PLAYER ERROR]', error));
  player.on(voice.AudioPlayerStatus.Playing, () => console.log('[VOICE PLAYER] playing'));
  player.on(voice.AudioPlayerStatus.Idle, () => console.log('[VOICE PLAYER] finished'));

  connection.subscribe(player);
  player.play(voice.createAudioResource(pcm, { inputType: voice.StreamType.Raw, inlineVolume: false }));

  return player;
}

module.exports = { status, join, speakText, waitForReady };
