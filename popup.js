const toggle = document.getElementById('toggle');
const toggleRow = document.getElementById('toggle-row');
const devtoolsToggle = document.getElementById('devtools-toggle');
const devtoolsToggleRow = document.getElementById('devtools-toggle-row');
const devtoolsMeta = document.getElementById('devtools-meta');
const statusDot = document.getElementById('status-dot');
const statusText = document.getElementById('status-text');
const DEVTOOLS_ENABLED_KEY = 'xray_devtools_enabled';
let devtoolsPersistedEnabled = true;

function setUI(enabled) {
  toggle.checked = enabled;
  toggleRow.classList.toggle('active', enabled);
  statusDot.classList.toggle('on', enabled);
  statusText.classList.toggle('on', enabled);
  statusText.textContent = enabled ? 'Inspector is active' : 'Inspector is off';
}

function setDevtoolsUI(enabled, options = {}) {
  const { showPending = false } = options;
  devtoolsToggle.checked = enabled;
  devtoolsToggleRow.classList.toggle('active', enabled);
  devtoolsMeta.classList.toggle('visible', showPending);
  devtoolsMeta.textContent = showPending
    ? 'Restart DevTools to apply this change.'
    : '';
}

// Read state for current tab on popup open
chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
  const tabId = tabs[0] && tabs[0].id;
  if (!tabId) return;
  chrome.storage.local.get([`inspector_${tabId}`], (result) => {
    setUI(!!result[`inspector_${tabId}`]);
  });
});

chrome.storage.local.get([DEVTOOLS_ENABLED_KEY], (result) => {
  devtoolsPersistedEnabled = result[DEVTOOLS_ENABLED_KEY] !== false;
  setDevtoolsUI(devtoolsPersistedEnabled);
});

// Listen for content script toggle changes
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'INSPECTOR_CLOSED') {
    setUI(false);
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tabId = tabs[0] && tabs[0].id;
      if (tabId) chrome.storage.local.remove([`inspector_${tabId}`]);
    });
  }
  if (msg.type === 'INSPECTOR_OPENED') {
    setUI(true);
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tabId = tabs[0] && tabs[0].id;
      if (tabId) chrome.storage.local.set({ [`inspector_${tabId}`]: true });
    });
  }
});

toggle.addEventListener('change', () => {
  const enabled = toggle.checked;
  setUI(enabled);

  chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
    const tab = tabs[0];
    if (!tab || !tab.id) return;

    // Always update storage
    if (enabled) {
      chrome.storage.local.set({ [`inspector_${tab.id}`]: true });
    } else {
      chrome.storage.local.remove([`inspector_${tab.id}`]);
    }

    if (enabled) {
      try {
        await chrome.scripting.insertCSS({ target: { tabId: tab.id }, files: ['panel.css'] });
        await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
        await chrome.tabs.sendMessage(tab.id, { type: 'TOGGLE_INSPECTOR', enabled: true, tabId: tab.id });
      } catch {
        chrome.tabs.sendMessage(tab.id, { type: 'TOGGLE_INSPECTOR', enabled: true, tabId: tab.id }).catch(() => {});
      }
    } else {
      chrome.tabs.sendMessage(tab.id, { type: 'TOGGLE_INSPECTOR', enabled: false, tabId: tab.id }).catch(() => {});
    }
  });
});

devtoolsToggle.addEventListener('change', () => {
  const enabled = devtoolsToggle.checked;
  const showPending = enabled !== devtoolsPersistedEnabled;
  setDevtoolsUI(enabled, { showPending });
  chrome.storage.local.set({ [DEVTOOLS_ENABLED_KEY]: enabled });
  devtoolsPersistedEnabled = enabled;
});
