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
    require.resolve('@snazzah/davey');
    return true;
  } catch {
    return false;
  }
}

function status() {
  let node = process.versions.node;
  return {
    enabled: isEnabled(),
    available: isVoiceAvailable(),
    ready: isEnabled() && isVoiceAvailable(),
    node,
    nodeSupported: Number(node.split('.')[0]) >= 22 && Number(node.split('.')[0]) > 22 || (Number(node.split('.')[0]) === 22 && Number(node.split('.')[1]) >= 12),
    voicePackage: getPackageVersion('@discordjs/voice'),
    daveyPackage: getPackageVersion('@snazzah/davey')
  };
}

function getPackageVersion(name) {
  try { return require(`${name}/package.json`).version; } catch { return 'missing'; }
}

function getVoice() {
  if (!isVoiceAvailable()) {
    throw new Error('Voice dependencies are missing. V9 voice requires @discordjs/voice 0.19.2+ and @snazzah/davey. Redeploy with a fresh npm install.');
  }
  if (!voiceModule) voiceModule = require('@discordjs/voice');
  return voiceModule;
}

async function waitForReady(connection, timeoutMs = 20000) {
  const voice = getVoice();
  if (connection.state.status === voice.VoiceConnectionStatus.Ready) return connection;

  try {
    return await voice.entersState(connection, voice.VoiceConnectionStatus.Ready, timeoutMs);
  } catch (error) {
    const state = connection.state?.status || 'unknown';
    throw new Error(`Discord voice did not reach READY within ${timeoutMs}ms (state: ${state}). ${error?.message || ''}`.trim());
  }
}

async function join(channel) {
  if (!isEnabled()) throw new Error('Voice is disabled. Set VOICE_ENABLED=true in Railway variables and redeploy.');
  const voice = getVoice();
  if (!channel?.guild?.voiceAdapterCreator) throw new Error('This channel is not a valid Discord voice channel.');

  // Discord voice can occasionally race during the signalling/server-update phase.
  // Retry with a fresh connection rather than leaving JARVIS stuck in signalling.
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt++) {
    let connection;
    try {
      connection = voice.joinVoiceChannel({
        channelId: channel.id,
        guildId: channel.guild.id,
        adapterCreator: channel.guild.voiceAdapterCreator,
        selfDeaf: false,
        selfMute: false,
        debug: true,
        daveEncryption: true
      });

      connection.on('error', error => console.error(`[VOICE CONNECTION ${channel.guild.id}]`, error));
      connection.on('debug', message => console.log(`[VOICE DEBUG ${channel.guild.id}] ${message}`));
      connection.on('stateChange', (oldState, newState) => {
        console.log(`[VOICE STATE ${channel.guild.id}] ${oldState.status} -> ${newState.status}`);
      });

      await waitForReady(connection, 20000);
      console.log(`[VOICE] Connected to ${channel.name} on attempt ${attempt}.`);
      return connection;
    } catch (error) {
      lastError = error;
      console.error(`[VOICE] Join attempt ${attempt}/3 failed:`, error);
      try { connection?.destroy(); } catch {}
      if (attempt < 3) await new Promise(resolve => setTimeout(resolve, 1500 * attempt));
    }
  }

  throw new Error(`Voice startup failed after 3 attempts: ${lastError?.message || lastError}`);
}

async function speakText(connection, text) {
  if (!isEnabled()) throw new Error('Voice is disabled. Set VOICE_ENABLED=true in Railway variables and redeploy.');
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
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName } } }
    }
  });

  const data = response.candidates?.[0]?.content?.parts?.find(p => p.inlineData?.data)?.inlineData?.data;
  if (!data) throw new Error(`TTS returned no audio from model ${model}.`);

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
  child.on('close', code => { if (code !== 0) console.error(`[VOICE FFMPEG] exited ${code}: ${stderr.trim()}`); });
  child.stdin.end(input);

  const pcm = new PassThrough();
  child.stdout.pipe(pcm);
  const player = voice.createAudioPlayer({ behaviors: { noSubscriber: voice.NoSubscriberBehavior.Play } });
  player.on('error', error => console.error('[VOICE PLAYER ERROR]', error));
  player.on(voice.AudioPlayerStatus.Playing, () => console.log('[VOICE PLAYER] playing'));
  player.on(voice.AudioPlayerStatus.Idle, () => console.log('[VOICE PLAYER] finished'));

  connection.subscribe(player);
  player.play(voice.createAudioResource(pcm, { inputType: voice.StreamType.Raw, inlineVolume: false }));
  return player;
}

module.exports = { status, join, speakText, waitForReady };
