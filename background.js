const PANEL_CSS_FILE = 'panel.css';
const CONTENT_SCRIPT_FILE = 'content.js';

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab || !tab.id) return;

  try {
    await chrome.tabs.sendMessage(tab.id, {
      type: 'OPEN_XRAY_SIDEBAR',
      tabId: tab.id
    });
    return;
  } catch (_) {
    // Inject Xray when the content script is not present on the page yet.
  }

  try {
    await chrome.scripting.insertCSS({
      target: { tabId: tab.id },
      files: [PANEL_CSS_FILE]
    });
  } catch (_) {
    // Ignore duplicate or unsupported CSS injection errors and still try the script.
  }

  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: [CONTENT_SCRIPT_FILE]
    });

    await chrome.tabs.sendMessage(tab.id, {
      type: 'OPEN_XRAY_SIDEBAR',
      tabId: tab.id
    });
  } catch (error) {
    console.warn('Xray could not open on this page.', error);
  }
});
