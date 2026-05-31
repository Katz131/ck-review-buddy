# CK Buddy — Full Handoff Brief

> **For the next Claude session:** read this file in full before touching any code. It captures the state of the project, the landmines, and the unfinished work.

---

## NEXT TASK — START HERE

**Fix the Q1→Q20 scrape jump bug in `uworld_qbank.js`.**

**The bug:** user was on Item 1 of 20 on UWorld, hit "Scrape All UWorld" in the popup, and the scraper jumped to Q20 and only scraped that one question.

**Root cause (likely):** how `preCapStart` gets passed. Look at the message listener in `uworld_qbank.js` — search for `ckrb-scrape` or `runFullScrape`. The popup sends a message to the content script to start scraping, and it's supposed to include the current question number. Trace that value from where the popup captures it, through the message, into `runFullScrape(limit, preCapStart)`.

**Likely problem:** `getItemInfo()` parses `document.body.innerText` for the pattern `Item X of Y`. On UWorld, the sidebar table has row numbers (1–20) in the page text too. The regex `/Item\s+(\d+)\s+of\s+(\d+)/` should only match the actual "Item 1 of 20" header, but if the page layout changed or if `document.body.innerText` is picking up something unexpected, it could grab the wrong number. Also check if the popup is capturing `preCapStart` **before or after** it refocuses the UWorld tab — a tab focus change might cause UWorld to shift which question is displayed.

---

## What CK Buddy Is

A Chrome MV3 extension for USMLE Step 2 CK review. It scrapes question banks (NBME, AMBOSS, UWorld, CCS Cases), sends wrong answers to Claude API for analysis, and quizzes the user on missed concepts via a popup. It also has text-to-speech for reading questions/explanations aloud with word-by-word highlighting, a **Strategy Cards flipbook** for test-taking strategies, a **cross-extension bridge to Todo of the Loom** for distraction penalties/bonuses, and **wrong-choice highlighting** on Q-bank explanation pages.

**Current Version:** v334

---

## VERSION BUMP RULE (MANDATORY)

Version bump is **mandatory** for every change. Three files must stay in sync:

- `manifest.json` — `"name"` field (e.g. "CK Buddy v275") AND `"version"` field
- `content.js` — `CKRB_VERSION` constant (line 5)
- `popup.js` — `CKRB_VERSION` constant (line 4)

Run `node bump.js` to do all three atomically, then `node verify-versions.js` to confirm. If you forget, the browser caches the old content script and changes appear to do nothing.

**CRITICAL:** Use `python3` scripts via bash for all file writes — the Edit tool causes OneDrive sync corruption/truncation. Always run `node bump.js` then `node verify-versions.js` from the ck-review-buddy directory.

---

## File Locations

Everything is in `C:\Users\theso\OneDrive\Desktop\ck-review-buddy\`.

> **WARNING:** The `ck_buddy_v132` subfolder is an OLD BACKUP — do NOT edit it. The real loaded extension is the **parent folder**. Browser is **Brave**, not Chrome. User reloads via ↻ in `brave://extensions/`.

### Key files

