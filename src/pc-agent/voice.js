require('dotenv').config();

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const readline = require('node:readline');
const { spawn } = require('node:child_process');
const ffmpeg = require('ffmpeg-static');
const pcTools = require('../core/pcTools');

// ============================================================
// JARVIS V20.9 LOCAL VOICE CLIENT
// - Keeps the working V19 Right-Ctrl + FFmpeg recorder.
// - Local faster-whisper STT.
// - Local Kokoro TTS.
// - Gemini is NOT used for routine voice transcription/speech.
// - Full JARVIS execution output stays in the console/log.
// - Voice receives a short, human confirmation instead.
// ============================================================

const TOKEN = String(process.env.JARVIS_PC_TOKEN || '').trim();
const GUILD_ID = String(process.env.JARVIS_VOICE_GUILD_ID || '').trim();
const USER_ID = String(process.env.JARVIS_VOICE_USER_ID || '').trim();
const RAW_URL = String(process.env.JARVIS_PC_URL || '').trim();
const VOICE_URL = String(
  process.env.JARVIS_VOICE_URL ||
    RAW_URL
      .replace(/^wss:/i, 'https:')
      .replace(/^ws:/i, 'http:')
).replace(/\/+$/, '');

const TMP = path.join(os.tmpdir(), 'jarvis-voice');
fs.mkdirSync(TMP, { recursive: true });

if (!TOKEN || !GUILD_ID || !USER_ID || !VOICE_URL) {
  console.error('[VOICE STARTUP] Missing required environment variables.');
  console.error('Required: JARVIS_PC_TOKEN, JARVIS_VOICE_GUILD_ID, JARVIS_VOICE_USER_ID, JARVIS_PC_URL');
  process.exit(1);
}

// ============================================================
// LOCAL VOICE WORKER
// ============================================================

function localPythonPath() {
  const configured = String(process.env.JARVIS_VOICE_PYTHON || '').trim();
  if (configured) return configured;

  const local = path.join(__dirname, '..', '..', '.voice-venv', 'Scripts', 'python.exe');
  if (fs.existsSync(local)) return local;

  return process.platform === 'win32' ? 'python' : 'python3';
}

class LocalVoiceWorker {
  constructor() {
    this.proc = null;
    this.buffer = '';
    this.pending = [];
    this.started = false;
  }

  start() {
    if (this.proc) return;

    const python = localPythonPath();
    const script = path.join(__dirname, 'local_voice_worker.py');

    if (!fs.existsSync(script)) {
      throw new Error(`Local voice worker is missing: ${script}`);
    }

    console.log(`[LOCAL VOICE] Starting worker: ${python}`);

    this.proc = spawn(python, ['-u', script], {
      cwd: path.join(__dirname, '..', '..'),
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: process.env
    });

    this.proc.stdout.setEncoding('utf8');
    this.proc.stderr.setEncoding('utf8');

    this.proc.stdout.on('data', chunk => {
      this.buffer += chunk;
      let index;
      while ((index = this.buffer.indexOf('\n')) !== -1) {
        const line = this.buffer.slice(0, index).trim();
        this.buffer = this.buffer.slice(index + 1);
        if (!line) continue;

        let message;
        try {
          message = JSON.parse(line);
        } catch {
          console.warn('[LOCAL VOICE] Invalid worker response:', line);
          continue;
        }

        const pending = this.pending.shift();
        if (pending) {
          if (message.ok) pending.resolve(message);
          else pending.reject(new Error(message.error || 'Local voice worker failed.'));
        }
      }
    });

    this.proc.stderr.on('data', chunk => {
      const text = String(chunk).trim();
      if (text) console.log(text);
    });

    this.proc.on('error', error => {
      console.error('[LOCAL VOICE WORKER ERROR]', error.message);
      while (this.pending.length) this.pending.shift().reject(error);
    });

    this.proc.on('close', code => {
      console.log(`[LOCAL VOICE] Worker exited with code ${code}`);
      const error = new Error(`Local voice worker exited with code ${code}.`);
      while (this.pending.length) this.pending.shift().reject(error);
      this.proc = null;
    });

    this.started = true;
  }

  request(payload) {
    this.start();

    return new Promise((resolve, reject) => {
      this.pending.push({ resolve, reject });
      try {
        this.proc.stdin.write(`${JSON.stringify(payload)}\n`);
      } catch (error) {
        this.pending = this.pending.filter(x => x.resolve !== resolve);
        reject(error);
      }
    });
  }

