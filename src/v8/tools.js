function safeMath(input) {
  const raw = String(input || '').trim().replace(/,/g, '');
  const m = raw.match(/(?:what\s+is\s+|calculate\s+|compute\s+)?(-?\d+(?:\.\d+)?)\s*(\+|-|\*|x|×|\/|÷|%|\^|minus|plus|times)\s*(-?\d+(?:\.\d+)?)/i);
  if (!m) return null;
  const a = Number(m[1]); const b = Number(m[3]); const op = m[2].toLowerCase();
  let result;
  if (['*','x','×','times'].includes(op)) result = a*b;
  else if (['+','plus'].includes(op)) result = a+b;
  else if (['-','minus'].includes(op)) result = a-b;
  else if (['/','÷'].includes(op)) result = b === 0 ? null : a/b;
  else if (op === '%') result = b === 0 ? null : a%b;
  else if (op === '^') result = a**b;
  if (!Number.isFinite(result)) return null;
  return Number.isInteger(result) ? String(result) : String(Number(result.toFixed(10)));
}

function localTime() {
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Cairo', dateStyle: 'full', timeStyle: 'long' }).format(new Date());
}

async function runToolRequest(message, input) {
  const text = String(input || '').trim();
  const math = safeMath(text);
  if (math !== null) return { handled: true, text: `**${math}, sir.**`, tool: 'calculator' };
  if (/\b(?:what time|time is it|current time|date is it|today(?:'s)? date)\b/i.test(text)) {
    return { handled: true, text: `It is **${localTime()}**, sir.`, tool: 'clock' };
  }
  if (/\b(?:server status|system status|jarvis status)\b/i.test(text)) {
    return { handled: true, text: `**JARVIS V8 STATUS**\n• Discord: **ONLINE**\n• Server: **${message.guild.name}**\n• Members: **${message.guild.memberCount}**\n• Channels: **${message.guild.channels.cache.size}**\n• AI: **${process.env.AI_ENABLED === 'false' ? 'OFFLINE' : 'READY'}**`, tool: 'server-status' };
  }
  return { handled: false };
}

module.exports = { runToolRequest, safeMath };
