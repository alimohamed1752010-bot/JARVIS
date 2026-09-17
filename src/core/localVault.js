const fs = require('node:fs');
const path = require('node:path');

const VAULT_ROOT = path.resolve(process.env.JARVIS_VAULT_PATH || path.join(__dirname, '..', '..', 'vault'));
const MAX_FILE_BYTES = 160000;
const MAX_RESULTS = 5;
const STOP_WORDS = new Set('the a an and or to for of in on my me you your jarvis can could would please open launch start run get what is are was were this that with from into about tell show do does did how why where when'.split(/\s+/));

function ensureVault() {
  const dirs = ['', 'user', 'projects', 'instructions', 'memory', 'knowledge'];
  for (const dir of dirs) fs.mkdirSync(path.join(VAULT_ROOT, dir), { recursive: true });
  const index = path.join(VAULT_ROOT, 'VAULT_INDEX.md');
  if (!fs.existsSync(index)) {
    fs.writeFileSync(index, `# JARVIS Vault Index\n\nThis vault is local, user-controlled memory and instructions. Read only the files relevant to the current request.\n\n## User\n- user/profile.md - User identity and durable preferences.\n- user/preferences.md - Interaction and PC preferences.\n\n## Projects\n- projects/jarvis.md - JARVIS architecture, versions, goals and known issues.\n\n## Instructions\n- instructions/pc.md - PC control procedures and safety rules.\n- instructions/spotify.md - Spotify playback/control procedures.\n\n## Memory\n- memory/recent.md - Recent durable events worth retaining.\n\n## Knowledge\n- knowledge/ - User-maintained reference notes.\n`, 'utf8');
  }
  const defaults = {
    'user/profile.md': '# User Profile\n\nAdd only information you want JARVIS to remember.\n',
    'user/preferences.md': '# Preferences\n\nAdd durable interaction and PC preferences here.\n',
    'projects/jarvis.md': '# JARVIS Project\n\nJARVIS is a unified Discord + Windows PC assistant. Keep architecture notes, goals and known bugs here.\n',
    'instructions/pc.md': '# PC Control\n\nPrefer deterministic allowlisted tools for simple actions. Use AI planning only for ambiguous or multi-domain tasks. Never invent installed apps, paths or URLs.\n',
    'instructions/spotify.md': '# Spotify\n\nSimple playback controls should use deterministic PC tools. Track playback should resolve the requested track and verify the result when possible.\n',
    'memory/recent.md': '# Recent Memory\n\nJARVIS V20 uses a local-first router and local TTS by default.\n'
  };
  for (const [rel, text] of Object.entries(defaults)) {
    const file = path.join(VAULT_ROOT, rel);
    if (!fs.existsSync(file)) fs.writeFileSync(file, text, 'utf8');
  }
}

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) out.push(full);
  }
  return out;
}

function tokens(text) {
  return [...new Set(String(text || '').toLowerCase().replace(/[^a-z0-9_\- ]/g, ' ').split(/\s+/).filter(x => x.length > 2 && !STOP_WORDS.has(x)))];
}

function score(content, queryTokens) {
  const text = content.toLowerCase();
  let total = 0;
  for (const token of queryTokens) {
    if (text.includes(token)) total += token.length >= 6 ? 3 : 1;
  }
  return total;
}

function readIndex() {
  ensureVault();
  return fs.readFileSync(path.join(VAULT_ROOT, 'VAULT_INDEX.md'), 'utf8').slice(0, 12000);
}

function retrieve(query, { maxResults = MAX_RESULTS, maxChars = 12000 } = {}) {
  ensureVault();
  const q = tokens(query);
  const files = walk(VAULT_ROOT).filter(file => path.basename(file) !== 'VAULT_INDEX.md');
  const ranked = [];
  for (const file of files) {
    try {
      const stat = fs.statSync(file);
      if (stat.size > MAX_FILE_BYTES) continue;
      const content = fs.readFileSync(file, 'utf8');
      const s = score(content + ' ' + file, q);
      if (s > 0) ranked.push({ file, score: s, content });
    } catch {}
  }
  ranked.sort((a, b) => b.score - a.score || a.file.localeCompare(b.file));
  let used = 0;
  const chunks = [];
  for (const item of ranked.slice(0, maxResults)) {
    const rel = path.relative(VAULT_ROOT, item.file).replace(/\\/g, '/');
    const body = item.content.slice(0, Math.max(500, Math.min(5000, maxChars - used)));
    if (!body) continue;
    chunks.push(`FILE: ${rel}\n${body}`);
    used += body.length + rel.length + 10;
    if (used >= maxChars) break;
  }
  return { index: readIndex(), files: chunks, root: VAULT_ROOT };
}

function contextFor(query, options = {}) {
  const result = retrieve(query, options);
  const files = result.files.length ? `\n\nRELEVANT LOCAL VAULT FILES:\n${result.files.join('\n\n---\n\n')}` : '';
  return `LOCAL VAULT INDEX:\n${result.index}${files}`;
}

module.exports = { VAULT_ROOT, ensureVault, readIndex, retrieve, contextFor };
