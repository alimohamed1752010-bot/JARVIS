require('dotenv').config();
const WebSocket = require('ws');
const pc = require('../core/pcTools');

const URL = String(process.env.JARVIS_PC_URL || '').trim();
const TOKEN = String(process.env.JARVIS_PC_TOKEN || '').trim();
if (!URL || !TOKEN) {
  console.error('JARVIS_PC_URL and JARVIS_PC_TOKEN are required.');
  process.exit(1);
}

let stopped = false;
function connect() {
  if (stopped) return;
  const ws = new WebSocket(`${URL.replace(/\/$/, '')}?token=${encodeURIComponent(TOKEN)}`, { handshakeTimeout: 10000 });
  ws.on('open', () => console.log('[JARVIS PC] Connected to Railway.'));
  ws.on('message', async raw => {
    let msg; try { msg = JSON.parse(String(raw)); } catch { return; }
    if (msg.type !== 'execute') return;
    try {
      const result = await execute(msg.action, msg.step || {});
      ws.send(JSON.stringify({ type: 'result', id: msg.id, ok: true, result }));
    } catch (e) {
      ws.send(JSON.stringify({ type: 'result', id: msg.id, ok: false, error: String(e?.message || e).slice(0, 1500) }));
    }
  });
  ws.on('close', () => { if (!stopped) { console.log('[JARVIS PC] Disconnected. Retrying in 3s...'); setTimeout(connect, 3000); } });
  ws.on('error', err => console.warn('[JARVIS PC] Connection:', err.message));
}

async function execute(action, step) {
  if (action === 'pc_open_app') { const details=await pc.openApp(step.name, step.targets || []); return { text:`Opened ${step.name}.`, details }; }
  if (action === 'pc_close_app') return { text: await pc.closeApp(step.name) };
  if (action === 'pc_processes') return { text: await pc.listProcesses() };
  if (action === 'pc_system_status') { const details=await pc.systemStatus(); return { text: JSON.stringify(details), details }; }
  if (action === 'pc_active_window') { const details=await pc.activeWindow(); return { text: JSON.stringify(details), details }; }
  if (action === 'pc_network_status') { const details=await pc.networkStatus(); return { text: JSON.stringify(details), details }; }
  if (action === 'pc_state') return { text: 'PC state collected.', details: await pc.pcState() };
  if (action === 'pc_volume') return { text: await pc.setVolume(step.durationMs) };
  if (action === 'pc_key') return { text: `Sent ${step.name}.`, details: await pc.key(step.name) };
  if (action === 'pc_hotkey') return { text: `Pressed ${step.name}.`, details: await pc.hotkey(step.name) };
  if (action === 'pc_mouse') return { text: `Clicked ${step.name}.`, details: await pc.mouse(step.name) };
  if (action === 'pc_type') return { text: 'Typed text.', details: await pc.typeText(step.reason) };
  if (action === 'pc_screenshot') return { text: `Screenshot saved to ${await pc.screenshot(step.name)}` };
  if (action === 'pc_open_url') return { text: await pc.openUrl(step.name, step.reason || 'brave') };
  if (action === 'pc_spotify_play') return { text: await pc.spotifyPlay(step.name) };
  if (action === 'pc_spotify_control') return { text: await pc.spotifyControl(step.name || 'toggle') };
  if (action === 'pc_browser_search') { const r=await pc.browserSearch(step.name, step.reason || 'brave'); return { text:r.text || `Opened YouTube search for ${step.name}.`, details:r.details }; }
  if (action.startsWith('pc_file_')) return { text: await pc.fileAction(action.replace('pc_file_', ''), step.name, step.reason) };
  if (action === 'pc_shell') return { text: await pc.shell(step.reason) };
  throw new Error(`Unsupported PC action: ${action}`);
}

process.on('SIGINT', () => { stopped = true; process.exit(0); });
process.on('SIGTERM', () => { stopped = true; process.exit(0); });
connect();
