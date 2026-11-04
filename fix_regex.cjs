const fs = require('fs');

let content = fs.readFileSync('e:\\ap\\streempuls\\backend\\worker.js', 'utf-8');

// Fix regex patterns that had backslashes doubled during template literal conversion
// These patterns need single backslashes, not doubled

// Fix bitrate, fps, drop regex patterns
content = content.replace(/raw\\.match\\(\\/bitrate=\\\\\\\\s\\*\\\\([0-9.]+kbits\\\\\\\\\\\\/s\\)\\)/g, 'raw.match(/bitrate=\\\\s*([0-9.]+kbits\\/s)/)');
content = content.replace(/raw\\.match\\(\\/fps=\\\\\\\\s\\*\\\\([0-9.]+\)\\)/g, 'raw.match(/fps=\\\\s*([0-9.]+)/)');
content = content.replace(/raw\\.match\\(\\/drop=\\\\\\\\s\\*\\\\([0-9]+\)\\)/g, 'raw.match(/drop=\\\\s*([0-9]+)/)');

// Fix URL regex pattern
content = content.replace(/\\\\\\/\\//g, '/');

// Fix storage path regex patterns  
content = content.replace(/\\\\\\/v1\\\\/object\\\\/(?:public|sign|authenticated)\\\\/[^/]+\\\\\\/(.+)$/g, '/v1/object/(?:public|sign|authenticated)/[^/]+/($1)');

// Write back
fs.writeFileSync('e:\\ap\\streempuls\\backend\\worker.js', content);
console.log('Regex fixes applied');