  async warmup() {
    console.log('[LOCAL VOICE] Warming up STT + TTS models...');
    await this.request({ op: 'warmup' });
    console.log('[LOCAL VOICE] STT + TTS ready.');
  }

  async transcribe(file) {
    const result = await this.request({ op: 'transcribe', file });
    return String(result.text || '').trim();
  }

  async speak(text) {
    const result = await this.request({ op: 'speak', text: String(text || '').trim() });
    return result.path;
  }

  shutdown() {
    if (!this.proc) return;
    try { this.proc.stdin.write(JSON.stringify({ op: 'shutdown' }) + '\n'); } catch {}
    setTimeout(() => {
      try { this.proc.kill(); } catch {}
    }, 500);
  }
}

const localVoice = new LocalVoiceWorker();

// ============================================================
// WINDOWS KEY WATCHER
// ============================================================

function psKeyWatcher() {
  const script = `
Add-Type @'
using System;
using System.Runtime.InteropServices;

public static class Keyboard {
    [DllImport("user32.dll")]
    public static extern short GetAsyncKeyState(int vKey);
}
'@

$wasDown = $false

while ($true) {
    $state = [Keyboard]::GetAsyncKeyState(0xA3)
    $isDown = (($state -band 0x8000) -ne 0)

    if ($isDown -and -not $wasDown) {
        [Console]::WriteLine("DOWN")
        [Console]::Out.Flush()
    }

    if (-not $isDown -and $wasDown) {
        [Console]::WriteLine("UP")
        [Console]::Out.Flush()
    }

    $wasDown = $isDown
    Start-Sleep -Milliseconds 20
}
`;

  console.log('[VOICE] Starting keyboard watcher...');

  const ps = spawn(
    'powershell.exe',
    [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-Command',
      script
    ],
    { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }
  );

  ps.stdout.setEncoding('utf8');
  ps.stderr.setEncoding('utf8');

  ps.stderr.on('data', data => {
    const message = data.toString().trim();
    if (message) console.warn('[VOICE KEY]', message);
  });

  ps.on('error', error => console.error('[VOICE KEY ERROR]', error.message));

  ps.on('close', code => console.log(`[VOICE KEY] watcher exited with code ${code}`));

  return ps;
}

// ============================================================
// MICROPHONE DISCOVERY
// ============================================================

async function findMic() {
  if (process.env.JARVIS_MIC_DEVICE) return String(process.env.JARVIS_MIC_DEVICE);

  return new Promise((resolve, reject) => {
    console.log('[VOICE] Detecting microphone...');

    const p = spawn(
      ffmpeg,
      ['-hide_banner', '-list_devices', 'true', '-f', 'dshow', '-i', 'dummy'],
      { windowsHide: true }
    );

    let output = '';
    p.stderr.on('data', data => { output += data.toString(); });

    p.on('close', () => {
      const matches = [...output.matchAll(/"([^"]+)"\s+\(audio\)/gi)].map(match => match[1]);
      if (matches[0]) resolve(matches[0]);
      else reject(new Error('No Windows microphone was detected by FFmpeg. Set JARVIS_MIC_DEVICE to your microphone device name.'));
    });
  });
}

// ============================================================
// RECORDING STATE
// ============================================================

let micDevice = null;
let recorder = null;
let recordingPath = null;
let speechProcess = null;
let speechGeneration = 0;
let commandGeneration = 0;

function startRecording() {
  if (recorder) {
    console.log('[VOICE] Recorder already running.');
    return;
  }

  recordingPath = path.join(TMP, `jarvis-${Date.now()}.wav`);

  console.log(`[VOICE] Starting recording: ${recordingPath}`);

  recorder = spawn(
    ffmpeg,
    [
      '-hide_banner',
      '-loglevel',
      'error',
      '-f',
      'dshow',
      '-i',
      `audio=${micDevice}`,
      '-ac',
      '1',
      '-ar',
      '16000',
      '-y',
      recordingPath
    ],
    { windowsHide: true, stdio: ['pipe', 'ignore', 'pipe'] }
  );

  recorder.stderr.on('data', data => {
    const message = data.toString().trim();
    if (message) console.warn('[VOICE REC]', message);
  });

  recorder.on('error', error => console.error('[VOICE REC ERROR]', error.message));

  recorder.on('close', (code, signal) => {
    console.log(`[VOICE REC] ffmpeg exited. code=${code} signal=${signal || 'none'}`);
  });

  console.log('[VOICE] Recording... release Right Ctrl when done.');
}

