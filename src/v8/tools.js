function safeMath(input) {
  const raw = String(input || '').trim().replace(/,/g, '');
  const expression = raw
    .replace(/^(?:what(?:'s|s)?\s+(?:is\s+)?|calculate\s+|compute\s+)/i, '')
    .trim();
  if (!expression) return null;

  // Tokenize only numbers and the supported arithmetic operators. No eval.
  const tokens = expression.match(/-?(?:\d+(?:\.\d+)?|\.\d+)|(?:\*\*|[+\-*/x×÷%^])/gi);
  if (!tokens || tokens.join('') !== expression.replace(/\s+/g, '')) return null;
  if (tokens.length < 3 || tokens.length % 2 === 0) return null;

  const values = [];
  const operators = [];
  const precedence = op => (op === '^' || op === '**') ? 3 : (op === '*' || op === 'x' || op === '×' || op === '/' || op === '÷' || op === '%') ? 2 : 1;
  const apply = () => {
    const op = operators.pop();
    const b = values.pop(); const a = values.pop();
    if (a === undefined || b === undefined) throw new Error('invalid expression');
    let r;
    if (['*','x','×'].includes(op)) r = a * b;
    else if (['+'].includes(op)) r = a + b;
    else if (['-'].includes(op)) r = a - b;
    else if (['/','÷'].includes(op)) { if (b === 0) throw new Error('division by zero'); r = a / b; }
    else if (op === '%') { if (b === 0) throw new Error('division by zero'); r = a % b; }
    else if (['^','**'].includes(op)) r = a ** b;
    if (!Number.isFinite(r)) throw new Error('non-finite result');
    values.push(r);
  };

  try {
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];
      if (/^-?(?:\d+(?:\.\d+)?|\.\d+)$/.test(token)) {
        values.push(Number(token));
      } else {
        const op = token.toLowerCase();
        while (operators.length && precedence(operators[operators.length - 1]) >= precedence(op) && op !== '^' && op !== '**') apply();
        operators.push(op);
      }
    }
    while (operators.length) apply();
    if (values.length !== 1) return null;
    const result = values[0];
    return Number.isInteger(result) ? String(result) : String(Number(result.toFixed(10)));
  } catch { return null; }
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
    return { handled: true, text: `**JARVIS V9 STATUS**\n• Discord: **ONLINE**\n• Server: **${message.guild.name}**\n• Members: **${message.guild.memberCount}**\n• Channels: **${message.guild.channels.cache.size}**\n• AI: **${process.env.AI_ENABLED === 'false' ? 'OFFLINE' : 'READY'}**`, tool: 'server-status' };
  }
  return { handled: false };
}

module.exports = { runToolRequest, safeMath };
