# CK Buddy — Project Instructions for Claude

## READ FIRST

Before doing anything else, read **`HANDOFF.md`** in this folder. It contains the full state of the project, the architecture (especially the two-TTS split), known bugs, and the list of unfinished work. Do not skip it.

## VERSION BUMP RULE (MANDATORY — NEVER SKIP)

**Every single change to any file in this project MUST be accompanied by a version bump in ALL THREE of these files:**

1. `manifest.json` — `"name"` field (e.g. v186 → v187) AND `"version"` field (e.g. 2.860 → 2.870)
2. `content.js` — `CKRB_VERSION` constant (line 3)
3. `popup.js` — `CKRB_VERSION` constant (line 2)

**Use the bump script:** `node bump.js` — it handles all three atomically.
**Then verify:** `node verify-versions.js` — confirms all three match.

If you forget this, the user's browser will cache the old content script and your changes will appear to do nothing. This has happened dozens of times. Do not let it happen again.

## After every edit session

1. Run `node bump.js` (or manually bump all 3)
2. Run `node verify-versions.js`
3. Tell the user the new version number
