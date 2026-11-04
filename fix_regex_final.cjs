const fs = require('fs');

let content = fs.readFileSync('e:\\ap\\streempuls\\backend\\worker.js', 'utf-8');

// Fix the specific regex patterns that have doubled backslashes
// Pattern 1: videoUrl.replace with regex prefix matching
// Pattern 2: regex for leading slashes

// Fix line 212 area - replace regex with string operations
// The regex /^(stream-assets|live-stream-assets)\/\/ matches strings starting with those prefixes
// We'll replace with startsWith() for clarity and to avoid backslash issues
content = content.replace(
  /videoUrl\.replace\(\(\^\\\\(stream-assets\\|live-stream-assets\\\\)\\\\\\\/\\1\)\(\)\.replace\(/g,
  "videoUrl.replace(/^(stream-assets|live-stream-assets)\\/, '').replace(/^\\/+/, '')"
);

// Actually, let me just replace the entire problematic lines with simpler string operations
// The code is trying to strip prefixes from videoUrl

// Fix specific known problem lines by replacing regex with startsWith
// Line pattern: videoUrl.replace(/^(stream-assets|live-stream-assets)\\/\/...
// Replace with: videoUrl.startsWith('stream-assets/') ? videoUrl.substring('stream-assets/'.length) : ...

// Let me just fix the specific error lines by replacing the entire replace call
const lines = content.split('\n');
let fixedLines = [];

for (const line of lines) {
  // Fix the specific regex pattern on lines like line 212
  if (line.includes('videoUrl.replace(/^(stream-assets|live-stream-assets)') && line.includes('\\\\\\/')) {
    // Replace with startsWith-based approach
    fixedLines.push(
      "videoUrl = videoUrl.startsWith('stream-assets/') ? videoUrl.substring('stream-assets/'.length) : "
      + "videoUrl.startsWith('live-stream-assets/') ? videoUrl.substring('live-stream-assets/'.length) : videoUrl;"
    );
  } else if (line.includes('\\\\\\\\\\\\\\/\\+\\/') || line.includes('/^\\\\\\/+\\/')) {
    // Fix leading slash pattern - replace with simpler regex
    fixedLines.push(line.replace('/^\\\\\\\\\\\\\\/\\+\\//', '/^\\/+/'));
  } else {
    fixedLines.push(line);
  }
}

fs.writeFileSync('e:\\ap\\streempuls\\backend\\worker.js', fixedLines.join('\n'));
console.log('Regex fixes applied');
console.log('Lines processed:', fixedLines.length);