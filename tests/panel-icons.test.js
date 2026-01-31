const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');

const panel = readFileSync('panel.js', 'utf8');

assert.ok(panel.includes('ICON_SVGS'));
assert.ok(panel.includes('<svg'));
