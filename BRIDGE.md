# CK Buddy ↔ Todo of the Loom — Cross-Extension Bridge Protocol

**Last updated:** 2026-05-23
**CK Buddy version at last sync:** v344
**Loom version at last sync:** v3.23.410

---

## PURPOSE

This file documents the real-time communication protocol between **CK Buddy** (medical Q-bank review extension) and **Todo of the Loom** (gamified Pomodoro/to-do tracker). Both extensions run simultaneously in Brave. When the user completes quiz blocks in CK Buddy, Loom reacts with dollar rewards, celebration screens, and notifications — making both extensions feel connected.

**This file exists in BOTH project folders.** Any Claude session that modifies bridge behavior in either extension MUST update this file in BOTH locations and note the change in the changelog at the bottom.

---

## EXTENSION IDS

| Extension | ID | Manifest Key |
|-----------|----|----|
| CK Buddy | `eanjidgieollmmocppapogfkldkegdpi` | Listed in Loom's `externally_connectable.ids` |
| Todo of the Loom | `ibobbkieoghidmojbdecjjdclfdiecae` | Referenced as `_LOOM_EXT_ID` in CK Buddy's popup.js line 2015 |

---

## MESSAGE FLOW

```
CK Buddy popup.js                    Loom background.js                    Loom app.js (popup tab)
       |                                    |                                       |
       |--- CKRB_BLOCK_STARTED ----------->|                                       |
       |    (quiz begins)                   |                                       |
       |                                    |                                       |
       |--- CKRB_QUESTION_ANSWERED ------->|                                       |
       |    (each answer submitted)         |--- CKRB_TRACKER_QUESTION ----------->|
       |                                    |                                       |
       |    (if idle too long)              |                                       |
       |--- CKRB_QUESTION_IDLE ----------->|                                       |
       |                                    |--- CKRB_PENALTY ------------------->|
       |                                    |    (deducts dollars from state)       |
       |                                    |                                       |
       |--- CKRB_BLOCK_COMPLETED --------->|                                       |
       |    (quiz block finished)           |--- CKRB_BONUS --------------------->|
       |                                    |    (awards dollars to state)          |
       |                                    |--- OS notification                    |
       |                                    |--- Opens/focuses Loom popup tab       |
       |                                    |                                       |
       |                                    |                   Celebration overlay  |
       |                                    |                   Before→After dollars |
       |                                    |                   Particles + sound    |
```

---

## MESSAGE TYPES — CK Buddy → Loom

### CKRB_BLOCK_STARTED
Sent when the user clicks Play/Start on a quiz block.

```javascript
{
  type: 'CKRB_BLOCK_STARTED',
  blockSize: Number,       // total questions in this block
  site: String,            // 'uworld' or 'amboss'
  timestamp: Number        // Date.now() epoch ms
}
```

**Loom response:** Stores block start time, resets question tracking.

### CKRB_QUESTION_ANSWERED
Sent after each individual question is answered.

```javascript
{
  type: 'CKRB_QUESTION_ANSWERED',
  questionIndex: Number,   // 1-based index within block
  correct: Boolean,        // whether answer was correct
  elapsedMs: Number,       // time since _loomBlockStartTime (NOT per-question)
  timestamp: Number        // Date.now()
}
```

**Loom response:** Forwards as `CKRB_TRACKER_QUESTION` to popup for UI tracking.

### CKRB_QUESTION_IDLE
Sent when per-question timer exceeds idle threshold (120s).

```javascript
{
  type: 'CKRB_QUESTION_IDLE',
  idleMs: Number,          // how long they were idle
  questionIndex: Number,
  timestamp: Number
}
```

**Loom response:** Calculates penalty (`$50` base), sends `CKRB_PENALTY` to popup, deducts from `state.coins`.

### CKRB_BLOCK_COMPLETED
Sent when the results screen appears (all questions answered).

```javascript
{
  type: 'CKRB_BLOCK_COMPLETED',
  totalQuestions: Number,  // total in block
  correctCount: Number,    // how many correct
  totalMs: Number,         // Date.now() - _loomBlockStartTime
  timestamp: Number        // Date.now()
}
```

