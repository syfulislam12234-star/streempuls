const fs = require('fs');

let content = fs.readFileSync('e:\\ap\\streempuls\\backend\\worker.js', 'utf-8');

// Fix regex patterns that had backslashes doubled by the previous conversion
// The issue: \\\\ should be \\ in regex patterns

// Fix common regex patterns - replace doubled backslashes in regex contexts
// Pattern: /something\\// should be /something\
let fixed = content
  // Fix /^\\\\// to /^/
  .replace(/\\\\\\/\\/g, '/')
  .replace(/\\\\\\/\\/g, '/')
  
// Actually, let me take a more targeted approach - fix specific known problem areas

// Fix line 212 area: videoUrl.replace patterns
fixed = fixed.replace(
  /videoUrl\.replace\(\(['"]\\^\\(stream-assets\\|live-stream-assets\\)\\\\\\/\\1['"]\\), ['"]\\\\\\/+, ''\\)/g,
  "videoUrl.replace(/^(stream-assets|live-stream-assets)\\/, '').replace(/^\\/+/, '')"
);

// Fix the URL regex pattern
fixed = fixed.replace(
  /\\\\\\/\\/g,
  '/'
);

// Write back
fs.writeFileSync('e:\\ap\\streempuls\\backend\\worker.js', fixed);
console.log('Regex fixes applied');