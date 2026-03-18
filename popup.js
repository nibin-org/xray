const toggle = document.getElementById('toggle');
const toggleRow = document.getElementById('toggle-row');
const statusDot = document.getElementById('status-dot');
const statusText = document.getElementById('status-text');

function setUI(enabled) {
  toggle.checked = enabled;
  toggleRow.classList.toggle('active', enabled);
  statusDot.classList.toggle('on', enabled);
  statusText.classList.toggle('on', enabled);
  statusText.textContent = enabled ? 'Inspector is active' : 'Inspector is off';
}

// Read state for current tab on popup open
chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
  const tabId = tabs[0]?.id;
  if (!tabId) return;
  chrome.storage.local.get([`inspector_${tabId}`], (result) => {
    setUI(!!result[`inspector_${tabId}`]);
  });
});

// Listen for content script toggle changes
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'INSPECTOR_CLOSED') {
    setUI(false);
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tabId = tabs[0]?.id;
      if (tabId) chrome.storage.local.remove([`inspector_${tabId}`]);
    });
  }
  if (msg.type === 'INSPECTOR_OPENED') {
    setUI(true);
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tabId = tabs[0]?.id;
      if (tabId) chrome.storage.local.set({ [`inspector_${tabId}`]: true });
    });
  }
});

toggle.addEventListener('change', () => {
  const enabled = toggle.checked;
  setUI(enabled);

  chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
    const tab = tabs[0];
    if (!tab?.id) return;

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
        await chrome.tabs.sendMessage(tab.id, { type: 'TOGGLE_INSPECTOR', enabled: true });
      } catch {
        chrome.tabs.sendMessage(tab.id, { type: 'TOGGLE_INSPECTOR', enabled: true }).catch(() => {});
      }
    } else {
      chrome.tabs.sendMessage(tab.id, { type: 'TOGGLE_INSPECTOR', enabled: false }).catch(() => {});
    }
  });
});
