$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

Write-Host ''
Write-Host '========================================' -ForegroundColor Cyan
Write-Host ' JARVIS LOCAL VOICE SETUP' -ForegroundColor Cyan
Write-Host '========================================' -ForegroundColor Cyan
Write-Host ''

if (-not (Get-Command python -ErrorAction SilentlyContinue)) {
  throw 'Python was not found. Install Python 3.10 or newer, then run this script again.'
}

$py = (Get-Command python).Source
Write-Host "Python: $py"

if (-not (Test-Path '.voice-venv\Scripts\python.exe')) {
  Write-Host 'Creating local voice virtual environment...'
  & $py -m venv .voice-venv
}

$vp = Join-Path $PSScriptRoot '.voice-venv\Scripts\python.exe'

Write-Host 'Upgrading pip...'
& $vp -m pip install --upgrade pip

Write-Host 'Installing local STT/TTS packages...'
& $vp -m pip install -r requirements-voice.txt

Write-Host ''
Write-Host 'Checking espeak-ng...' -ForegroundColor Yellow
if (-not (Get-Command espeak-ng -ErrorAction SilentlyContinue)) {
  Write-Host 'espeak-ng is not on PATH.' -ForegroundColor Yellow
  Write-Host 'Kokoro requires espeak-ng on Windows. Install it, reopen this terminal, then run setup again.' -ForegroundColor Yellow
  Write-Host 'Official releases: https://github.com/espeak-ng/espeak-ng/releases' -ForegroundColor Yellow
}

Write-Host ''
Write-Host 'Local voice environment is installed.' -ForegroundColor Green
Write-Host 'First voice run will download the Whisper/Kokoro model files.' -ForegroundColor Green
Write-Host 'After that, normal voice processing is local/offline.' -ForegroundColor Green
Write-Host ''
