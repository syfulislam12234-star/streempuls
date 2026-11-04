const fs = require('fs');
let content = fs.readFileSync('e:\\ap\\streempuls\\backend\\worker.js', 'utf-8');

// Fix regex patterns that got doubled backslashes during template conversion
// Pattern 1: videoUrl.replace with regex
content = content.replace(
  /videoUrl\.replace\(\/\\^\\\\(stream-assets\\|live-stream-assets\\\\)\\\\\\\/\\1\)\.replace\\(\\^\\\\\\/+\\,\\'\\)/g,
  "videoUrl.replace(/^(stream-assets|live-stream-assets)\\/, '').replace(/^\\/+/, '')"
);

// Pattern 2: URL regex
content = content.replace(
  /\\\\\\/\\//g,
  '/'
);

// Pattern 3: storage path regex
content = content.replace(
  /\\\\\\/v1\\\\\\/object\\\\\\/(?:public|sign|authenticated)\\\\/[^/]+\\\\\\\\\\//g,
  '/v1/object/(?:public|sign|authenticated)/[^/]+/'
);

// Write back
fs.writeFileSync('e:\\ap\\streempuls\\backend\\worker.js', content);
console.log('Regex fixes applied');
"