- `manifest.json` — MV3 manifest, defines content scripts, permissions, host patterns
- `content.js` (~3100+ lines) — Main content script injected into ALL frames on ALL URLs. Contains TTS engine, word highlighting, scrape logic for NBME, debug banners, **Strategy Cards flipbook**
- `popup.js` (~2700+ lines) — Popup/popout UI logic, quiz display, explanation TTS, scrape initiation, Strategy Cards toggle button
- `popup.html` — Popup UI with Strategy Cards button (`btnStrategyCards`), 8 screens
- `background.js` — Service worker: Claude API calls, keepalive, abort flag, auto-popout window, cleanStem(), batch processing with chunked notifications, NAVIGATE_TO_QUESTION routing
- `uworld_qbank.js` — UWorld-specific content script, scraping logic, NAV_TO_QUESTION handler
- `uworld_noselect.js` — Runs in MAIN world at `document_start` to block UWorld from selecting answers on right-click (uses `stopImmediatePropagation` on pointerdown/mousedown for answer-choice rows)
- `amboss.js` — AMBOSS article scraping content script (handles `AMBOSS_SCRAPE` message)
- `amboss_qbank.js` — AMBOSS qbank scraping (AMBOSS_QBANK_SCRAPE, AMBOSS_QBANK_SCRAPE_SINGLE, AMBOSS_QBANK_DUMP, NAV_TO_QUESTION)
- `settings.html` + `settings.js` — Options page for Claude API key (`ckrb_apikey`), Azure Speech key + region (`ckrb_azure_key`, `ckrb_azure_region`), and scrape timing config (`ckrb_timing`)
- `vendor/azure-speech-sdk.js` — Azure Cognitive Services Speech SDK
- `bump.js` / `verify-versions.js` — Version bump + verify scripts
- `ckrb_cards_backup.json` — Backup of all 14 strategy cards with images (702KB)

### Backup / legacy folders (DO NOT EDIT)

- `ck_buddy_v132/` — old backup
- `ck-buddy-v102/` — old backup
- `ck_buddy_v103 (2)/` — old backup
- `background - Copy.js` — old backup of background.js

---

## Content Script Injection Architecture

The extension uses 6 content script entries in `manifest.json`:

1. **content.js** — `<all_urls>`, `all_frames: true`, `match_about_blank: true`, `document_idle`. The main content script injected everywhere. Contains NBME scraping, TTS, Strategy Cards, right-click yellow highlighting.

2. **azure-speech-sdk.js** — Injected on qbank domains only (starttest.com, nbme.org, amboss, uworld, ccscases), `all_frames: false`. Provides the Azure Speech SDK for TTS.

3. **amboss.js** — `next.amboss.com/*`, `document_idle`. Handles AMBOSS article scraping.

4. **amboss_qbank.js** — `next.amboss.com/*/review/*` and `*/session/*`, `document_idle`. Handles AMBOSS qbank scraping.

5. **uworld_noselect.js** — UWorld testinterface URLs, `document_start`, `world: "MAIN"`, `all_frames: true`. Blocks right-click answer selection in the page's MAIN world (content scripts run in isolated world and can't intercept page event listeners).

6. **uworld_qbank.js** — UWorld testinterface URLs, `document_idle`, `all_frames: true`. Handles UWorld qbank scraping.

**Important:** Because `content.js` runs with `all_frames: true`, messages sent via `chrome.tabs.sendMessage` go to ALL frames. This caused the multi-frame toggle race condition fixed in v275 (see Strategy Cards section).

---

## Message Types (Complete List)

### Background.js handles:
- `NAVIGATE_TO_QUESTION` — Multi-platform question navigation routing (tries NBME tabs first, falls back to AMBOSS, then UWorld via `chrome.scripting.executeScript`)
- `START_PROCESSING` — Kicks off batch AI analysis via `processBatch()`
- `PR_SCRAPE_COMPLETE` — Signal from content scripts when page-reload scrape finishes; auto-triggers `processBatch()`
- `ABORT_GENERATING` — Sets `ckrb_abort` flag in storage to stop batch processing
- `CLEAR_DATA` — Wipes `ckrb_questions`, `ckrb_status`, `ckrb_pr_session`
- `AMBOSS_PROCESS` — Processes AMBOSS article sections into vignette questions
- `CHILD_SCRAPED` — Child iframe relay; forwards data to parent frame (frameId: 0) via `CHILD_RELAY`
- `CKRB_DOWNLOAD_DEBUG` — Downloads debug report as JSON file via `chrome.downloads.download`

