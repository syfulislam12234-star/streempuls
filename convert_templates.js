const fs = require('fs');

let content = fs.readFileSync('e:\\ap\\streempuls\\backend\\worker.js', 'utf-8');

// Replace template literals with string concatenation
// Pattern: match backtick strings with ${} expressions and convert to quoted string + variable concatenation

// First, escape backslashes to preserve them
let escaped = content.replace(/\\/g, '\\\\');

// Then replace template literals with ${} expressions
let result = escaped.replace(/`([^]*)\${([^}]+)}([^]*)`/g, "'$1' + $2 + '$3'");

// Replace remaining standalone template literals (no ${})
result = result.replace(/`([^]*)`/g, "'$1'");

// Write back to file
fs.writeFileSync('e:\\ap\\streempuls\\backend\\worker.js', result);

console.log('Template literal conversion complete');
console.log('Lines in file:', require('fs').readFileSync('e:\\ap\\streempuls\\backend\\worker.js', 'utf-8').split('\n').length);