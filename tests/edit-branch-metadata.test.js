/* eslint-env node */
/* global require */
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');

const content = readFileSync('content.js', 'utf8');

assert.ok(content.includes('editVersionIndex: sibIndex'));
assert.ok(content.includes('totalVersions: sortedSiblings.length'));
assert.ok(content.includes('siblingIds: sortedSiblings.map'));