### Content.js handles:
- `NAV_TO_QUESTION` — NBME-specific: clicks the question link matching `?item=N`
- `ABORT_SCRAPE` — Stops in-progress scraping
- `SCRAPE_PAGE` — Scrapes all 25 questions on current NBME exam page
- `SCRAPE_PAGE_N` — Scrapes N questions (1 or 5), with `count` param
- `DUMP_PAGE` — Exports raw question data for debugging
- `TOGGLE_STRATEGY_CARDS` — Opens/closes flipbook (top-frame-only guard, v275)
- `RESTORE_STRATEGY_CARDS` — Writes card data to chrome.storage
- `ckrb-stop-tts` — Stops TTS playback

### Content.js sends:
- `PR_SCRAPE_COMPLETE` — After scraping completes, sends questions to background
- `CKRB_DOWNLOAD_DEBUG` — Sends debug report to background for download

### Content.js DOM events:
- `ckrb-export-cards` — Reads chrome.storage and writes card data to hidden DOM element for extraction

### Amboss.js handles:
- `AMBOSS_SCRAPE` — Scrapes AMBOSS article content sections

### Amboss_qbank.js handles:
- `NAV_TO_QUESTION` — AMBOSS qbank question navigation
- `AMBOSS_QBANK_SCRAPE` — Scrapes AMBOSS qbank (batch, or with `count: 1` / `count: 5`)
- `AMBOSS_QBANK_SCRAPE_SINGLE` — Scrapes single AMBOSS qbank question
- `AMBOSS_QBANK_DUMP` — Exports AMBOSS qbank data

### Amboss_qbank.js sends:
- `PR_SCRAPE_COMPLETE` — After scraping, sends questions to background

### UWorld_qbank.js handles:
- `NAV_TO_QUESTION` — UWorld question navigation
- `UWORLD_QBANK_SCRAPE` — Scrapes UWorld qbank (batch, or with `count: 1` / `count: 5`); receives `preCapStart` from popup
- `UWORLD_QBANK_SCRAPE_SINGLE` — Scrapes single UWorld qbank question
- `UWORLD_QBANK_DUMP` — Exports UWorld qbank data
- `ABORT_SCRAPE` — Stops in-progress UWorld scraping

### UWorld_qbank.js sends:
- `PR_SCRAPE_COMPLETE` — After scraping, sends questions to background

### Popup.js sends:
- `SCRAPE_PAGE`, `SCRAPE_PAGE_N`, `DUMP_PAGE` — To content.js (NBME)
- `AMBOSS_SCRAPE` — To amboss.js
- `AMBOSS_QBANK_SCRAPE` — To amboss_qbank.js
- `UWORLD_QBANK_SCRAPE` — To uworld_qbank.js (includes `preCapStart`)
- `START_PROCESSING`, `CLEAR_DATA`, `ABORT_GENERATING`, `AMBOSS_PROCESS` — To background.js
- `NAVIGATE_TO_QUESTION` — To background.js (which routes to the right platform)
- `NAV_TO_QUESTION` — Directly to NBME content script in some code paths
- `ABORT_SCRAPE` — To content scripts to stop scraping
- `TOGGLE_STRATEGY_CARDS` — To content.js to open/close flipbook
- `HIGHLIGHT_WRONG_CHOICE` — To content.js (v325, superseded by executeScript in v332+)

### Popup.js sends (cross-extension to Todo of the Loom):
- `CKRB_BLOCK_STARTED` — When quiz block begins
- `CKRB_QUESTION_ANSWERED` — On each answer submission
- `CKRB_IDLE_WARNING` — When 120s pass without answering
- `CKRB_BLOCK_COMPLETED` — When results screen shows
- `CKRB_PING` — Every 10s to check bridge status

### Content.js handles (v325, partially superseded):
- `HIGHLIGHT_WRONG_CHOICE` — Legacy handler still present but popup.js v332+ uses `chrome.scripting.executeScript` directly instead

---

## Chrome Storage Keys (Complete List)

