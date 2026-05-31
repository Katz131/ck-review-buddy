# !!! STOP — VERSION BUMP REQUIRED !!!

> **BEFORE you write a single line of code, READ THIS:**
> Every edit session MUST end with `node bump.js` + `node verify-versions.js`.
> NO EXCEPTIONS. Not "after I test it." Not "I'll do it later." NOW.
> The user has asked for this DOZENS of times. Failure = broken extension.
> If you are about to respond to the user without bumping, STOP AND BUMP FIRST.

# CK Buddy — Project Instructions for Claude

## READ FIRST

Before doing anything else, read **`HANDOFF.md`** in this folder. It contains the full state of the project, the architecture (especially the two-TTS split), known bugs, and the list of unfinished work. Do not skip it.

## BRIDGE PROTOCOL (READ SECOND)

Read **`BRIDGE.md`** in this folder. It documents the cross-extension communication protocol between CK Buddy and Todo of the Loom. If you modify ANY bridge-related code (`_sendToLoom`, `CKRB_*` message types, `_LOOM_EXT_ID`, reward thresholds, etc.), you MUST:

1. Update `BRIDGE.md` in THIS folder
2. Copy the updated `BRIDGE.md` to the Loom project folder (`Pixel todo lists/BRIDGE.md`)
3. Note the change in the changelog table at the bottom of BRIDGE.md

## VERSION BUMP RULE (MANDATORY — NEVER SKIP)

**Every single change to any file in this project MUST be accompanied by a version bump in ALL THREE of these files:**

1. `manifest.json` — `"name"` field (e.g. v186 → v187) AND `"version"` field (e.g. 2.860 → 2.870)
2. `content.js` — `CKRB_VERSION` constant (line 3)
3. `popup.js` — `CKRB_VERSION` constant (line 2)

**Use the bump script:** `node bump.js` — it handles all three atomically.
**Then verify:** `node verify-versions.js` — confirms all three match.

If you forget this, the user's browser will cache the old content script and your changes will appear to do nothing. This has happened dozens of times. Do not let it happen again.

## TASK LIST RULE

When creating tasks in the progress list, ALWAYS add ALL planned subtasks upfront in one batch — never add them one at a time as you go. The user wants to see the full scope of work from the start.

## EDITING RULE

Use Python scripts (via bash) to make file edits instead of the Edit tool. This is the user's preferred workflow.

## After every edit session

1. Run `node bump.js` (or manually bump all 3)
2. Run `node verify-versions.js`
3. Tell the user the new version number
