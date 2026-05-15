const input = document.getElementById('apikey');
const status = document.getElementById('status');

chrome.storage.sync.get(['ckrb_apikey'], r => {
  if (r.ckrb_apikey) {
    input.value = r.ckrb_apikey;
    status.style.color = '#10b981';
    status.textContent = '✓ Key loaded from storage';
  }
});

document.getElementById('saveBtn').addEventListener('click', () => {
  const key = input.value.trim();
  if (!key.startsWith('sk-')) {
    status.style.color = '#f87171';
    status.textContent = '⚠ Key should start with sk-ant-…';
    return;
  }
  chrome.storage.sync.set({ ckrb_apikey: key }, () => {
    status.style.color = '#10b981';
    status.textContent = '✓ Key saved!';
  });
});

document.getElementById('showBtn').addEventListener('click', () => {
  input.type = input.type === 'password' ? 'text' : 'password';
});

/* ── TIMING ── */
const TIMING_KEY = 'ckrb_timing';
const settleEl = document.getElementById('set-settle');
const changeEl = document.getElementById('set-change');
const timingStatus = document.getElementById('timing-status');

chrome.storage.local.get([TIMING_KEY], r => {
  if (r[TIMING_KEY]) {
    if (r[TIMING_KEY].settle) settleEl.value = r[TIMING_KEY].settle;
    if (r[TIMING_KEY].change) changeEl.value = r[TIMING_KEY].change;
  }
});

document.getElementById('saveTimingBtn').addEventListener('click', () => {
  const timing = { settle: parseInt(settleEl.value) || 800, change: parseInt(changeEl.value) || 8000 };
  chrome.storage.local.set({ [TIMING_KEY]: timing }, () => {
    timingStatus.style.color = '#10b981';
    timingStatus.textContent = '✓ Timing saved!';
  });
});