### chrome.storage.sync (synced across devices):
- `ckrb_apikey` — Claude API key (validated: must start with `sk-`)
- `ckrb_azure_key` — Azure Speech Services subscription key
- `ckrb_azure_region` — Azure region (e.g. `eastus`)

### chrome.storage.local:
- `ckrb_questions` — Enriched question array with AI analysis (analysis._type: `incorrect`, `correct`, `marked`, `error`, `unknown`)
- `ckrb_status` — Processing state: `{state, message, done, total}` (states: `processing`, `amboss_processing`, etc.)
- `ckrb_timing` — Scrape timing config: `{settle, change}` in milliseconds
- `ckrb_continue` — Boolean flag for continuing batch after chunk completion (100-question chunks)
- `ckrb_abort` — Boolean flag to abort batch processing
- `ckrb_quiz_progress` — Lightweight quiz counters: `{currentIndex, score, streak, correct, wrong, total, active, savedAt}`
- `ckrb_active_quiz` — Full quiz snapshot: `{triviaQueue, allQuestions, currentIndex, score, ...}` — taken at quiz start for crash recovery
- `ckrb_start_pos` — Detected NBME starting position: `{section, question}`
- `ckrb_pr_session` — Page-reload scrape session data
- `ckrb_amboss_questions` — Generated AMBOSS vignette questions
- `ckrb_frame_data` — Relay data from child iframes
- `ckrb_grid_total` — Question grid total for resume
- `ckrb_settings` — Quiz settings: `{autonav, timer, timelimit, readAloud, readExplain, readQuote, highlightTTS}`
- `ckrb_highlight_tts` — Mirror of `highlightTTS` setting; content scripts listen to this via `chrome.storage.onChanged`
- `ckrb_popout_window_id` — Window ID of the auto-popout window (cleaned up on extension install/reload)
- `ckrb_strategy_cards` — Array of strategy card objects: `{id, text, imageDataUrl}`
- `ckrb_flipbook_pos` — Flipbook current card position
- `ckrb_last_debug_report` — Last debug failure report stored by content.js

### Analysis _type values (on each question's `analysis` object):
- `incorrect` — Student answered wrong; gets misconception + 3 trivia questions
- `correct` — Student answered right; gets keyFact + 1 trivia question
- `marked` — Marked for review; treated like incorrect
- `error` — API processing failed
- `unknown` — Correctness couldn't be determined

---

## Popup Screens

The popup has 8 screens, switched via `showScreen(id)`:

- `screen-home` — Main menu: NBME scrape buttons, status display, instructions
- `screen-processing` — Batch AI processing progress with abort button
- `screen-quiz` — Quiz engine: renders trivia questions with multiple-choice answers
- `screen-grid` — Question grid: colored buttons showing correctness per question
- `screen-nav` — Navigation/bookmarks screen with question-jump buttons
- `screen-results` — Final results summary: score, streak, breakdown
- `screen-amboss` — AMBOSS menu: scrape article or qbank, with Scrape All / Scrape 1 / Scrape 5 buttons
- `screen-amboss-quiz` — Quiz mode for AMBOSS-generated vignette questions

---

## Auto-Popout Window System

The extension has **no `default_popup`** in manifest.json. Instead:

- `chrome.action.onClicked` in background.js creates a standalone popup window (480×760) via `chrome.windows.create({ type: 'popup' })`
- Window ID stored in `ckrb_popout_window_id`; if already open, focuses existing window instead of creating a new one
- `chrome.windows.onRemoved` listener cleans up the stored window ID when closed
- On extension install/reload (`chrome.runtime.onInstalled`): closes any leftover popup window and clears stuck `processing` state

---

## Batch Processing & Chunked Notifications

`processBatch()` in background.js:

