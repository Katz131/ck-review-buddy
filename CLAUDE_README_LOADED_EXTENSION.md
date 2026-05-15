# CLAUDE — READ THIS FIRST BEFORE EDITING ANY FILES

## The loaded Brave extension lives HERE at the top level.

**Brave extension ID:** `eanjidgieollmmocppapogfkldkegdpi`
**Browser:** Brave (NOT Chrome)
**Actual loaded folder:** `C:\Users\theso\OneDrive\Desktop\ck-review-buddy\`
(the folder containing THIS readme file)

## CRITICAL FILE-NAMING RULE FOR CHROME/BRAVE EXTENSIONS

**Filenames in an extension's root folder CANNOT start with `_` (underscore).**
Chrome/Brave reserves leading-underscore names for internal use and will fail
to load the extension with "Cannot load extension with file or directory name
_X. Filenames starting with \"_\" are reserved for use by the system."

When creating notes or breadcrumb files in this folder, use a non-underscore
prefix (e.g. `AAA_` or `CLAUDE_` or `zz_`). NEVER start a filename here
with `_`.

## How to bump the version so a Brave reload shows the change

1. Edit ONLY `C:\Users\theso\OneDrive\Desktop\ck-review-buddy\manifest.json`.
2. Change `"name"` and `"version"` fields.
3. User clicks the reload icon on the CK Buddy card at `brave://extensions/`.
4. The new name/version appears. Confirmed working on v132 → v133 test.

## Do NOT waste time editing the subfolders

The following paths are DECOYS — copies, backups, or workspace uploads:

- `ck-review-buddy\ck_buddy_v132\` — Cowork workspace; upload copy, NOT loaded.
- `ck-review-buddy\ck_buddy_v132\ck_buddy_v132\` — nested duplicate of the above.
- `ck-review-buddy\ck_buddy_v131\`, `v130\`, `v129\` … all older snapshots.
- `ck_buddy_v103_STABLE\`, `ck_buddy_final\`, `(1)`, `(2)`, `(3)` copies — junk.

Editing any of those will have ZERO effect on the running extension.

## How I found this

- Extension ID was in `C:\Users\theso\AppData\Local\BraveSoftware\Brave-Browser\User Data\Default\Secure Preferences`.
- `chrome://extensions/` and `brave://extensions/` cannot be opened or read via
  browser automation — Chromium blocks it. Must ask the user to look manually,
  OR search the ID in the Secure Preferences file on disk.
- The only `manifest.json` in the whole `ck-review-buddy` tree that matched
  the original name "CK Buddy v132" was the top-level one. After bumping it
  (and only it), the user saw the reload take effect.

## When user says "my other extension auto-updates"

That means THAT extension has an internal self-reload mechanism (probably a
background service worker that polls file mtimes and calls
`chrome.runtime.reload()`). CK Buddy does NOT have this.

## Chromium/Brave security limits to remember

- `chrome://*` and `brave://*` pages cannot be navigated to or scraped by any
  extension, automation tool, or Claude-in-Chrome. Hard browser rule.
- `chrome-extension://{id}/{file}` URLs only return files listed in
  `web_accessible_resources` — don't rely on this to verify loaded paths.
- Unpacked extension IDs are a deterministic hash of the folder path, so the
  ID is stable across reloads of the same folder.