**Loom response:** Calculates reward based on speed, sends `CKRB_BONUS` to popup, shows OS notification, opens/focuses Loom popup tab.

### CKRB_PING
Health check — CK Buddy polls this to show bridge status indicator.

```javascript
{ type: 'CKRB_PING' }
```

**Loom response:** `{ ok: true }` (or `{ status: 'ok' }` — CK Buddy accepts either).

---

## MESSAGE TYPES — Loom Internal (background.js → app.js)

### CKRB_BONUS
Sent from Loom's background.js to Loom's popup (app.js) via `chrome.runtime.sendMessage`.

```javascript
{
  type: 'CKRB_BONUS',
  amount: Number,          // dollar amount (0 if slow, 25 if OK, 100 if fast)
  reason: String           // e.g. 'Q-bank block (3/5, avg 32s)'
}
```

**Popup handling (app.js line ~17495):** Applies bonus DIRECTLY to `state.coins` (not via storage read — avoids race condition). Records `prevDollars` for before→after display. Pushes to `state.ckBuddyPendingRewards`. Calls `save()`, `render()`, then `showCkBuddyCelebration()` after 400ms.

### CKRB_PENALTY
Sent from Loom's background.js to Loom's popup when idle penalty triggers.

```javascript
{
  type: 'CKRB_PENALTY',
  amount: Number,          // penalty amount (e.g. $50)
  reason: String           // e.g. 'Q-bank idle (145s)'
}
```

**Popup handling (app.js line ~17471):** Same direct-mutation pattern as CKRB_BONUS but subtracts. Shows celebration overlay with red styling.

### CKRB_TRACKER_QUESTION / CKRB_TRACKER_BONUS / CKRB_TRACKER_PENALTY / CKRB_TRACKER_COMPLETE
Forwarded to popup for UI indicator updates. Lightweight — no state mutations.

---

## REWARD THRESHOLDS

| Speed | Avg Time Per Question | Reward |
|-------|----------------------|--------|
| FAST | < 45 seconds | $100 |
| OK | < 90 seconds | $25 |
| SLOW | ≥ 90 seconds | $0 |

Constants in Loom `background.js`:
- `CKRB_FAST_THRESHOLD_MS = 45000`
- `CKRB_OK_THRESHOLD_MS = 90000`
- `CKRB_COMPLETION_BONUS_FAST = 100`
- `CKRB_COMPLETION_BONUS_OK = 25`

**Avg time calculation:** `totalMs / totalQuestions` — uses total elapsed time from block start divided by question count.

**IMPORTANT:** `totalMs` is measured from `_loomBlockStartTime` which resets in `startQuiz()`. CK Buddy sends field name `totalMs`. Loom reads `msg.totalMs || msg.totalTimeMs || 0` for compatibility.

---

## CELEBRATION OVERLAY

Located in Loom's `popup.html` as `#ckBuddyCelebOverlay`. Rendered by `showCkBuddyCelebration()` in `app.js` (line ~17229).

**Features:**
- Particle effects (confetti-like animation)
- Icon: ✅ for completion, 💰 for bonus, ❌ for penalty
- Item list showing each reward/penalty with amount
- **Net total** across all pending rewards
- **Before → After balance display** (e.g. "$254 → $354")
  - Green text if balance increased
  - Red text if balance decreased
- Sound effect on show
- Dismiss button clears `state.ckBuddyPendingRewards`

**State field:** `state.ckBuddyPendingRewards` (array of reward objects):
```javascript
{
  type: 'bonus' | 'penalty' | 'complete',
  amount: Number,
  reason: String,
  ts: Number,           // Date.now()
  prevDollars: Number   // balance BEFORE this reward was applied
}
```

---

## CRITICAL IMPLEMENTATION NOTES

### Race Condition (SOLVED)
Background.js used to write coins to `chrome.storage.local`, but popup's in-memory `state` would overwrite it on the next `save()`. **Fix:** popup's `CKRB_BONUS`/`CKRB_PENALTY` handlers now mutate `state.coins` directly and call `save()` themselves. Background.js still writes to storage as a fallback (in case popup is closed).

