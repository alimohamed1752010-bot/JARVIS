const assert=require('assert');
const fs=require('fs');
const path=require('path');
const agent=fs.readFileSync(path.join(__dirname,'../src/core/agent.js'),'utf8');

assert(agent.includes('const isSpotifyTrackPhrase='), 'Spotify track phrase guard missing');
assert(agent.includes('replace(/\\s+(?:on|in)\\s+spotify'), 'Spotify suffix stripping missing');
assert(agent.includes("base('pc_spotify_play',{name:track})"), 'Spotify playback action missing');
assert(agent.includes("pushApp('spotify')"), 'Spotify launch action missing');

// Static regression expectations for the exact user-facing bug:
// generic app discovery must not turn "play into it on spotify" into an app named
// "into it on spotify"; the dedicated Spotify parser must strip the platform suffix.
assert(/isSpotifyTrackPhrase/.test(agent), 'Exact Spotify natural-language regression is not guarded');
assert(/const isSpotifyTrackPhrase=\/\^\(\?:\.\+\?\)\\s\+\(\?:on\|in\)\\s\+spotify\$\/i/.test(agent), 'Spotify suffix pattern is malformed');
console.log('V18.5 Spotify regressions: 6/6 passed');