function stopRecording() {
  if (!recorder) {
    console.warn('[VOICE] stopRecording() called but no recorder exists.');
    return Promise.resolve(null);
  }

  const currentRecorder = recorder;
  recorder = null;

  console.log('[VOICE] Stopping recording cleanly...');

  return new Promise(resolve => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      console.log(`[VOICE] Recording saved: ${recordingPath}`);
      resolve(recordingPath);
    };

    currentRecorder.once('close', finish);

    try {
      currentRecorder.stdin.write('q');
    } catch (error) {
      console.warn('[VOICE] Clean ffmpeg stop failed:', error.message);
      try { currentRecorder.kill('SIGINT'); } catch { try { currentRecorder.kill(); } catch {} }
    }

    setTimeout(finish, 3000);
  });
}

// ============================================================
// SPEECH RESPONSE FILTER
// ============================================================

function cleanPlain(text) {
  return String(text || '')
    .replace(/```[\s\S]*?```/g, '')
    .replace(/\*\*/g, '')
    .replace(/__+/g, '')
    .replace(/<@!?(\d+)>/g, '')
    .replace(/`/g, '')
    .replace(/^\s*[-*•]\s*/gm, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function speechForExecution(log) {
  const raw = String(log || '');
  const lines = raw.split(/\r?\n/).map(x => x.trim()).filter(Boolean);

  const successLines = lines
    .filter(line => /^(?:✓|✔|\u2713)/.test(line))
    .map(line => line.replace(/^(?:✓|✔|\u2713)\s*\d*\.?\s*/i, '').trim())
    .filter(Boolean);

  const failureLines = lines
    .filter(line => /^(?:✗|❌|\u2717)/.test(line))
    .map(line => line.replace(/^(?:✗|❌|\u2717)\s*\d*\.?\s*/i, '').trim())
    .filter(Boolean);

  if (successLines.length) {
    const normalized = [];
    for (const item of successLines) {
      const key = item.toLowerCase().replace(/[.!?]+$/, '');
      if (!normalized.some(x => x.toLowerCase().replace(/[.!?]+$/, '') === key)) normalized.push(item);
    }

    // Human voice should not recite an internal execution report.
    if (normalized.length === 1) return ensureSentence(normalized[0]);
    if (normalized.length <= 3) return ensureSentence(normalized.join(' '));
    return 'Done.';
  }

  if (failureLines.length) {
    const first = failureLines[0];
    if (/^failed\b/i.test(first)) return ensureSentence(first);
    return ensureSentence(`Failed. ${first}`);
  }

  const compact = cleanPlain(raw)
    .replace(/^JARVIS\s+V\d+(?:\.\d+)*\s+EXECUTION\s*/i, '')
    .replace(/^\d+\/\d+\s+step\(s\)\s+completed[^.]*\.?/i, '')
    .trim();

  if (!compact) return 'I did not receive a response from JARVIS.';

  // Avoid speaking an internal report/header even when the server format changes slightly.
  const firstUseful = compact.split(/(?<=[.!?])\s+/)[0].trim();
  return ensureSentence(firstUseful.slice(0, 300));
}

function ensureSentence(text) {
  const t = cleanPlain(text);
  if (!t) return 'I did not receive a response from JARVIS.';
  return /[.!?]$/.test(t) ? t : `${t}.`;
}

function normalizeStt(text) {
  let value = String(text || '').replace(/\s+/g, ' ').trim();
  if (!value) return '';

  // Small/en can turn the proper name "Oraby" into phrases such as
  // "or I'll be" when it appears after "timeout". Correct only that
  // very specific command-shaped ambiguity, rather than globally rewriting speech.
  value = value.replace(
    /\btime\s+out\s+(?:or\s+i(?:'|’)ll\s+be|or\s+ill\s+be|or\s+i\s+ll\s+be|or\s+a\s+be|or\s+abi)\b/gi,
    'timeout Oraby'
  );
  value = value.replace(
    /\btime\s+or\s+(?:i(?:'|’)ll\s+be|ill\s+be|i\s+ll\s+be)\b/gi,
    'timeout Oraby'
  );
  value = value.replace(
    /\btime(?:d)?\s+out\s+oraby\b/gi,
    'timeout Oraby'
  );
  value = value.replace(
    /\b(?:time|timed)\s+out\s+or\s+abi\b/gi,
    'timeout Oraby'
  );
  value = value.replace(
    /\b(?:time|timed)\s+or\s+(?:a\s+be|aby|abie|oraby)\b/gi,
    'timeout Oraby'
  );
  value = value.replace(
    /\b(?:timeout|time\s+out)\s+(?:or\s+i(?:'|’)ll\s+be|or\s+ill\s+be|or\s+abi|or\s+a\s+be)\b/gi,
    'timeout Oraby'
  );

  // Common wake-word hallucination from short recordings.
  // Whisper sometimes inserts punctuation after `time` or hears Spotify as
  // `Spotify Premium`. Normalize only command-shaped phrases.
  value = value.replace(/\btime[.!?,]?\s+(oraby|or\s+abi|a\s+be)\s+out\b/gi, 'timeout Oraby');
  value = value.replace(/\b(?:open|launch|start|close|quit|exit)\s+spotify\s+premium\b/gi, match => match.replace(/spotify\s+premium/i, 'Spotify'));

  // Common wake-word hallucination from short recordings.
  value = value.replace(/^(?:service|serious|jarvis\s*\.)\s+(?=(?:time|timed)\s+out\b)/i, 'Jarvis, ');
  return value.trim();
}

// ============================================================
// SEND TO JARVIS
// ============================================================

async function sendText(text) {
  console.log('[VOICE] Sending command to JARVIS...');

  const response = await fetch(`${VOICE_URL}/voice`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-jarvis-voice-token': TOKEN
    },
    body: JSON.stringify({
      guildId: GUILD_ID,
      userId: USER_ID,
      text
    })
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok || !data.ok) {
    throw new Error(data.error || `Voice request failed (${response.status})`);
  }

  return {
    text: String(data.text || ''),
    speech: String(data.speechText || '').trim()
  };
}

// ============================================================
// LOCAL AUDIO PLAYBACK + PC FALLBACK
// ============================================================

async function stopSpeech(reason = 'interrupted') {
  speechGeneration += 1;
  const current = speechProcess;
  speechProcess = null;
  if (!current) return;
  console.log(`[VOICE TTS] Stopping speech: ${reason}`);
  try { current.kill(); } catch {}
}

async function playWav(file, generation) {
  if (!file || !fs.existsSync(file)) throw new Error(`TTS audio file not found: ${file}`);
  if (process.platform !== 'win32') throw new Error('JARVIS local voice playback currently requires Windows.');
  const escaped = String(file).replace(/'/g, "''");
  await new Promise((resolve, reject) => {
    if (generation !== speechGeneration) return resolve();
    const ps = spawn('powershell.exe', [
      '-NoLogo','-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-Command',
      `$p='${escaped}'; $player=New-Object System.Media.SoundPlayer($p); $player.Load(); $player.PlaySync()`
    ], { windowsHide: true, stdio: ['ignore','ignore','pipe'] });
    speechProcess = ps;
    let err='';
    ps.stderr.on('data', d => { err += String(d); });
    ps.once('error', error => {
      if (speechProcess === ps) speechProcess = null;
      reject(error);
    });
    ps.once('close', code => {
      if (speechProcess === ps) speechProcess = null;
      if (generation !== speechGeneration) return resolve();
      if (code===0) resolve();
      else reject(new Error(err.trim() || `Audio playback failed (${code}).`));
    });
  });
}

async function speakLocal(text, commandId = commandGeneration) {
  const phrase = String(text || '').trim();
  if (commandId !== commandGeneration) return;
  if (!phrase) return;
  await stopSpeech('new response');
  const generation = speechGeneration;
  const wav = await localVoice.speak(phrase);
  if (commandId !== commandGeneration || generation !== speechGeneration) {
    try { if (wav && fs.existsSync(wav)) fs.unlinkSync(wav); } catch {}
    return;
  }
  console.log(`[VOICE TTS] Playing: ${wav}`);
  try {
    if (commandId !== commandGeneration || generation !== speechGeneration) return;
    await playWav(wav, generation);
  }
  catch (error) {
    if (generation === speechGeneration) throw error;
  }
  finally { try { if (wav && fs.existsSync(wav)) fs.unlinkSync(wav); } catch {} }
}

function normalizeVoiceTarget(value) {
  return String(value || '').trim().replace(/[.!?,;:]+$/g, '').trim();
}

async function localPcFallback(text) {
  const raw = String(text || '').replace(/^(?:(?:yo|hey|hi|ok|okay)\s+)?jarvis\b[,:!\s-]*/i,'').trim();
  const target = normalizeVoiceTarget(raw);
  if (!target) return null;

  const close = target.match(/^(?:close|quit|exit|shut\s+down)\s+(?:the\s+)?(.+?)(?:\s+(?:app|application|program|window))?$/i);
  if (close) {
    const name = normalizeVoiceTarget(close[1]);
    const knownWeb = new Set(['twitch','youtube','tiktok','instagram','facebook','gmail','reddit','google','x','twitter']);
    if (knownWeb.has(name.toLowerCase())) {
      try {
        const active = await pcTools.activeWindow();
        const proc = String(active?.Process || active?.process || '').toLowerCase();
        const title = String(active?.Title || active?.title || '').toLowerCase();
        if (proc.includes('brave') && title.includes(name.toLowerCase())) {
          await pcTools.hotkey('CTRL+W');
          return `Closed ${name}.`;
        }
        return `I can only close the ${name} tab when it is the active Brave tab.`;
      } catch (e) {
        return `I couldn't close ${name}. ${String(e?.message || e).slice(0,180)}`;
      }
    }
    try { return await pcTools.closeApp(name); }
    catch (e) { return String(e?.message || e).slice(0,260); }
  }

  const volume = target.match(/^(?:set\s+)?(?:the\s+)?volume\s+(?:to\s+)?(\d{1,3})\s*%?$/i);
  if (volume) {
    try { return await pcTools.setVolume(Number(volume[1])); }
    catch (e) { return String(e?.message || e).slice(0,220); }
  }

  if (/^(?:pause|resume|play|toggle)\s+(?:spotify|music)?$/i.test(target)) {
    const command = target.split(/\s+/i)[0].toLowerCase();
    try { return await pcTools.spotifyControl(command); }
    catch (e) { return String(e?.message || e).slice(0,220); }
  }

  const open = target.match(/^(?:open|launch|start|run)\s+(?:the\s+)?(.+)$/i);
  if (open) {
    const name=normalizeVoiceTarget(open[1]);
    const web={twitch:'https://www.twitch.tv/',youtube:'https://www.youtube.com/',tiktok:'https://www.tiktok.com/',instagram:'https://www.instagram.com/',google:'https://www.google.com/'};
    try {
      if (web[name.toLowerCase()]) return await pcTools.openUrl(web[name.toLowerCase()],'brave');
      await pcTools.openApp(name,[]);
      return `Opened ${name}.`;
    } catch (e) { return String(e?.message || e).slice(0,260); }
  }
  return null;
}

