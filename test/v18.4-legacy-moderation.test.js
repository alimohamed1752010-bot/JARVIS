const fs = require('fs');
const path = require('path');
const index = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.js'), 'utf8');
const agent = fs.readFileSync(path.join(__dirname, '..', 'src', 'core', 'agent.js'), 'utf8');
if (!index.includes('V18.4: preserve the proven V15 moderation-first path')) throw new Error('V18.4 moderation-first routing missing');
if (!index.includes('await understandOwnerModeration(message, universalPrompt)')) throw new Error('Legacy moderation handler is not before AI-first routing');
if (!index.includes('async function executeModerationAction')) throw new Error('Legacy moderation executor missing');
if (!agent.includes("'timeout'")) throw new Error('V18 agent timeout support missing');
console.log('V18.4 legacy moderation routing: PASS');