- **Chunk size:** 100 questions per processing pass
- Starts keepalive alarm before processing
- Fetches API key from `chrome.storage.sync`
- Loops through questions: routes each to `processIncorrect()`, `processCorrect()`, or `processMarked()` based on `isCorrect` flag
- `cleanStem()` strips UI artifacts (strikeout markers, item counters, navigation labels, UWorld toolbar text) before sending to Claude API
- After each 100-question chunk: saves partial results, creates desktop notification (`ckrb_chunk`), waits for `ckrb_continue` flag from popup
- On completion: saves all enriched questions, stops keepalive, sends `ckrb_ready` desktop notification
- Abort check: reads `ckrb_abort` from storage during processing loop; if set, stops and cleans up
- Status updates via `setStatus()` writing to `ckrb_status`

---

## NAVIGATE_TO_QUESTION Routing

Multi-platform question navigation, handled by background.js:

1. **NBME (starttest.com)** — Finds open NBME tab, sends `NAV_TO_QUESTION` message to content script, which clicks `a[href*="?item=N"]`
2. **AMBOSS (next.amboss.com)** — Finds review/session tab, uses `chrome.scripting.executeScript` to inject click + wait logic
3. **UWorld (apps.uworld.com)** — Finds testinterface tab, uses `chrome.scripting.executeScript` to inject row click + wait logic
4. Returns `{ok, landed, method, attempt}` to caller

Popup.js also has a direct path for NBME: sends `NAV_TO_QUESTION` directly to the tab in some code paths (e.g. quiz navigation).

---

## Quiz Persistence Model

Two-tier persistence in popup.js:

1. **`ckrb_quiz_progress`** — Lightweight counters saved after every answer: `{currentIndex, score, streak, correct, wrong, total, active, savedAt}`
2. **`ckrb_active_quiz`** — Full snapshot taken at quiz start: contains `triviaQueue` array + `allQuestions` + current index. Updated with `currentIndex` on each answer.

**Resume logic (`resumeQuiz()`):**
- Primary: loads `ckrb_active_quiz` snapshot — has full trivia queue, just restores position
- Fallback (legacy): rebuilds trivia queue from `ckrb_questions` + `ckrb_quiz_progress` counters
- Trivia allocation: 3 trivia per wrong/unknown question, 1 trivia per correct question

**Migration:** On first popup load, checks for legacy `ckrb_quiz_progress` without `ckrb_active_quiz` and upgrades to the snapshot model.

**Cleanup:** `clearQuizState()` removes both `ckrb_quiz_progress` and `ckrb_active_quiz`.

---

## Right-Click Yellow Highlight & Strikethrough

In content.js, right-click on selected text creates a yellow highlight (`span.__ckrb_ymark`). This is used for marking/eliminating answer choices during review.

In background.js, `cleanStem()` strips these artifacts before sending to Claude:
- `Strikeout/Eliminate [A-F] text`
- `Strikeout/Restore [A-F] text`
- `Option is eliminated.`

The `processIncorrect()` and `processCorrect()` functions also clean choices array by removing these markers.

---

## Strategy Cards Flipbook (v254–v275)

A flashcard-style flipbook of test-taking strategies with images.

### Features
- 14 default cards with AI-generated strategy images
- Auto-shows on block config screens (UWorld `/createtest`, AMBOSS `/customsession`)
- Floating 🃏 toggle button on all qbank sites
- Popup menu entry (Strategy Cards button)
- Drag-and-drop / paste / file-upload image support
- TTS reading of cards using browser speechSynthesis
- 3D Duolingo-style buttons with hover/click sound effects (AudioContext)
- Draggable panel (drag via header bar)
- Add / Edit / Delete cards
- Cards persist in `chrome.storage.local` under key `ckrb_strategy_cards`
- Card position persisted in `ckrb_flipbook_pos`