// ============================================================
// HANDLE COMPLETE COMMAND
// ============================================================

async function handle(file) {
  const commandId = commandGeneration;
  const canContinue = () => commandId === commandGeneration;
  try {
    console.log('[VOICE] Processing command...');

    const rawText = await localVoice.transcribe(file);
    if (!canContinue()) return;
    const text = normalizeStt(rawText);

    if (rawText !== text) console.log(`[VOICE] STT normalized: ${rawText} -> ${text}`);
    console.log(`[VOICE] STT result: ${text || '(empty)'}`);

    if (!text) {
      await speakLocal('I did not catch that.', commandId);
      return;
    }

    console.log(`[VOICE] You: ${text}`);

    // Execute simple PC-native voice commands locally first. This keeps voice
    // responsive even when the Railway agent is stale and prevents a desktop
    // action such as "close Spotify" from being turned into an unnecessary
    // server confirmation plan. Discord/moderation commands still go remotely.
    const localFirst = /^(?:(?:yo|hey|hi|ok|okay)\s+)?jarvis\b[,:!\s-]*/i.test(text)
      ? text.replace(/^(?:(?:yo|hey|hi|ok|okay)\s+)?jarvis\b[,:!\s-]*/i, '').trim()
      : text.trim();
    const isLocalPcCommand = /^(?:close|quit|exit|shut\s+down|open|launch|start|run)\s+(?:the\s+)?(?:spotify|twitch|youtube|tiktok|instagram|google|brave|discord|steam|notepad|calculator|explorer|code|chrome|edge|minecraft|modrinth|epic(?:\s+games)?(?:\s+launcher)?|\w+\s+app)\b/i.test(localFirst)
      || /^(?:set\s+)?(?:the\s+)?volume\s+(?:to\s+)?\d{1,3}\s*%?$/i.test(localFirst)
      || /^(?:pause|resume|play|toggle)(?:\s+(?:spotify|music))?$/i.test(localFirst);

    let result;
    if (isLocalPcCommand) {
      const localReply = await localPcFallback(text);
      if (localReply) result = { text: localReply, speechText: localReply };
    }
    if (!result) result = await sendText(text);

    let reply = result.text;
    if (!reply.trim()) {
      const localReply = await localPcFallback(text);
      if (localReply) reply = localReply;
    }

    // Full internal result stays in the log. It is deliberately NOT sent to TTS.
    console.log(`[VOICE] JARVIS LOG:\n${reply}`);

    const suppliedSpeech = String(result.speech || '').trim();
    const speech = /JARVIS\s+V\d+(?:\.\d+)*\s+(?:EXECUTION|PLAN)/i.test(suppliedSpeech)
      ? speechForExecution(suppliedSpeech)
      : (suppliedSpeech || speechForExecution(reply));
    console.log(`[VOICE] JARVIS SPEECH: ${speech}`);

    if (speech && canContinue()) await speakLocal(speech, commandId);
  } catch (error) {
    console.error('[VOICE ERROR]', error);

    try {
      await speakLocal(`I couldn't process that. ${error.message}`.slice(0, 260));
    } catch (ttsError) {
      console.error('[VOICE TTS ERROR]', ttsError.message);
    }
  } finally {
    try {
      if (file && fs.existsSync(file)) fs.unlinkSync(file);
    } catch {}
  }
}

