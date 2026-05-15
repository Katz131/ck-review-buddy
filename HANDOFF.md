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

A Chrome MV3 extension for USMLE Step 2 CK review. It scrapes question banks (NBME, AMBOSS, UWorld, CCS Cases), sends wrong answers to Claude API for analysis, and quizzes the user on missed concepts via a popup. It also has text-to-speech for reading questions/explanations aloud with word-by-word highlighting, and a **Strategy Cards flipbook** for test-taking strategies.

**Current Version:** v275

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

- **content.js line 1:** Comment says `v176` but actual version is v275. The line 1 comment is NOT updated by `bump.js` — only `CKRB_VERSION` on line 5 is bumped. Low priority cosmetic fix.

---

## Changes This Session (v269→v275)

### v269 (from previous session)
- Strategy Cards flipbook feature complete
- Add card UI disambiguation

### v270
- Added DOM export mechanism (`ckrb-export-cards` event) for extracting card data from content script

### v271
- Added ✏️ Edit button for editing current card text (amber button, shows pre-filled form)

### v272
- Shared AudioContext for button sounds (reuses one instead of creating per hover/click)

### v273
- AudioContext created eagerly on flipbook open + unlocked on first user interaction

### v274
- Card counter font bumped to 15px, min-width 70px, nav gap 18px (easier to read)
- `_ckrbLoadCards` NEVER writes defaults to storage (prevents image loss on reload)

### v275
- `TOGGLE_STRATEGY_CARDS` message handler: top-frame-only guard prevents multi-frame race condition where one frame creates flipbook and another removes it
- Fixes popup Strategy Cards button not working on UWorld (multi-iframe pages)

---

## What Still Needs Doing

1. **Fix Q1→Q20 scrape jump bug** — see NEXT TASK section above
2. **Verify popup chunked TTS works end-to-end** — popup TTS was written but never fully confirmed
3. **Test Strategy Cards on all qbank sites** — auto-show on UWorld createtest and AMBOSS customsession confirmed working; other sites may need testing
4. **Strategy card defaults not persisting for new users** — since `_ckrbLoadCards` never saves defaults, brand new users will see defaults but they won't be in storage until they make a change. This is intentional (protects images) but worth noting.
