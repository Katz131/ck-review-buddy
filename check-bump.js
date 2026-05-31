#!/usr/bin/env node
/**
 * SAFEGUARD: Detects if popup.js or content.js have been modified
 * more recently than the last version bump.
 * 
 * Run: node check-bump.js
 * Returns exit code 1 if bump is needed.
 */
const fs = require('fs');
const path = require('path');

const manifestPath = path.join(__dirname, 'manifest.json');
const popupPath = path.join(__dirname, 'popup.js');
const contentPath = path.join(__dirname, 'content.js');

try {
  const mStat = fs.statSync(manifestPath);
  const pStat = fs.statSync(popupPath);
  const cStat = fs.statSync(contentPath);

  const mTime = mStat.mtimeMs;
  const pTime = pStat.mtimeMs;
  const cTime = cStat.mtimeMs;

  const issues = [];
  if (pTime > mTime + 1000) issues.push('popup.js modified AFTER last manifest bump');
  if (cTime > mTime + 1000) issues.push('content.js modified AFTER last manifest bump');

  if (issues.length > 0) {
    console.error('\n!!! VERSION BUMP NEEDED !!!');
    issues.forEach(i => console.error('  - ' + i));
    console.error('\nRun: node bump.js && node verify-versions.js\n');
    process.exit(1);
  } else {
    // Also verify version strings match
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const popupSrc = fs.readFileSync(popupPath, 'utf8');
    const contentSrc = fs.readFileSync(contentPath, 'utf8');

    const mVer = (manifest.name.match(/v(\d+)/) || [])[1];
    const pVer = (popupSrc.match(/CKRB_VERSION\s*=\s*'v(\d+)'/) || [])[1];
    const cVer = (contentSrc.match(/CKRB_VERSION\s*=\s*'v(\d+)'/) || [])[1];

    if (mVer !== pVer || mVer !== cVer) {
      console.error('\n!!! VERSION MISMATCH !!!');
      console.error('  manifest: v' + mVer + '  popup: v' + pVer + '  content: v' + cVer);
      console.error('\nRun: node bump.js && node verify-versions.js\n');
      process.exit(1);
    }

    console.log('OK: versions match (v' + mVer + '), no unbumped changes detected.');
    process.exit(0);
  }
} catch(e) {
  console.error('check-bump.js error:', e.message);
  process.exit(2);
}
