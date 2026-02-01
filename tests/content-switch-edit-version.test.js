/* eslint-env node */
/* global require */
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');

const content = readFileSync('content.js', 'utf8');

assert.ok(content.includes('SWITCH_EDIT_VERSION'));
assert.ok(content.includes('handleSwitchEditVersion'));
assert.ok(content.includes('findVersionControls'));
