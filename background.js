const PANEL_CSS_FILE = 'panel.css';
const CONTENT_SCRIPT_FILE = 'content.js';
const CAPTURE_KEY_PREFIX = 'xray_capture_';
const DEVTOOLS_DISABLE_REASON_KEY_PREFIX = 'xray_devtools_disable_reason_';

async function openSidebarForTab(tabId) {
  if (!tabId) return false;

  try {
    await chrome.tabs.sendMessage(tabId, {
      type: 'OPEN_XRAY_SIDEBAR',
      tabId
    });
    return true;
  } catch (_) {
    // Inject Xray when the content script is not present on the page yet.
  }

  try {
    await chrome.scripting.insertCSS({
      target: { tabId },
      files: [PANEL_CSS_FILE]
    });
  } catch (_) {
    // Ignore duplicate or unsupported CSS injection errors and still try the script.
  }

  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: [CONTENT_SCRIPT_FILE]
    });

    await chrome.tabs.sendMessage(tabId, {
      type: 'OPEN_XRAY_SIDEBAR',
      tabId
    });
    return true;
  } catch (error) {
    console.warn('Xray could not open on this page.', error);
    return false;
  }
}

async function querySidebarStatusForTab(tabId) {
  if (!tabId) return { ok: false, visible: false };

  try {
    const response = await chrome.tabs.sendMessage(tabId, {
      type: 'GET_XRAY_SIDEBAR_STATUS',
      tabId
    });

    return {
      ok: true,
      visible: !!(response && response.visible)
    };
  } catch (_) {
    return {
      ok: false,
      visible: false
    };
  }
}

function clearStoredCaptureForTab(tabId) {
  if (!tabId) return;
  chrome.storage.local.remove(`${CAPTURE_KEY_PREFIX}${tabId}`);
}

function setDevtoolsDisableReason(tabId, reason) {
  if (!tabId) return;
  chrome.storage.local.set({ [`${DEVTOOLS_DISABLE_REASON_KEY_PREFIX}${tabId}`]: reason });
}

function clearDevtoolsDisableReason(tabId) {
  if (!tabId) return;
  chrome.storage.local.remove(`${DEVTOOLS_DISABLE_REASON_KEY_PREFIX}${tabId}`);
}

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab || !tab.id) return;
  await openSidebarForTab(tab.id);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status !== 'loading') return;
  clearStoredCaptureForTab(tabId);
  setDevtoolsDisableReason(tabId, 'paused');
});

chrome.tabs.onRemoved.addListener((tabId) => {
  clearStoredCaptureForTab(tabId);
  clearDevtoolsDisableReason(tabId);
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message) return;

  if (message.type === 'OPEN_XRAY_SIDEBAR_FOR_TAB') {
    const requestedTabId = message.tabId || (sender && sender.tab && sender.tab.id);
    openSidebarForTab(requestedTabId)
      .then((opened) => sendResponse({ ok: opened }))
      .catch((error) => {
        console.warn('Xray could not handle the sidebar open request.', error);
        sendResponse({ ok: false });
      });

    return true;
  }

  if (message.type === 'QUERY_XRAY_SIDEBAR_STATUS_FOR_TAB') {
    const requestedTabId = message.tabId || (sender && sender.tab && sender.tab.id);
    querySidebarStatusForTab(requestedTabId)
      .then((status) => sendResponse(status))
      .catch((error) => {
        console.warn('Xray could not query the sidebar status.', error);
        sendResponse({ ok: false, visible: false });
      });

    return true;
  }
});
