# Pre-Upgrade Preparation Guide — CK Buddy

> **Purpose:** Everything needed to resume full development velocity after upgrading Claude, switching machines, reinstalling Brave, or starting a fresh session. Run through this checklist BEFORE upgrading.

---

## 1. Project Files (Safe on Disk)

These survive any Claude upgrade automatically — they live on your computer, not inside Claude.

**Location:** `C:\Users\theso\OneDrive\Desktop\ck-review-buddy\`

**Key recovery files:**
- `HANDOFF.md` — Full project state, architecture, bugs, and next tasks (399 lines, exhaustive)
- `CLAUDE.md` — Instructions that auto-load when you open this folder in a new Claude session
- `ckrb_cards_backup.json` — Strategy card images backup (702KB, 14 cards with base64 JPEGs)
- `bump.js` / `verify-versions.js` — Version bump tooling

**Action:** No action needed. OneDrive syncs these automatically. But verify OneDrive is up to date before upgrading.

---

## 2. Git Repository Setup

**Current status:** NO git repo exists. This is a risk — any accidental file corruption has no rollback.

**Action BEFORE upgrade — initialize git:**

Open a terminal in `C:\Users\theso\OneDrive\Desktop\ck-review-buddy\` and run:

```
git init
git add -A
git commit -m "v277 — baseline before upgrade"
```

**Create .gitignore first** (paste into a file called `.gitignore` in the project folder):

```
node_modules/
*.log
.DS_Store
Thumbs.db
```

---

## 3. GitHub Repository & Authentication

**Action — create a private GitHub repo:**

1. Go to https://github.com/new
2. Name: `ck-review-buddy` (or whatever you prefer)
3. Set to **Private**
4. Do NOT initialize with README (you already have files)
5. After creating, run in terminal:

```
git remote add origin https://github.com/YOUR_USERNAME/ck-review-buddy.git
git branch -M main
git push -u origin main
```

**GitHub authentication options:**
- **HTTPS + Personal Access Token (simplest):** Go to GitHub → Settings → Developer Settings → Personal Access Tokens → Generate New Token (classic). Give it `repo` scope. When git asks for password, paste the token.
- **SSH key:** Run `ssh-keygen -t ed25519 -C "abk93@cornell.edu"`, add the public key at GitHub → Settings → SSH Keys.
- **GitHub CLI:** Install `gh` from https://cli.github.com, then run `gh auth login`.

**Store your chosen method** so the next Claude session can help you push commits.

---

## 4. API Keys & Credentials

These are stored in Brave's extension storage, NOT in project files. They need to be re-entered if you reinstall the extension or clear Brave data.

**Record these somewhere safe (password manager recommended):**

| Key | Where It's Stored | How to Find It |
|-----|-------------------|----------------|
| Claude API key (`sk-ant-...`) | `chrome.storage.sync` → `ckrb_apikey` | Brave → CK Buddy popup → Settings, or `brave://extensions` → CK Buddy → Service Worker console → `chrome.storage.sync.get(['ckrb_apikey'], console.log)` |
| Azure Speech key | `chrome.storage.sync` → `ckrb_azure_key` | Same method, key: `ckrb_azure_key` |
| Azure Speech region | `chrome.storage.sync` → `ckrb_azure_region` | Same method, key: `ckrb_azure_region` |

**Action:** Open Brave service worker console and run:
```js
chrome.storage.sync.get(['ckrb_apikey','ckrb_azure_key','ckrb_azure_region'], r => console.log(JSON.stringify(r,null,2)))
```
Copy the output and save it in your password manager.

---

## 5. Brave Extension Storage

