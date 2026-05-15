# CK Buddy v154 — STABLE

Date marked stable: 2026-04-14
Manifest name: "🧠 CK Buddy v154"
Manifest version: 2.54

## Confirmed-working behavior

### Left-click-drag (highlight mode)
- Native browser selection paints YELLOW live as you drag (`::selection { background: #fde047 !important }`).
- On left-mouseup, the selected range is wrapped in `<span class="__ckrb_ymark">` so the yellow persists.
- Left-click on an existing yellow span removes it (toggle off).
- Left-mouseup wrap is gated on a matching left-mousedown (_ckrbLeftDragActive flag) so stale selections from prior right-drags cannot accidentally wrap.
- Skips: buttons, inputs, textareas, selects, links, [data-ckrb-tts], [contenteditable="true"], and answer-choice rows during exam taking.

### Right-click-drag (TTS mode)
- A dedicated `<style id="__ckrb_sel_blue">` is injected on right-mousedown flipping `::selection` to BLUE (#b3d4fc) so the user can visually tell TTS mode apart from highlight mode. Removed on right-mouseup (one-tick deferred).
- On right-mouseup, a floating "🔊 Read" / "⏸ Stop" toggle button appears, positioned OUTSIDE the selection's bounding rect (above by default; below if no room; right-edge fallback) so it never obstructs the text being read.
- Button click toggles TTS: starts `_ckrbSpeak` with in-place word-by-word highlighting on the first click, cancels speech and removes the highlight on the second click.
- `window.getSelection().removeAllRanges()` is called after the button appears, so the blue `::selection` doesn't linger and a follow-up left-click on the page can't re-wrap the stale range.
- `contextmenu` is suppressed via `window._ckrbSuppressNextCtx` so no native menu pops up after a right-drag.
- Right-click on an existing yellow span still removes it (toggle off — legacy contextmenu handler).

### Text-to-speech
- Voice is locked to AMERICAN English: `u.lang = 'en-US'`, en-US-only voice filter that prefers Google US / Microsoft US voices by name, explicitly rejects en-GB / en-AU / en-IN etc.
- Second right-click-drag on the same page animates correctly: per-run state reset (`_ckrbBoundaryFired`, `_ckrbCleanupTimer`, `_ckrbHighlightIdx`, fallback timer) plus a 60 ms deferred `speak()` call to dodge Chrome's cancel→speak race that used to silently drop follow-up utterances.
- `Ctrl+Shift+S` speaks the current selection.
- `Esc` stops TTS.

### Popup → Q-bank tab bridge
- The popup's 🔊 Read Explanation / 🔁 Replay / ⏸ Stop buttons send `{type:'ckrb-speak-explanation', text}` / `{type:'ckrb-stop-tts'}` via `chrome.tabs.sendMessage` to the active Q-bank tab (UWorld / AMBOSS / NBME / CCS Cases). The content script locates the explanation element and reads in-place with word-by-word highlighting. Falls back to popup-only TTS if no Q-bank tab matches.

### Word highlight reflow
- In-place highlight overlays use `position: absolute` with page-space coords (`rect + pageYOffset`). A scroll/resize capture-phase listener re-queries each tracked range's live bounding rect so the orange current-word box and grey trail stay glued to their words during page scroll.
- `_ckrbPurgeAllHighlightMarkers()` sweeps top doc + current doc + same-origin iframes on boot and 500 ms later to clear stale markers from prior extension versions.

### CCS Cases review-mode detection
- `_ckrbIsReviewMode()` matches CCS feedback pages via `/Average\s+Orders/i` and `/Z[- ]?score/i` in body text.

## Rollback / snapshot instructions

To snapshot this stable build alongside `ck_buddy_v103_STABLE/`:

1. Open `C:\Users\theso\OneDrive\Desktop\ck-review-buddy\` in File Explorer.
2. Select every file at the top level: `manifest.json`, `background.js`, `content.js`, `popup.html`, `popup.js`, `popup.css` (if present), `settings.html`, `settings.js`, `amboss.js`, `amboss_qbank.js`, `uworld_qbank.js`, plus `icons/`.
3. Copy (Ctrl+C) and paste into a new subfolder named `ck_buddy_v154_STABLE\`.

Alternatively, just copy the whole folder to `ck_buddy_v154_STABLE\` at the same level.

If you later want to roll back, delete the top-level files and copy the `ck_buddy_v154_STABLE\` contents back up, then reload in `brave://extensions`.

## Key files touched relative to v148

- `manifest.json` — version bumped 2.48 → 2.54, name bumped to "🧠 CK Buddy v154"
- `content.js`:
  - Removed global `::selection` yellow override that was painting every selection yellow
  - Removed EDF auto-wrap `__ckrb_mark` handler that wrapped every NBME selection orange
  - Disabled `pointerup` listener that popped the left-click 🔊 Read button
  - Added `_ckrbLeftDragActive` flag + left-mouseup yellow-wrap handler
  - Added left-click-on-ymark → unwrap handler
  - Added `_ckrbEnableBlueSelectionOverride` / `_ckrbDisableBlueSelectionOverride` so right-drag paints blue
  - Rewired right-click mouseup to show the floating Start/Stop button with bounding-box-aware positioning (never obstructs text)
  - Added selection-clear after right-drag so the blue/yellow `::selection` doesn't linger
  - American-voice filter + `u.lang = 'en-US'`
  - Second-drag animation fix: state reset + 60 ms deferred `speak()`