### Key code locations in content.js
- Storage key: `var _CKRB_STRAT_KEY = 'ckrb_strategy_cards';`
- Position key: `var _CKRB_STRAT_POS_KEY = 'ckrb_flipbook_pos';`
- 14 default cards: `_ckrbDefaultCards` array
- `_ckrbLoadCards(cb)` — reads from chrome.storage, NEVER writes defaults to storage (v275 fix)
- `_ckrbSaveCards(cards)` — writes to chrome.storage
- `_ckrbBuildFlipbook(hostDoc, cards)` — builds entire DOM
- `_ckrbToggleFlipbook()` — creates or removes flipbook
- `_ckrbShowFlipbook()` — creates flipbook (checks for existing first)
- `_ckrbCreateFlipbookToggle()` — creates 🃏 floating button
- `TOGGLE_STRATEGY_CARDS` message handler — top-frame-only guard (v275 fix)
- `RESTORE_STRATEGY_CARDS` message handler — writes cards to storage
- `ckrb-export-cards` DOM event handler — dumps storage to hidden DOM element
- Audio effects: shared `_fbAudioCtx` with eager creation + interaction unlock
- Image field: `card.imageDataUrl` (NOT `card.image`)
- Flipbook root DOM id: `__ckrb_flipbook`

### Critical bugs fixed
- **Image loss on reload (v268, v275):** `_ckrbLoadCards` used to write defaults to storage when storage appeared empty during extension reload. Fixed: NEVER writes defaults to storage. Also checks `chrome.runtime.lastError`.
- **Multi-frame toggle race (v275):** `TOGGLE_STRATEGY_CARDS` message went to all frames. First frame created flipbook, second removed it. Fixed: top-frame-only guard.
- **First card TTS not playing:** speechSynthesis voices not loaded on auto-open. Fixed: `voiceschanged` listener + 1.5s fallback timeout.
- **Arrows moving with different image sizes (v263):** Fixed with flexbox `height:calc(100vh-80px)`, `flex:1;min-height:0;object-fit:contain`.

### Image backup
- `ckrb_cards_backup.json` in project folder AND Downloads folder
- Contains all 14 cards with base64 JPEG images (702KB total)
- To restore: use `RESTORE_STRATEGY_CARDS` message or paste into service worker console

---

## TTS Architecture

Two completely separate TTS systems — DO NOT mix them.

### 1. Content Script TTS (right-drag highlight) — "Green Banner"
- Lives in `content.js`, uses Azure Speech SDK
- Sentence-by-sentence chunking with confirm dialogs
- Word-by-word highlighting via RAF loop
- Reads `ckrb_highlight_tts` setting from storage to enable/disable
- Azure credentials from `ckrb_azure_key` + `ckrb_azure_region` (chrome.storage.sync)
- Stop via `ckrb-stop-tts` message

### 2. Popup TTS (explanation reading) — runs in popup.js
- Uses Azure REST API (no SDK in popup)
- Own sentence splitting, confirm dialogs, cancellation
- Also reads Azure credentials from chrome.storage.sync
- Quote TTS: speaks quote at 0.85 rate, then chains question at 0.95 rate via `onend`

### 3. Strategy Cards TTS — browser speechSynthesis
- Lives in flipbook code in `content.js`
- Uses `_fbSpeak(text)` / `_fbStopSpeak()`
- Auto-reads first card on open, reads on navigate

**Critical rule:** Do NOT touch the content.js green-banner TTS path unless explicitly asked.

---

## Debug & Failure Handling

- `_ckrbBuildFailureDebug()` in content.js — Builds detailed debug reports for failed scrapes, stored in `ckrb_last_debug_report`
- Post-scrape retry window: modal (`__ckrb_retry_modal`) offers to retry failed questions
- Debug data sent to background via `CKRB_DOWNLOAD_DEBUG` for download as JSON file

---

## Stale Content

- **content.js line 1:** Comment says `v176` but actual version is v326. The line 1 comment is NOT updated by `bump.js` — only `CKRB_VERSION` on line 5 is bumped. Low priority cosmetic fix.

---

## Changes History