This is where quiz progress, strategy cards, settings, and question data live. It survives Claude upgrades (it's in Brave, not Claude), but would be lost if you reinstall Brave or clear extension data.

**Critical storage keys to back up:**

| Key | What It Contains |
|-----|-----------------|
| `ckrb_strategy_cards` | 14 strategy cards with images |
| `ckrb_questions` | Your scraped + AI-analyzed questions |
| `ckrb_active_quiz` | Current quiz snapshot (if mid-quiz) |
| `ckrb_quiz_progress` | Quiz progress counters |
| `ckrb_settings` | Your quiz settings |

**Action — full storage backup:**

Open Brave service worker console (`brave://extensions` → CK Buddy → "Service worker") and run:

```js
chrome.storage.local.get(null, r => {
  const json = JSON.stringify(r, null, 2);
  const blob = new Blob([json], {type: 'application/json'});
  const url = URL.createObjectURL(blob);
  chrome.tabs.create({url: url});
})
```

Save the resulting page as `ck_buddy_full_storage_backup.json` in your Downloads folder.

**To restore later** (paste in service worker console):
```js
fetch(chrome.runtime.getURL('ck_buddy_full_storage_backup.json'))
  .then(r => r.json())
  .then(data => chrome.storage.local.set(data, () => console.log('Restored all storage')))
```

**Strategy cards specifically** are also backed up in `ckrb_cards_backup.json` in the project folder, and v276+ auto-restores from this file if storage is empty.

---

## 6. Chrome Extension Storage (if applicable)

If you also use Chrome (not just Brave), it has its own separate extension storage. The same backup procedure from Section 5 applies — just do it in Chrome's service worker console instead.

**Note:** Claude in Chrome (the browser automation tool) connects to Chrome, not Brave. Extension development/testing happens in Brave. These are separate and don't share storage.

---

## 7. Google Drive / OneDrive

**Current setup:** Project folder is on OneDrive Desktop (`C:\Users\theso\OneDrive\Desktop\ck-review-buddy\`).

**Action:** Verify OneDrive sync is complete before upgrading:
- Check the OneDrive icon in system tray — should show "Up to date"
- If any files show sync conflicts (e.g. `content - Copy.js`), resolve them first

**If you use Google Drive for other projects:**
- Google Drive connections in Claude are per-session (via MCP connectors)
- They need to be reconnected each new session
- Your actual Google Drive files are unaffected by Claude upgrades

---

## 8. Starting a New Claude Session After Upgrade

When you open a new Cowork session:

1. **Select the project folder:** Choose `C:\Users\theso\OneDrive\Desktop\ck-review-buddy\`
2. **Claude auto-reads `CLAUDE.md`** — this tells it to read `HANDOFF.md`
3. **First message to Claude:**

```
Read HANDOFF.md in full. The current version is v277. 
Pick up from the "What Still Needs Doing" section.
Don't start coding until you've confirmed you understand 
the architecture, especially the two-TTS split and the 
multi-frame content script injection.
```

4. **Re-grant folder permissions** if Claude needs to write files
5. **Reconnect any MCP tools** (Google Drive, Slack, etc.) if you had them

---

## 9. What Claude CANNOT Recover

Even with perfect documentation, a new Claude session:

- **Has no memory** of previous conversations — only what's in files
- **Cannot access Brave** — no browser automation in Brave (only Chrome via Claude in Chrome extension)
- **Cannot read chrome.storage** — must be done manually in Brave's service worker console
- **Cannot push to GitHub** — needs your auth credentials (token/SSH key) set up in the terminal

These are permanent limitations, not things that improve with an upgrade.

---

## 10. Quick Pre-Upgrade Checklist

Run through this right before upgrading:

- [ ] OneDrive sync shows "Up to date"
- [ ] `HANDOFF.md` reflects current project state and version number
- [ ] API keys saved in password manager (Claude key, Azure key + region)
- [ ] Strategy card images backed up (`ckrb_cards_backup.json` exists in project folder)
- [ ] Full storage backup saved (`ck_buddy_full_storage_backup.json` in Downloads)
- [ ] Git repo initialized and committed (`git status` shows clean)
- [ ] GitHub repo created and pushed (optional but recommended)
- [ ] Note the current version number: **v277**

---

## 11. Emergency Recovery

If everything goes wrong and you need to rebuild from scratch:

1. **Extension code:** All in `C:\Users\theso\OneDrive\Desktop\ck-review-buddy\` (or git clone from GitHub if you set it up)
2. **Load in Brave:** `brave://extensions` → Developer mode → Load unpacked → select the folder
3. **Restore cards:** Auto-restores from `ckrb_cards_backup.json` on first flipbook open (v276+)
4. **Restore full storage:** Use the backup JSON from Section 5
5. **Re-enter API keys:** Settings page → paste Claude API key and Azure credentials
6. **Resume development:** Open folder in Claude Cowork → read HANDOFF.md → continue

---

*Last updated: v277, May 15, 2026*
