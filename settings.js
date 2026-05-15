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

/* ── AZURE SPEECH ── */
const azureKeyEl = document.getElementById('azurekey');
const azureRegionEl = document.getElementById('azureregion');
const azureStatus = document.getElementById('azure-status');

chrome.storage.sync.get(['ckrb_azure_key', 'ckrb_azure_region'], r => {
  if (r.ckrb_azure_key) azureKeyEl.value = r.ckrb_azure_key;
  if (r.ckrb_azure_region) azureRegionEl.value = r.ckrb_azure_region;
  if (r.ckrb_azure_key && r.ckrb_azure_region) {
    azureStatus.style.color = '#10b981';
    azureStatus.textContent = '✓ Azure key loaded';
  }
});

document.getElementById('saveAzureBtn').addEventListener('click', () => {
  const k = azureKeyEl.value.trim();
  const region = azureRegionEl.value.trim().toLowerCase();
  if (k && !region) {
    azureStatus.style.color = '#f87171';
    azureStatus.textContent = '⚠ Region is required (e.g. eastus)';
    return;
  }
  chrome.storage.sync.set({ ckrb_azure_key: k, ckrb_azure_region: region }, () => {
    azureStatus.style.color = '#10b981';
    azureStatus.textContent = k ? '✓ Azure key saved — TTS will use Azure now' : '✓ Azure cleared — falling back to local voice';
  });
});

document.getElementById('showAzureBtn').addEventListener('click', () => {
  azureKeyEl.type = azureKeyEl.type === 'password' ? 'text' : 'password';
});

document.getElementById('saveTimingBtn').addEventListener('click', () => {
  const timing = { settle: parseInt(settleEl.value) || 800, change: parseInt(changeEl.value) || 8000 };
  chrome.storage.local.set({ [TIMING_KEY]: timing }, () => {
    timingStatus.style.color = '#10b981';
    timingStatus.textContent = '✓ Timing saved!';
  });
});