// ============================================================
// MAIN
// ============================================================

(async () => {
  console.log('');
  console.log('========================================');
  console.log('       JARVIS VOICE CLIENT V20.9');
  console.log('========================================');
  console.log('');

  console.log('[VOICE] Local STT/TTS mode. Gemini is not used for routine voice.');

  if (String(process.env.JARVIS_LOCAL_VOICE_WARMUP || 'true').toLowerCase() === 'true') {
    await localVoice.warmup();
  }

  micDevice = await findMic();

  console.log(`[VOICE] Microphone: ${micDevice}`);
  console.log('[VOICE] Hold Right Ctrl to speak.');
  console.log('[VOICE] Release Right Ctrl to send.');
  console.log('');

  const key = psKeyWatcher();
  let down = false;

  key.stdout.setEncoding('utf8');

  key.stdout.on('data', async chunk => {
    const lines = chunk
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(Boolean);

    for (const line of lines) {
      console.log(`[VOICE KEY EVENT] ${line}`);

      if (line === 'DOWN' && !down) {
        down = true;
        commandGeneration += 1;
        console.log('[VOICE] Right Ctrl DOWN');
        // Push-to-talk also acts as a hard speech interrupt. Only one audio
        // stream is allowed at a time, so the assistant cannot talk over itself.
        await stopSpeech('user interrupted');
        startRecording();
      } else if (line === 'UP' && down) {
        down = false;
        console.log('[VOICE] Right Ctrl UP');

        const file = await stopRecording();

        if (file && fs.existsSync(file)) {
          const size = fs.statSync(file).size;
          console.log(`[VOICE] Recording size: ${size} bytes`);

          if (size > 44) {
            console.log('[VOICE] Recording complete. Processing locally...');
            await handle(file);
          } else {
            console.warn('[VOICE] Recording was empty.');
            try { fs.unlinkSync(file); } catch {}
          }
        } else {
          console.warn('[VOICE] Recording file does not exist.');
        }
      }
    }
  });

  key.on('error', error => console.error('[VOICE KEY ERROR]', error.message));

  const shutdown = () => {
    console.log('\n[VOICE] Shutting down...');
    try { key.kill(); } catch {}
    try { if (recorder) recorder.kill(); } catch {}
    try { stopSpeech('shutdown'); } catch {}
    localVoice.shutdown();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
})().catch(error => {
  console.error('[VOICE STARTUP]', error.message);
  process.exit(1);
});
