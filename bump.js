#!/usr/bin/env node
// bump.js — Atomically bumps version in manifest.json, content.js, and popup.js
// Usage: node bump.js [optional description]
// Example: node bump.js "fix abort flag reset"

const fs = require('fs');
const path = require('path');

const dir = __dirname;
const manifestPath = path.join(dir, 'manifest.json');
const contentPath = path.join(dir, 'content.js');
const popupPath = path.join(dir, 'popup.js');

// Read current versions
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const contentJs = fs.readFileSync(contentPath, 'utf8');
const popupJs = fs.readFileSync(popupPath, 'utf8');

// Extract current version number from content.js
const match = contentJs.match(/CKRB_VERSION\s*=\s*'(\d+)'/);
if (!match) { console.error('Could not find CKRB_VERSION in content.js'); process.exit(1); }
const oldVer = parseInt(match[1], 10);
const newVer = oldVer + 1;

// Compute new manifest version (increment last segment by 10)
const oldManifestVer = manifest.version;
const verParts = oldManifestVer.split('.');
const lastPart = parseInt(verParts[verParts.length - 1], 10);
verParts[verParts.length - 1] = String(lastPart + 10);
const newManifestVer = verParts.join('.');

// Description for manifest name
const desc = process.argv.slice(2).join(' ') || 'update';

// Update manifest.json
manifest.name = manifest.name.replace(/v\d+/, 'v' + newVer).replace(/\(.*\)/, '(' + desc + ')');
manifest.version = newManifestVer;
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');

// Update content.js
const newContentJs = contentJs.replace(
  /CKRB_VERSION\s*=\s*'\d+'/,
  "CKRB_VERSION = '" + newVer + "'"
);
fs.writeFileSync(contentPath, newContentJs);

// Update popup.js
const newPopupJs = popupJs.replace(
  /CKRB_VERSION\s*=\s*'\d+'/,
  "CKRB_VERSION = '" + newVer + "'"
);
fs.writeFileSync(popupPath, newPopupJs);

console.log('Bumped: v' + oldVer + ' → v' + newVer + ' (manifest ' + oldManifestVer + ' → ' + newManifestVer + ')');
console.log('  manifest.json ✓');
console.log('  content.js    ✓');
console.log('  popup.js      ✓');
