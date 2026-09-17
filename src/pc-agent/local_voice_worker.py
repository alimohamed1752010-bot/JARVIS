import json
import os
import sys
import time
import traceback
from contextlib import redirect_stdout
from pathlib import Path

STT_MODEL = os.getenv('JARVIS_LOCAL_STT_MODEL', 'base.en').strip()
STT_DEVICE = os.getenv('JARVIS_STT_DEVICE', 'cpu').strip().lower()
STT_COMPUTE = os.getenv('JARVIS_STT_COMPUTE_TYPE', 'int8').strip()
TTS_VOICE = os.getenv('JARVIS_LOCAL_TTS_VOICE', 'bm_george').strip()
TTS_SPEED = float(os.getenv('JARVIS_LOCAL_TTS_SPEED', '1.05'))
OUT_DIR = Path(os.getenv('JARVIS_LOCAL_VOICE_TMP', str(Path.cwd() / 'tmp' / 'voice')))
OUT_DIR.mkdir(parents=True, exist_ok=True)

whisper_model = None
kokoro_pipeline = None


def eprint(*args):
    print(*args, file=sys.stderr, flush=True)


def load_stt():
    global whisper_model
    if whisper_model is not None:
        return whisper_model
    with redirect_stdout(sys.stderr):
        from faster_whisper import WhisperModel
    eprint(f'[LOCAL STT] Loading faster-whisper model={STT_MODEL} device={STT_DEVICE} compute={STT_COMPUTE}')
    try:
        with redirect_stdout(sys.stderr):
            if STT_DEVICE == 'cuda':
                whisper_model = WhisperModel(STT_MODEL, device='cuda', compute_type=STT_COMPUTE or 'float16')
            else:
                whisper_model = WhisperModel(STT_MODEL, device='cpu', compute_type=STT_COMPUTE or 'int8')
    except Exception as exc:
        if STT_DEVICE != 'cpu':
            eprint(f'[LOCAL STT] GPU load failed: {exc}. Falling back to CPU.')
            with redirect_stdout(sys.stderr):
                whisper_model = WhisperModel(STT_MODEL, device='cpu', compute_type='int8')
        else:
            raise
    eprint('[LOCAL STT] Ready.')
    return whisper_model


def load_tts():
    global kokoro_pipeline
    if kokoro_pipeline is not None:
        return kokoro_pipeline
    with redirect_stdout(sys.stderr):
        from kokoro import KPipeline
    eprint(f'[LOCAL TTS] Loading Kokoro voice={TTS_VOICE}')
    with redirect_stdout(sys.stderr):
        kokoro_pipeline = KPipeline(lang_code='b')
    eprint('[LOCAL TTS] Ready.')
    return kokoro_pipeline


def transcribe(audio_path):
    model = load_stt()
    segments, info = model.transcribe(
        str(audio_path),
        beam_size=10,
        best_of=10,
        temperature=0,
        language='en',
        vad_filter=True,
        vad_parameters={'min_silence_duration_ms': 520, 'speech_pad_ms': 260, 'min_speech_duration_ms': 100},
        condition_on_previous_text=False,
        compression_ratio_threshold=2.4,
        log_prob_threshold=-1.0,
        no_speech_threshold=0.55,
        initial_prompt='Jarvis. JARVIS. Time out Oraby. Time out, Oraby. Timeout Oraby. Timeout, Oraby. Oraby. Time out Malik. Timeout Malik. Open Spotify. Close Spotify. Open Twitch. Close Twitch. Play. Pause. Resume. Set volume. Turn the volume up. Turn the volume down. Open an app. Close an app.'
    )
    text = ' '.join(seg.text.strip() for seg in segments).strip()
    return {'text': text, 'language': getattr(info, 'language', None)}


def synthesize(text):
    pipeline = load_tts()
    import soundfile as sf
    out = OUT_DIR / f'tts-{int(time.time() * 1000)}.wav'
    # Kokoro can yield more than one chunk. For JARVIS responses we keep them short,
    # but concatenate all chunks so longer useful answers still work.
    wrote = False
    with sf.SoundFile(out, mode='w', samplerate=24000, channels=1, subtype='PCM_16') as wav:
        for _, _, audio in pipeline(text, voice=TTS_VOICE, speed=TTS_SPEED):
            wav.write(audio)
            wrote = True
    if not wrote:
        raise RuntimeError('Kokoro returned no audio.')
    return {'path': str(out)}


def main():
    eprint('[LOCAL VOICE] Worker online.')
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
            op = req.get('op')
            if op == 'transcribe':
                result = transcribe(req['file'])
            elif op == 'speak':
                result = synthesize(str(req.get('text', '')).strip())
            elif op == 'health':
                result = {'ok': True, 'sttModel': STT_MODEL, 'sttDevice': STT_DEVICE, 'ttsVoice': TTS_VOICE}
            elif op == 'warmup':
                load_stt()
                load_tts()
                result = {'ready': True, 'sttModel': STT_MODEL, 'sttDevice': STT_DEVICE, 'ttsVoice': TTS_VOICE}
            elif op == 'shutdown':
                print(json.dumps({'ok': True}), flush=True)
                break
            else:
                raise ValueError(f'Unknown local voice operation: {op}')
            print(json.dumps({'ok': True, **result}), flush=True)
        except Exception as exc:
            eprint('[LOCAL VOICE ERROR]', repr(exc))
            traceback.print_exc(file=sys.stderr)
            print(json.dumps({'ok': False, 'error': str(exc)}), flush=True)


if __name__ == '__main__':
    main()
