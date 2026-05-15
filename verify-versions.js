#!/usr/bin/env node
// verify-versions.js — Checks that all 3 files have the same CKRB version
// Usage: node verify-versions.js

const fs = require('fs');
const path = require('path');

const dir = __dirname;

const contentJs = fs.readFileSync(path.join(dir, 'content.js'), 'utf8');
const popupJs = fs.readFileSync(path.join(dir, 'popup.js'), 'utf8');
const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));

const contentMatch = contentJs.match(/CKRB_VERSION\s*=\s*'(\d+)'/);
const popupMatch = popupJs.match(/CKRB_VERSION\s*=\s*'(\d+)'/);
const manifestMatch = manifest.name.match(/v(\d+)/);

const contentVer = contentMatch ? contentMatch[1] : 'NOT FOUND';
const popupVer = popupMatch ? popupMatch[1] : 'NOT FOUND';
const manifestVer = manifestMatch ? manifestMatch[1] : 'NOT FOUND';

console.log('content.js:    v' + contentVer);
console.log('popup.js:      v' + popupVer);
console.log('manifest.json: v' + manifestVer + ' (' + manifest.version + ')');

if (contentVer === popupVer && popupVer === manifestVer) {
  console.log('\n✓ All versions match: v' + contentVer);
} else {
  console.error('\n✗ VERSION MISMATCH! Fix before deploying.');
  process.exit(1);
}