### Field Name Compatibility
CK Buddy sends `totalMs`. An earlier Loom version renamed this to `totalTimeMs`. Loom now reads `msg.totalMs || msg.totalTimeMs || 0` to handle both.

### Celebration Timing
`showCkBuddyCelebration()` is called via `setTimeout(..., 400)` from the CKRB_BONUS handler. Previously it only fired on page load (3.6s timer), which meant it never showed when the popup was already open.

### Block Always Triggers Reward Flow
Even if the speed bonus is $0 (slow answers), the full flow still fires: notification, popup opens, celebration overlay shows with "complete" type. The user should ALWAYS see Loom react when a quiz block finishes.

### `externally_connectable` in Loom's manifest.json
CK Buddy's extension ID must be listed here for cross-extension messaging to work:
```json
"externally_connectable": {
  "ids": ["eanjidgieollmmocppapogfkldkegdpi"]
}
```

### No `externally_connectable` needed in CK Buddy
CK Buddy sends TO Loom. Only the receiver needs the sender listed.

---

## FILE LOCATIONS

### CK Buddy (sender)
| File | Bridge-relevant code |
|------|---------------------|
| `popup.js` line 2015 | `_LOOM_EXT_ID` constant |
| `popup.js` line 2022 | `_sendToLoom()` helper with debug logging |
| `popup.js` line 668/714/774 | `CKRB_BLOCK_STARTED` sends |
| `popup.js` line 1178/1200 | `CKRB_QUESTION_ANSWERED` sends |
| `popup.js` line 1649 | `CKRB_BLOCK_COMPLETED` send (UWorld) |
| `popup.js` line 2386/2395 | AMBOSS block start/complete sends |
| `popup.js` line 2072 | `CKRB_PING` health check |

### Todo of the Loom (receiver)
| File | Bridge-relevant code |
|------|---------------------|
| `manifest.json` | `externally_connectable.ids` |
| `background.js` line ~1941 | Threshold constants |
| `background.js` line ~1947 | `_sendToTracker()` helper |
| `background.js` line ~2002 | `CKRB_BLOCK_STARTED` / `CKRB_QUESTION_ANSWERED` handler |
| `background.js` line ~2041 | `CKRB_BLOCK_COMPLETED` handler (reward calc, notification, open popup) |
| `app.js` line ~17471 | `CKRB_PENALTY` handler (direct state mutation) |
| `app.js` line ~17495 | `CKRB_BONUS` handler (direct state mutation) |
| `app.js` line ~17229 | `showCkBuddyCelebration()` overlay renderer |
| `popup.html` line ~931 | `#ckBuddyCelebOverlay` HTML template |

---

## TERMINOLOGY

- **"Dollars"** — the in-game currency. Internal field is `state.coins` but UI displays `$` / "dollars." There is no separate "coins" concept. When this doc or code says "coins" it means dollars.
- **"Block"** — a set of quiz questions answered in one sitting.
- **"Celebration"** — the overlay that appears in Loom's popup after a block completes.

---

## CHANGELOG

| Date | Version(s) | Change | Author |
|------|-----------|--------|--------|
| 2026-05-23 | CK v335 / Loom v3.23.409 | Initial BRIDGE.md created | CK Buddy Claude |
| 2026-05-23 | Loom v3.23.408 | Loom Claude added _sendToTracker, celebration overlay, CKRB handlers | Loom Claude |
| 2026-05-23 | Loom v3.23.409 | Fixed: direct state mutation for money persistence, before→after balance display, celebration fires when popup already open, field name compat (totalMs/totalTimeMs) | CK Buddy Claude |
| 2026-05-22 | CK v334 | Added debug logging to _sendToLoom, bumped to v335 | CK Buddy Claude |
| 2026-05-22 | CK v320-329 | Added _sendToLoom helper, all CKRB message sends, bridge status indicator, per-question timer | CK Buddy Claude |
| 2026-05-23 | CK v344 / Loom v3.23.410 | CK Buddy speed penalties (red/yellow) are LOCAL only — no longer send CKRB_QUESTION_IDLE to Loom. Loom CKRB_PENALTY handler no longer shows celebration overlay mid-quiz. Celebration only fires on CKRB_BONUS (block complete). | CK Buddy Claude |
