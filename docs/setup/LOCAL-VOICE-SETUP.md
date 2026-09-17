# JARVIS V20.2 Local Voice Setup

## 1. Keep the Railway credentials where they already belong

The standalone PC/voice client needs:

- `JARVIS_PC_URL`
- `JARVIS_PC_TOKEN`
- `JARVIS_VOICE_GUILD_ID`
- `JARVIS_VOICE_USER_ID`

It does **not** need `DISCORD_TOKEN`.

## 2. Install Node dependencies

From `C:\JARVIS`:

```bat
npm install
```

## 3. Install local STT/TTS

Open PowerShell in `C:\JARVIS` and run:

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\setup-local-voice.ps1
```

The setup creates `.voice-venv` and installs faster-whisper + Kokoro.

Kokoro on Windows also needs `espeak-ng`. Install it if `espeak-ng --version` does not work, then reopen the terminal and rerun the setup script.

## 4. Start the PC bridge

```bat
npm run pc
```

This connects the Windows PC agent to the JARVIS server on Railway.

## 5. Start voice

```bat
npm run voice
```

The first run warms the local models. The first model download is the only setup-time network-heavy step. After the models are cached, routine STT/TTS is local.

## 6. Test

Hold Right Ctrl and say:

- `Jarvis open Spotify`
- `Jarvis pause`
- `Jarvis play`
- `Jarvis set volume to 50`

The console keeps the detailed execution log. The speaker should only say the concise result, such as `Opened Spotify.`

## Optional voice configuration

```env
JARVIS_LOCAL_VOICE_WARMUP=true
JARVIS_LOCAL_STT_MODEL=base.en
JARVIS_STT_DEVICE=cpu
JARVIS_STT_COMPUTE_TYPE=int8
JARVIS_LOCAL_TTS_VOICE=bm_george
JARVIS_LOCAL_TTS_SPEED=1.05
```

If a working CUDA/cuDNN environment is already installed for CTranslate2, `JARVIS_STT_DEVICE=cuda` can be used. Otherwise leave it on CPU.
