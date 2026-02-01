/* eslint-env node */
/* global require */
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');

const panel = readFileSync('panel.js', 'utf8');
const html = readFileSync('panel.html', 'utf8');

assert.ok(panel.includes('card-version-control'));
assert.ok(panel.includes('version-arrow'));
assert.ok(html.includes('.card-version-control'));