### v317–v319: TTS Glow Outline
- Added `.tts-reading` CSS class: orange outline + box-shadow on quiz text boxes while TTS is reading
- `_explSpeakChunked(text, skipConfirm, glowElId)` takes 3rd param for glow target element ID
- Quote and question TTS now glow separately: quote glows `vignette-quote-box`, question glows `quiz-question-text`
- `_explStopAll()` removes `.tts-reading` from all tracked glow elements

### v320: Cross-Extension Bridge to Todo of the Loom
- `_sendToLoom(data)`: Fire-and-forget wrapper for `chrome.runtime.sendMessage` to Loom extension ID
- Sends `CKRB_BLOCK_STARTED` when quiz block begins (with `blockSize`, `site`, `timestamp`)
- Sends `CKRB_QUESTION_ANSWERED` on each answer (with `questionIndex`, `correct`, `elapsedMs`)
- Sends `CKRB_BLOCK_COMPLETED` when results screen shows (with `totalQuestions`, `correctCount`, `totalMs`)
- `_startLoomIdleChecker()` / `_stopLoomIdleChecker()`: 45s setInterval, fires `CKRB_IDLE_WARNING` after 120s idle
- `_loomDetectSite(questions)`: Reads `parentQ.source` to detect 'uworld'/'amboss'/'nbme'
- Handles both standard and Amboss quiz paths
- See `CROSS-EXTENSION-BRIDGE.md` for full protocol spec

### v321–v322: Live Bridge Status Indicator
- `_pingLoom()`: Pings Todo of the Loom every 10s via `CKRB_PING`, updates status indicators
- `#loom-status` text indicator on home screen header
- `.loom-dot` green/red/gray circle indicators on both quiz screen headers
- CSS classes: `.loom-on` (green glow), `.loom-off` (red glow), `.loom-unknown` (gray)

### v323–v324: Per-Question Timer
- `_startQTimer(elId)` / `_stopQTimer()`: Per-question timer counting up from 0:00
- Color thresholds: yellow at 45s, red at 90s (standard questions)
- Timer does NOT stop on answer — only resets when next question renders
- `#q-timer` and `#amboss-q-timer` elements in quiz headers
- CSS: `.q-timer`, `.q-timer-yellow`, `.q-timer-red` with monospace font

### v325: Wrong Choice Highlighting + Timer Warning
- **Wrong choice highlighting on Q-bank pages:**
  - popup.js: `_highlightWrongChoiceOnPage(letter)` sends `HIGHLIGHT_WRONG_CHOICE` to active tabs
  - Extracts choice letter from `analysis.userAnswer` (e.g., "F. Transvaginal ultrasound" → "F")
  - content.js: `_ckrbHighlightWrongChoice(letter)` uses TreeWalker to find text nodes matching `(Choice F)`, `(Choices A, B, and F)`, etc.
  - Wraps matches in `<span class="ckrb-wrong-choice-hl">` with pulsing orange glow animation
  - Scrolls to first match on the Q-bank page
  - Removes previous highlights before applying new ones
- **Timer warning at 90s:**
  - Applies `q-timer-pulse` CSS animation (3 pulses, scale 1→1.15→1)
  - Plays descending two-tone beep (440Hz→330Hz square wave, 0.08 gain)
  - Fires once per question (guard flag `_qTimerWarnFired`)

### v326: Adaptive Timer Thresholds
- 3-part deep-review questions (incorrect/marked/unknown) get longer thresholds: yellow at 60s, red+warning at 120s
- Single-part correct-answer questions keep original 45s/90s thresholds
- `_startQTimer(elId, isMultiPart)` now accepts 2nd param

### v329: Running Stats Tooltip on Quiz Timer
- `_qStats` object tracks: totalQs, fastQs, okQs, slowQs, idleCost, totalTimeSec
- Timer tooltip updates every tick: shows running avg per question, fast/ok/slow counts, projected Loom bonus/penalty
- Fast threshold: <45s, OK threshold: <90s, Slow threshold: ≥90s
- `_qStats.reset()` called at block start

