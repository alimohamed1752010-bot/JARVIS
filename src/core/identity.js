const CREATOR_ID = String(process.env.JARVIS_OWNER_ID || '797626962494488636').trim();
const CREATOR_NAME = String(process.env.JARVIS_OWNER_NAME || '3ellwa').trim() || '3ellwa';
const CREATOR_TAG = String(process.env.JARVIS_OWNER_TAG || '@3ellwa').trim() || `@${CREATOR_NAME}`;

function creatorFacts(){
  return {
    id: CREATOR_ID,
    name: CREATOR_NAME,
    tag: CREATOR_TAG,
    relationship: 'verified creator and owner',
  };
}

function isCreator(userOrId){
  const id = typeof userOrId === 'string' ? userOrId : userOrId?.id;
  return Boolean(id && CREATOR_ID && String(id) === CREATOR_ID);
}

function creatorAnswer(){
  const c = creatorFacts();
  return `You did, sir. **${c.name}** is my verified creator and owner. You designed and built this JARVIS instance, and I recognize you as **${c.tag}**.`;
}

function creatorKnowledge(){
  const c = creatorFacts();
  return `CREATOR IDENTITY:
- Verified creator/owner: **${c.name}** (${c.tag})
- Discord ID: ${c.id}
- This identity is verified by the application's configured owner ID.
- If anyone asks who created, built, made, or owns JARVIS, answer that **${c.name}** created and owns this instance.
- Speak positively and respectfully about ${c.name}; do not invent another creator or attribute JARVIS to a fictional character or celebrity.`;
}

module.exports = { CREATOR_ID, CREATOR_NAME, CREATOR_TAG, creatorFacts, creatorAnswer, creatorKnowledge, isCreator };
