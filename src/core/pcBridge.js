const crypto = require('node:crypto');
const { WebSocketServer } = require('ws');

let wss = null;
let server = null;
let socket = null;
const pending = new Map();

function start(httpServer) {
  if (!httpServer || wss) return;
  server = httpServer;
  wss = new WebSocketServer({ noServer: true, maxPayload: 256 * 1024 });
  httpServer.on('upgrade', (req, socketUpgrade, head) => {
    try {
      const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
      if (url.pathname !== '/pc') return;
      wss.handleUpgrade(req, socketUpgrade, head, ws => wss.emit('connection', ws, req));
    } catch { socketUpgrade.destroy(); }
  });
  wss.on('connection', (ws, req) => {
    const token = String(process.env.PC_AGENT_TOKEN || '').trim();
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const supplied = url.searchParams.get('token') || '';
    if (!token || supplied !== token) return ws.close(1008, 'Unauthorized');
    if (socket && socket.readyState === 1) socket.close(4000, 'Replaced by newer PC agent');
    socket = ws;
    console.log('[PC BRIDGE] PC agent connected');
    ws.send(JSON.stringify({ type: 'hello', id: crypto.randomUUID(), version: '17.0' }));
    ws.on('message', raw => {
      let msg; try { msg = JSON.parse(String(raw)); } catch { return; }
      if (!msg?.id || !pending.has(msg.id)) return;
      const item = pending.get(msg.id); pending.delete(msg.id); clearTimeout(item.timer);
      if (msg.ok) item.resolve(msg.result ?? { ok: true });
      else item.reject(new Error(String(msg.error || 'PC agent action failed')));
    });
    ws.on('close', () => {
      if (socket === ws) socket = null;
      console.log('[PC BRIDGE] PC agent disconnected');
      for (const [id, item] of pending) { clearTimeout(item.timer); item.reject(new Error('PC agent disconnected')); pending.delete(id); }
    });
    ws.on('error', err => console.warn('[PC BRIDGE] socket error:', err.message));
  });
}

function status() { return { connected: Boolean(socket && socket.readyState === 1) }; }

function execute(action, step, timeoutMs = 30000) {
  if (!socket || socket.readyState !== 1) return Promise.reject(new Error('PC agent is offline. Start JARVIS PC Agent on the Windows PC.'));
  const id = crypto.randomUUID();
  const payload = { type: 'execute', id, action: step.action, step: { ...step } };
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`PC action timed out after ${timeoutMs}ms.`)); }, timeoutMs);
    pending.set(id, { resolve, reject, timer });
    try { socket.send(JSON.stringify(payload)); } catch (e) { clearTimeout(timer); pending.delete(id); reject(e); }
  });
}

module.exports = { start, status, execute };
