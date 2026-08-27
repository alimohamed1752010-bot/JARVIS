const { PassThrough } = require('node:stream');
const { spawn } = require('node:child_process');

function isVoiceAvailable() {
  try { require.resolve('@discordjs/voice'); require.resolve('ffmpeg-static'); return true; } catch { return false; }
}
function status() {
  return { enabled: String(process.env.VOICE_ENABLED || 'false').toLowerCase() === 'true', available: isVoiceAvailable() };
}
function getVoice() {
  if (!isVoiceAvailable()) throw new Error('Voice dependencies are not installed.');
  return require('@discordjs/voice');
}
async function join(channel) {
  const voice = getVoice();
  return voice.joinVoiceChannel({ channelId: channel.id, guildId: channel.guild.id, adapterCreator: channel.guild.voiceAdapterCreator, selfDeaf: false });
}
async function speakText(connection, text) {
  const { GoogleGenAI } = await import('@google/genai');
  const voice = getVoice();
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  const response = await ai.models.generateContent({
    model: process.env.GEMINI_TTS_MODEL || 'gemini-3.1-flash-tts-preview',
    contents: [{ parts: [{ text: String(text).slice(0, 3000) }] }],
    config: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: process.env.JARVIS_TTS_VOICE || 'Kore' } } } }
  });
  const data = response.candidates?.[0]?.content?.parts?.find(p => p.inlineData)?.inlineData?.data;
  if (!data) throw new Error('TTS returned no audio.');

  const ffmpeg = require('ffmpeg-static');
  const input = Buffer.from(data, 'base64');
  const child = spawn(ffmpeg, ['-hide_banner','-loglevel','error','-f','s16le','-ar','24000','-ac','1','-i','pipe:0','-f','s16le','-ar','48000','-ac','2','pipe:1'], { stdio: ['pipe','pipe','pipe'] });
  child.stdin.end(input);
  const pcm = new PassThrough();
  child.stdout.pipe(pcm);
  const resource = voice.createAudioResource(pcm, { inputType: voice.StreamType.Raw });
  const player = voice.createAudioPlayer();
  connection.subscribe(player);
  player.play(resource);
  return player;
}
module.exports = { status, join, speakText };
