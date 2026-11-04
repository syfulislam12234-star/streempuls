const fs = require('fs');

let content = fs.readFileSync('e:\\ap\\streempuls\\backend\\worker.js', 'utf-8');

// Read the file and fix regex patterns line by line using string operations
const lines = content.split('\n');
let fixedLines = [];

for (const line of lines) {
  // Fix line 212: videoUrl.replace patterns with doubled backslashes
  if (line.includes('videoUrl.replace(/^(stream-assets|live-stream-assets)') && line.includes('\\\\\\/')) {
    // Replace doubled backslash with single backslash in regex
    fixedLines.push(line.replace('/^(stream-assets|live-stream-assets)\\\\/', '/^(stream-assets|live-stream-assets)\\/').replace('/^\\\\\\/+\\/,' '/^\\/+\\/'));
  } else if (line.includes('\\\\\\/v1\\\\\\/object') && line.includes('\\\\\\\\\\\\')) {
    // Fix storage path regex
    fixedLines.push(line.replace('\\\\\\/v1\\\\\\/object', '/v1/object').replace('\\\\\\\\\\\\\\/', '/[^/]+/'));
  } else if (line.includes('raw.match(/bitrate=') && line.includes('\\\\\\\\\\\\')) {
    // Fix bitrate regex
    fixedLines.push(line.replace('\\\\\\\\\\\\\\s', '\\\\s').replace('\\\\\\\\\\\\/s\\\\\\\\', '/s/'));
  } else if (line.includes('raw.match(/fps=') && line.includes('\\\\\\\\\\\\')) {
    // Fix fps regex
    fixedLines.push(line.replace('\\\\\\\\\\\\\\s', '\\\\s').replace('\\\\\\\\\\\\\\)', ')'));
  } else if (line.includes('raw.match(/drop=') && line.includes('\\\\\\\\\\\\')) {
    // Fix drop regex
    fixedLines.push(line.replace('\\\\\\\\\\\\\\s', '\\\\s').replace('\\\\\\\\\\\\\\)', ')'));
  } else {
    fixedLines.push(line);
  }
}

fs.writeFileSync('e:\\ap\\streempuls\\backend\\worker.js', fixedLines.join('\n'));
console.log('Fixed ' + fixedLines.length + ' lines');