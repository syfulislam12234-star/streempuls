// Fix doubled backslashes in regex patterns from template literal conversion
const fs = require('fs');
let content = fs.readFileSync('e:\\ap\\streempuls\\backend\\worker.js', 'utf-8');

// Fix regex patterns - replace doubled backslashes with single backslashes in regex contexts
// These patterns should have single backslashes, not doubled

// Fix line 212: videoUrl.replace patterns  
content = content.replace(
  /videoUrl\.replace\(\(\^\\\\(stream-assets\\|live-stream-assets\\)\\\\\\\/\\1\)\.replace\(\^\\\\\\\\\\\/+, ''\)/g,
  "videoUrl.replace(/^(stream-assets|live-stream-assets)\\/, '').replace(/^\\/+/, '')"
);

// Fix URL regex on line 230
content = content.replace(
  /\\\\\\/\\//g,
  '/'
);

// Fix storage path regex on lines 239-240  
content = content.replace(
  /\\\\\\/v1\\\\\\/object\\\\\\/(?:public|sign|authenticated)\\\\/[^/]+\\\\\\\\\\\\\\//g,
  '/v1/object/(?:public|sign|authenticated)/[^/]+/'
);

// Fix bitrate regex on line 576  
content = content.replace(
  /\\\\\\/s\\\\\\\\\\\\\)/g,
  '/s/'
);

// Fix fps and drop regex  
content = content.replace(
  /\\\\\\\\\\\\\)/g,
  ')'
);

// Write back
fs.writeFileSync('e:\\ap\\streempuls\\backend\\worker.js', content);
console.log('Regex fixes applied');