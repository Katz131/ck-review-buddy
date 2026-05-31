# CK Buddy ↔ Todo of the Loom — Cross-Extension Bridge

## What Is CK Buddy?

CK Buddy (extension ID: `eanjidgieollmmocppapogfkldkegdpi`) is a Chrome MV3 extension that scrapes medical Q-bank sites (UWorld, NBME, AMBOSS), analyzes wrong answers with AI, and quizzes the user on missed concepts. It runs as a content script on Q-bank pages and has a popup.js-based quiz UI.

**Key file:** `C:\Users\theso\OneDrive\Desktop\ck-review-buddy\HANDOFF.md` — full architecture reference.

## What Todo of the Loom Needs to Know

CK Buddy will send cross-extension messages to Todo of the Loom reporting quiz/block activity. Todo of the Loom's `background.js` needs to listen for these messages and apply penalties (deduct `state.coins`) when the user is being distracted (taking too long between answers).

## Extension IDs

| Extension | ID |
|-----------|-----|
| CK Buddy | `eanjidgieollmmocppapogfkldkegdpi` |
| Todo of the Loom | `ibobbkieoghidmojbdecjjdclfdiecae` |

## Message Protocol (CK Buddy → Todo of the Loom)

CK Buddy sends messages via:
```js
chrome.runtime.sendMessage('ibobbkieoghidmojbdecjjdclfdiecae', { type: '...', ... });
```

### Message Types

| Type | When Sent | Data |
|------|-----------|------|
| `CKRB_BLOCK_STARTED` | User starts a Q-bank block/review session | `{ blockSize, site, timestamp }` |
| `CKRB_QUESTION_ANSWERED` | User answers a question | `{ questionIndex, correct, elapsedMs, timestamp }` |
| `CKRB_IDLE_WARNING` | Too long since last answer (configurable threshold) | `{ idleMs, lastAnswerAt, timestamp }` |
| `CKRB_BLOCK_COMPLETED` | All questions in block finished | `{ totalQuestions, correctCount, totalMs, timestamp }` |

### Recommended Penalty Logic (for Todo of the Loom)

- Listen in `background.js` via `chrome.runtime.onMessageExternal.addListener(...)`
- Track `lastAnswerAt` timestamp
- On `CKRB_IDLE_WARNING`: deduct coins from `state.coins` (e.g., $50-$200 depending on idle duration)
- On `CKRB_BLOCK_COMPLETED`: optionally award a bonus if average time-per-question is reasonable

### Required Manifest Change (Todo of the Loom)

Add to `manifest.json`:
```json
"externally_connectable": {
  "ids": ["eanjidgieollmmocppapogfkldkegdpi"]
}
```

### Required Listener (Todo of the Loom background.js)

```js
chrome.runtime.onMessageExternal.addListener((msg, sender, sendResponse) => {
  if (sender.id !== 'eanjidgieollmmocppapogfkldkegdpi') return;
  // Handle msg.type: CKRB_BLOCK_STARTED, CKRB_QUESTION_ANSWERED, etc.
  // Read pixelFocusState, deduct coins, save state
});
```

## What CK Buddy Will Implement

CK Buddy's `popup.js` will add message-sending at these points:
- Quiz block start (when `renderTriviaQuestion()` first fires for a new block)
- Each answer submission
- Idle detection (a setInterval checking time since last answer)
- Block completion (when quiz results screen shows)

## Status

**CK Buddy side: FULLY IMPLEMENTED as of v320.** All 4 message types + idle detection + CKRB_PING status polling (v321). Todo of the Loom side: implemented as of v3.23.405 (listener in background.js, per-question timer bonuses/penalties, idle coin deductions).