### v330–v331: Wrong Choice Highlight Fixes
- Added `HIGHLIGHT_WRONG_CHOICE` handler to background.js (was missing — messages silently dropped)
- Fixed CSS class mismatch: content.js defined `.ckrb-wrong-choice-hl` but code used `.ckrb-wrong-para-hl`
- Added 4s delay before highlight to wait for UWorld SPA navigation to load new question

### v332–v333: executeScript Highlight (Replaces Content Script Approach)
- **Problem:** UWorld SPA navigation reloads content.js after page change, wiping any highlights applied by the content script
- **Solution:** popup.js now uses `chrome.scripting.executeScript` with `world: 'MAIN'` to inject highlight code directly into the page's main world
- `_highlightWrongChoiceOnPage(letter)` in popup.js (~line 2090):
  - Queries all tabs matching qbank URLs (uworld, amboss, starttest, nbme)
  - Injects CSS for `.ckrb-wrong-para-hl` with pulsing orange animation + 3px solid border
  - Uses TreeWalker to find text nodes matching regex `\(Choices?\s[^)]*\bX\b` (handles all UWorld formats)
  - Walks up to block-level parent (<p>, <div>, <li>, <td>, <section>, <article>), adds glow class
  - Scrolls highlighted paragraph into view with `behavior: 'smooth'`
  - Retries up to 10 times at 1s intervals if text not found (UWorld lazy-loads explanation content)
- Content script `_ckrbHighlightWrongChoice(letter)` still exists but is no longer the primary mechanism
- `HIGHLIGHT_WRONG_CHOICE` handler in background.js also exists but is redundant

### v334: Regex Update for UWorld Choice Formats
- Updated highlight regex from `\(Choice\s+X\)` to `\(Choices?\s[^)]*\bX\b`
- Handles all UWorld answer choice reference formats:
  - `(Choice A)` — single choice
  - `(Choices A and B)` — two choices
  - `(Choices A, B, and C)` — three+ choices
  - `(Choices E, F, and G)` — any letter combination
- Confirmed working across multiple UWorld questions

### Loom-side changes (Todo of the Loom v3.23.407)
- **Fixed:** `CKRB_BLOCK_COMPLETED` handler now ALWAYS fires visible feedback regardless of answer speed
- Previously: bonus/celebration/notification only triggered if avg answer time <90s; slower = silent
- Now: always queues a pending reward entry (type `'bonus'` or `'complete'`), always shows OS notification, always opens Loom popup.html tab
- Pop-out `ckrb-alert.html` window still only appears when actual dollar bonus earned (avg <45s or <90s)
- `showCkBuddyCelebration()` in app.js updated to handle new `type: 'complete'` entries (purple text, checkmark icon)
- **manifest.json fix:** `externally_connectable.ids` was truncated in a previous session; restored with full CK Buddy extension ID

---

## What Still Needs Doing

1. **Fix Q1→Q20 scrape jump bug** — see NEXT TASK section above
2. **Test Strategy Cards on all qbank sites** — auto-show on UWorld createtest and AMBOSS customsession confirmed working; other sites may need testing
3. **Strategy card defaults not persisting for new users** — since `_ckrbLoadCards` never saves defaults, brand new users will see defaults but they won't be in storage until they make a change. This is intentional (protects images) but worth noting.
4. **Verify Loom bridge celebration fires in browser** — code changes made in Loom v3.23.407 to always open popup + show celebration on block complete. Needs live test: finish a quiz in CK Buddy with bridge toggle ON, confirm Loom popup opens and celebration overlay appears.
5. **Floating strategy cards icon on qbank pages** — in progress (task #30)
6. **Clean up redundant highlight code** — background.js `HIGHLIGHT_WRONG_CHOICE` handler and content.js `_ckrbHighlightWrongChoice` are both superseded by popup.js `_highlightWrongChoiceOnPage` using executeScript. Could be removed to reduce confusion.
