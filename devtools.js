const inspectedTabId = chrome.devtools.inspectedWindow.tabId;
const DEVTOOLS_ENABLED_KEY = 'xray_devtools_enabled';
let devtoolsEnabled = false;

chrome.storage.local.get([DEVTOOLS_ENABLED_KEY], (result) => {
  devtoolsEnabled = result[DEVTOOLS_ENABLED_KEY] === true;
  if (!devtoolsEnabled) return;
  createDevtoolsSurfaces();
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'local' || !changes[DEVTOOLS_ENABLED_KEY]) return;
  devtoolsEnabled = changes[DEVTOOLS_ENABLED_KEY].newValue === true;
});

function createDevtoolsSurfaces() {
  chrome.devtools.panels.create('Xray', 'icons/icon16.png', 'devtools-panel.html');

  chrome.devtools.panels.elements.createSidebarPane('Xray', (sidebar) => {
    function updateSidebar() {
      if (!devtoolsEnabled) {
        sidebar.setObject(
          { status: 'Xray DevTools is off. Turn it back on from the Xray sidebar when you want to continue inspecting.' },
          'Xray'
        );
        return;
      }

      chrome.devtools.inspectedWindow.eval(
        `(${buildSidebarSnapshot.toString()})()`,
        (result, exceptionInfo) => {
          if (exceptionInfo && exceptionInfo.isError) return;
          sidebar.setObject(result || { status: 'Select an element in Elements to inspect it with Xray.' }, 'Xray');
        }
      );
    }

    function disableAfterRefresh() {
      if (!devtoolsEnabled) {
        updateSidebar();
        return;
      }

      devtoolsEnabled = false;
      chrome.storage.local.set({ [DEVTOOLS_ENABLED_KEY]: false }, updateSidebar);
    }

    sidebar.setHeight('100vh');
    chrome.devtools.panels.elements.onSelectionChanged.addListener(updateSidebar);
    chrome.devtools.network.onNavigated.addListener(disableAfterRefresh);
    updateSidebar();
  });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type !== 'XRAY_DEVTOOLS_STATUS') return;
  if (message.tabId !== inspectedTabId) return;
  sendResponse({ open: devtoolsEnabled, enabled: devtoolsEnabled, tabId: inspectedTabId });
});

function buildSidebarSnapshot() {
  const el = $0;
  if (!el) return null;

  function buildSelector(node) {
    const parts = [];
    let current = node;
    while (current && current !== document.body && parts.length < 4) {
      let part = current.tagName.toLowerCase();
      if (current.id) {
        part += '#' + current.id;
        parts.unshift(part);
        break;
      }
      if (current.classList.length) part += '.' + Array.from(current.classList).slice(0, 2).join('.');
      parts.unshift(part);
      current = current.parentElement;
    }
    return parts.join(' > ');
  }

  const cs = getComputedStyle(el);
  const rect = el.getBoundingClientRect();
  const text = (el.textContent || '').replace(/\s+/g, ' ').trim();

  return {
    tag: el.tagName.toLowerCase(),
    selector: buildSelector(el),
    identity: {
      id: el.id || null,
      classes: Array.from(el.classList).slice(0, 4),
      text: text ? text.slice(0, 80) : null,
      role: el.getAttribute('role') || null
    },
    layout: {
      size: `${Math.round(rect.width)}px x ${Math.round(rect.height)}px`,
      display: cs.display,
      position: cs.position,
      overflow: cs.overflow
    },
    visual: {
      color: cs.color,
      background: cs.backgroundColor,
      font: cs.fontFamily.split(',')[0].replace(/['"]/g, '').trim(),
      fontSize: cs.fontSize
    }
  };
}
