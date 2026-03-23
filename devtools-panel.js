const tabId = chrome.devtools.inspectedWindow.tabId;
const storageKey = `xray_capture_${tabId}`;

const root = document.getElementById('panel-root');
const sourceBadge = document.getElementById('source-badge');
const pageMeta = document.getElementById('page-meta');
const statusText = document.getElementById('status-text');
const openSidebarButton = document.getElementById('open-sidebar');
const refreshButton = document.getElementById('refresh-selection');
const overlayButton = document.getElementById('load-overlay');
const closeButton = document.getElementById('close-panel');
const DEVTOOLS_ENABLED_KEY = 'xray_devtools_enabled';
const disableReasonKey = `xray_devtools_disable_reason_${tabId}`;
let lastSnapshot = null;
let currentMode = 'selection';
let boxExpanded = false;
let devtoolsIntegrationEnabled = false;
let refreshDisabledMessage = '';
let waitingForFreshInspection = false;
let disabledState = 'paused';
let disableReason = 'paused';

chrome.storage.local.get([DEVTOOLS_ENABLED_KEY, disableReasonKey], (result) => {
  devtoolsIntegrationEnabled = result[DEVTOOLS_ENABLED_KEY] === true;
  disableReason = result[disableReasonKey] || 'paused';
  if (!devtoolsIntegrationEnabled) {
    applyDevtoolsEnabledState(false);
  }
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'local') return;
  if (changes[disableReasonKey]) {
    disableReason = changes[disableReasonKey].newValue || 'paused';
    if (!devtoolsIntegrationEnabled) {
      applyDevtoolsEnabledState(false, refreshDisabledMessage);
    }
  }
  if (!changes[DEVTOOLS_ENABLED_KEY]) return;
  devtoolsIntegrationEnabled = changes[DEVTOOLS_ENABLED_KEY].newValue === true;
  applyDevtoolsEnabledState(devtoolsIntegrationEnabled, refreshDisabledMessage);
});

querySidebarVisibility();

openSidebarButton.addEventListener('click', () => {
  openSidebarFromDevtools();
});

function openSidebarFromDevtools() {
  const openSidebar = () => {
    chrome.runtime.sendMessage(
      {
        type: 'OPEN_XRAY_SIDEBAR_FOR_TAB',
        tabId
      },
      (response) => {
        if (chrome.runtime.lastError || !response || response.ok !== true) {
          setStatus(waitingForFreshInspection
            ? 'Use the Xray toolbar button on this page to reopen the sidebar after a reload.'
            : 'Could not open the in-page sidebar on this tab.');
          return;
        }
        updateOpenSidebarButton(true);
        if (waitingForFreshInspection) {
          setStatus('Sidebar opened. Choose a new element to inspect.');
          return;
        }
        setStatus(devtoolsIntegrationEnabled
          ? 'Sidebar opened.'
          : 'Sidebar opened. DevTools is ready again.');
      }
    );
  };

  if (devtoolsIntegrationEnabled) {
    openSidebar();
    return;
  }

  chrome.storage.local.set({ [DEVTOOLS_ENABLED_KEY]: true }, () => {
    devtoolsIntegrationEnabled = true;
    disableReason = 'paused';
    chrome.storage.local.remove(disableReasonKey);
    applyDevtoolsEnabledState(true);
    openSidebar();
  });
}

refreshButton.addEventListener('click', () => {
  if (!devtoolsIntegrationEnabled) return;
  currentMode = 'selection';
  inspectCurrentSelection();
});

overlayButton.addEventListener('click', () => {
  if (!devtoolsIntegrationEnabled) return;
  currentMode = 'overlay';
  loadStoredCapture(true);
});

closeButton.addEventListener('click', () => {
  refreshDisabledMessage = 'Close and reopen DevTools to hide the Xray tab. Turn it back on from the Xray sidebar when you need it again.';
  disableReason = 'toggle_off';
  chrome.storage.local.set({
    [DEVTOOLS_ENABLED_KEY]: false,
    [disableReasonKey]: 'toggle_off'
  }, () => {
    devtoolsIntegrationEnabled = false;
    applyDevtoolsEnabledState(false, refreshDisabledMessage);
  });
});

chrome.runtime.onMessage.addListener((message, sender) => {
  if (!message) return;

  if (message.type === 'XRAY_SIDEBAR_VISIBILITY_CHANGED') {
    const senderTabId = sender && sender.tab && sender.tab.id;
    const targetTabId = message.tabId || senderTabId;
    if (targetTabId !== tabId) return;
    updateOpenSidebarButton(!!message.visible);
    return;
  }

  if (!devtoolsIntegrationEnabled || message.type !== 'XRAY_CAPTURE_UPDATED') return;
  const senderTabId = sender && sender.tab && sender.tab.id;
  const targetTabId = message.tabId || senderTabId;
  if (targetTabId !== tabId || !message.snapshot) return;
  currentMode = 'overlay';
  renderSnapshot(message.snapshot, 'Overlay capture updated.');
});

chrome.devtools.panels.elements.onSelectionChanged.addListener(() => {
  if (!devtoolsIntegrationEnabled || currentMode !== 'selection') return;
  inspectCurrentSelection();
});

chrome.devtools.network.onNavigated.addListener(() => {
  if (!devtoolsIntegrationEnabled) return;
  updateOpenSidebarButton(false);
  waitingForFreshInspection = true;
  chrome.storage.local.remove(storageKey);
  refreshDisabledMessage = 'Click the Xray toolbar button on this page to reopen the sidebar, then choose a new element to inspect.';
  disableDevtoolsIntegration(refreshDisabledMessage, 'paused');
});

async function loadStoredCapture(announce) {
  return new Promise((resolve) => {
    chrome.storage.local.get([storageKey], (result) => {
      const snapshot = result[storageKey];
      if (!snapshot) {
        if (announce) setStatus('No overlay capture found for this tab yet.');
        resolve(false);
        return;
      }
      renderSnapshot(snapshot, announce ? 'Loaded the latest overlay capture.' : 'Loaded the latest overlay capture while waiting for a live DevTools selection.');
      resolve(true);
    });
  });
}

function querySidebarVisibility() {
  chrome.runtime.sendMessage(
    {
      type: 'QUERY_XRAY_SIDEBAR_STATUS_FOR_TAB',
      tabId
    },
    (response) => {
      if (chrome.runtime.lastError || !response) {
        updateOpenSidebarButton(false);
        return;
      }
      updateOpenSidebarButton(!!response.visible);
    }
  );
}

function updateOpenSidebarButton(isVisible) {
  openSidebarButton.hidden = !!isVisible;
}

function inspectCurrentSelection(announce = true) {
  chrome.devtools.inspectedWindow.eval(
    `(${buildDevtoolsSnapshot.toString()})()`,
    (result, exceptionInfo) => {
      if ((exceptionInfo && exceptionInfo.isError) || !result) {
        if (announce) {
          setStatus('Select an element in Elements or use Ctrl+Shift+C / Cmd+Opt+C, then Xray will update.');
        }
        return;
      }
      renderSnapshot(result, 'Live DevTools selection updated.');
    }
  );
}

function renderSnapshot(snapshot, status) {
  waitingForFreshInspection = false;
  lastSnapshot = snapshot;
  sourceBadge.classList.remove('idle');
  sourceBadge.textContent = snapshot.source === 'selection' ? 'Live Selection' : 'Overlay Capture';
  pageMeta.textContent = snapshot.pageTitle
    ? `${snapshot.pageTitle} • ${snapshot.pageUrl}`
    : snapshot.pageUrl || 'Unknown page';
  setStatus(status || 'Snapshot loaded.');

  const insightGroups = [
    { label: 'Layout', rows: snapshot.layout },
    { label: 'State', rows: compactStateRows(snapshot.state) },
    { label: 'Parent Context', rows: snapshot.parentLayout }
  ].filter((group) => group.rows && group.rows.length);

  const sections = [
    renderIdentitySection(snapshot.identity),
    renderRowsSection('Element Details', snapshot.elementProps, 'section-props section-compact', renderImageDownloadAction(snapshot.imageSrc)),
    renderGroupedSection('Layout & State', insightGroups, 'section-insights'),
    renderRowsSection('Visual', snapshot.visual, 'section-visual section-compact', renderCopyCssAction(snapshot.cssSnippet)),
    renderRowsSection('Useful Attributes', snapshot.attributes, 'section-attrs section-compact'),
    renderBoxSection(snapshot.boxModel)
  ].filter(Boolean).join('');

  root.innerHTML = sections || renderEmpty('No meaningful properties for this element yet.');
  bindCopyInteractions();
  bindImageDownloadAction();
  bindCopyCssAction();
}

function renderIdentitySection(identity) {
  if (!identity) return '';
  return `
    <section class="section section-identity">
      <div class="section-header">
        <h2 class="section-title">Identity</h2>
      </div>
      <div class="section-body">
        <div class="tag-badge">&lt;${escapeHtml(identity.tag)}&gt;</div>
        <div class="selector" data-copy="${escapeAttr(identity.selector)}">${escapeHtml(identity.selector)}</div>
        ${renderRows(identity.rows)}
      </div>
    </section>
  `;
}

function renderRowsSection(title, rows, className, actionHtml = '') {
  if ((!rows || !rows.length) && !actionHtml) return '';
  return `
    <section class="section ${className || ''}">
      <div class="section-header">
        <h2 class="section-title">${escapeHtml(title)}</h2>
      </div>
      <div class="section-body">
        ${rows && rows.length ? renderRows(rows) : ''}
        ${actionHtml}
      </div>
    </section>
  `;
}

function renderImageDownloadAction(imageSrc) {
  if (!imageSrc) return '';
  return `
    <div class="section-actions">
      <button class="action-btn" type="button" id="download-image" data-image-url="${escapeAttr(imageSrc)}">Download Image</button>
    </div>
  `;
}

function renderCopyCssAction(cssSnippet) {
  if (!cssSnippet) return '';
  return `
    <div class="section-actions">
      <button class="action-btn" type="button" id="copy-css">Copy CSS</button>
    </div>
  `;
}

function renderGroupedSection(title, groups, className) {
  if (!groups || !groups.length) return '';
  return `
    <section class="section ${className || ''}">
      <div class="section-header">
        <h2 class="section-title">${escapeHtml(title)}</h2>
      </div>
      <div class="section-body">
        ${groups.map((group) => `
          <div class="section-group">
            <div class="section-group-label">${escapeHtml(group.label)}</div>
            ${renderRows(group.rows)}
          </div>
        `).join('')}
      </div>
    </section>
  `;
}

function renderRows(rows) {
  return rows.map((row) => `
    <div class="row">
      <span class="row-key">${escapeHtml(row.key)}</span>
      <span class="row-value ${escapeHtml(row.tone || '')}" data-copy="${escapeAttr(row.copyValue || row.value)}">
        ${row.swatch ? `<span class="color-row"><span class="swatch" style="background:${escapeAttr(row.swatch)}"></span><span>${escapeHtml(row.value)}</span></span>` : escapeHtml(row.value)}
      </span>
    </div>
  `).join('');
}

function renderBoxSection(boxModel) {
  if (!boxModel) return '';
  const [mt, mr, mb, ml] = boxModel.margin;
  const [bt, br, bb, bl] = boxModel.border;
  const [pt, pr, pb, pl] = boxModel.padding;
  const expandedClass = boxExpanded ? 'is-expanded' : '';
  const toggleLabel = boxExpanded ? 'Hide diagram' : 'Show diagram';

  return `
    <section class="section section-box section-compact ${expandedClass}">
      <div class="section-header">
        <h2 class="section-title">Box Model</h2>
        <button class="section-toggle" type="button" data-box-toggle="true">${toggleLabel}</button>
      </div>
      <div class="section-body">
        ${renderRows(boxModel.summary)}
        <div class="box-wrap">
          <div class="box-shell">
            <div class="box-label">Margin</div>
            <div class="box-top">${escapeHtml(mt)}</div>
            <div class="box-sides">
              <span>${escapeHtml(ml)}</span>
              <div class="box-center">
                <div class="box-border">
                  <div class="box-label">Border</div>
                  <div class="box-top">${escapeHtml(bt)}</div>
                  <div class="box-sides">
                    <span>${escapeHtml(bl)}</span>
                    <div class="box-center">
                      <div class="box-padding">
                        <div class="box-label">Padding</div>
                        <div class="box-top">${escapeHtml(pt)}</div>
                        <div class="box-sides">
                          <span>${escapeHtml(pl)}</span>
                          <div class="box-center"><div class="box-content">${escapeHtml(boxModel.size)}</div></div>
                          <span>${escapeHtml(pr)}</span>
                        </div>
                        <div class="box-bottom">${escapeHtml(pb)}</div>
                      </div>
                    </div>
                    <span>${escapeHtml(br)}</span>
                  </div>
                  <div class="box-bottom">${escapeHtml(bb)}</div>
                </div>
              </div>
              <span>${escapeHtml(mr)}</span>
            </div>
            <div class="box-bottom">${escapeHtml(mb)}</div>
          </div>
        </div>
      </div>
    </section>
  `;
}

function compactStateRows(rows) {
  if (!rows || !rows.length) return [];
  return rows.filter((row) => {
    if (row.key === 'transition' && (row.value === 'all' || row.value.indexOf('all ') === 0)) return false;
    return true;
  });
}

function renderStateCard(options) {
  const {
    eyebrow = 'Ready',
    title = 'Nothing to show yet',
    message = '',
    tone = 'default',
    actionHtml = ''
  } = options || {};

  return `
    <div class="empty-state empty-state-${escapeHtml(tone)}">
      <div class="empty-eyebrow">${escapeHtml(eyebrow)}</div>
      <div class="empty-icon-wrap">
        <div class="empty-icon">⬡</div>
      </div>
      <div class="empty-title">${escapeHtml(title)}</div>
      <div class="empty-text">${escapeHtml(message)}</div>
      ${actionHtml}
    </div>
  `;
}

function renderEmpty(message) {
  return renderStateCard({
    eyebrow: 'Ready',
    title: 'Nothing to show yet',
    message,
    tone: 'default'
  });
}

function renderReadyState(title, message) {
  return renderStateCard({
    eyebrow: 'Ready Again',
    title,
    message,
    tone: 'ready'
  });
}

function applyDevtoolsEnabledState(enabled, disabledMessage = '') {
  refreshButton.disabled = !enabled;
  overlayButton.disabled = !enabled;
  closeButton.disabled = !enabled;
  closeButton.hidden = !enabled;

  if (enabled) {
    refreshDisabledMessage = '';
    disabledState = 'paused';
    querySidebarVisibility();
    currentMode = 'selection';
    sourceBadge.textContent = 'Waiting';
    sourceBadge.classList.add('idle');
    pageMeta.textContent = 'Open Elements and select a node, or inspect from the overlay first.';
    if (waitingForFreshInspection) {
      root.innerHTML = renderReadyState(
        'Sidebar opened',
        'Click an element on the page or select one in Elements to inspect it again.'
      );
      setStatus('Sidebar opened. Choose a new element to inspect.');
      return;
    }

    root.innerHTML = renderEmpty('Select an element in the Elements panel or use the in-page Xray overlay and click DevTools.');
    setStatus('DevTools is ready again.');
    return;
  }

  lastSnapshot = null;
  currentMode = 'selection';
  boxExpanded = false;
  openSidebarButton.hidden = true;
  sourceBadge.textContent = (disabledState === 'removed' || disableReason === 'toggle_off') ? 'Disabled' : 'Paused';
  sourceBadge.classList.add('idle');
  if (disableReason === 'toggle_off') {
    pageMeta.textContent = 'Xray DevTools is off until you turn it back on.';
    setStatus(disabledMessage || 'DevTools turned off from the sidebar.');
    root.innerHTML = renderStateCard({
      eyebrow: 'Disabled',
      title: 'Xray hidden from DevTools',
      message: disabledMessage || 'Turn DevTools back on from the Xray sidebar, then reopen DevTools to show the Xray tab again.',
      tone: 'closed'
    });
    return;
  }
  if (disabledState === 'removed') {
    pageMeta.textContent = 'Xray DevTools is off until you enable it again.';
    setStatus(disabledMessage || 'DevTools integration turned off.');
    root.innerHTML = renderStateCard({
      eyebrow: 'Disabled',
      title: 'Xray removed from DevTools',
      message: disabledMessage || 'Close and reopen DevTools to finish removing the Xray tab. You can turn it back on later from the Xray sidebar.',
      tone: 'closed'
    });
    return;
  }

  pageMeta.textContent = 'DevTools paused until you use the Xray toolbar button again.';
  setStatus(disabledMessage || 'DevTools paused.');
  root.innerHTML = `
    ${renderStateCard({
      eyebrow: 'Paused',
      title: 'DevTools paused after refresh',
      message: disabledMessage || 'Click the Xray toolbar button on this page to reopen the sidebar and bring DevTools back.',
      tone: 'paused',
      actionHtml: ''
    })}
  `;
}

function disableDevtoolsIntegration(disabledMessage, reason = 'removed') {
  disabledState = reason === 'paused' ? 'paused' : (reason === 'toggle_off' ? 'toggle_off' : 'removed');
  disableReason = disabledState;
  if (disabledState === 'removed' || disabledState === 'toggle_off') {
    waitingForFreshInspection = false;
  }
  chrome.storage.local.set({ [DEVTOOLS_ENABLED_KEY]: false, [disableReasonKey]: disableReason }, () => {
    devtoolsIntegrationEnabled = false;
    applyDevtoolsEnabledState(
      false,
      disabledMessage || (disabledState === 'removed'
        ? 'Close and reopen DevTools to finish removing Xray. You can turn it back on later from the Xray sidebar.'
        : (disabledState === 'toggle_off'
          ? 'Close and reopen DevTools to hide the Xray tab. Turn it back on from the Xray sidebar when you need it again.'
          : 'Click the Xray toolbar button on this page to reopen the sidebar, then choose a new element to inspect.'))
    );
  });
}

function bindCopyInteractions() {
  const boxToggle = root.querySelector('[data-box-toggle="true"]');
  if (boxToggle) {
    boxToggle.addEventListener('click', () => {
      boxExpanded = !boxExpanded;
      if (lastSnapshot) renderSnapshot(lastSnapshot, boxExpanded ? 'Expanded box model.' : 'Collapsed box model.');
    });
  }

  root.querySelectorAll('[data-copy]').forEach((node) => {
    node.addEventListener('click', async () => {
      const value = node.getAttribute('data-copy') || '';
      try {
        await navigator.clipboard.writeText(value);
        const original = node.innerHTML;
        node.innerHTML = 'Copied';
        setTimeout(() => {
          node.innerHTML = original;
          if (lastSnapshot) renderSnapshot(lastSnapshot, 'Copied to clipboard.');
        }, 900);
      } catch {
        setStatus('Copy failed. Try again.');
      }
    });
  });
}

function bindImageDownloadAction() {
  const button = document.getElementById('download-image');
  if (!button) return;

  button.addEventListener('click', () => {
    const imageUrl = button.getAttribute('data-image-url') || '';
    if (!imageUrl) return;

    chrome.runtime.sendMessage({ type: 'XRAY_DOWNLOAD_IMAGE', url: imageUrl }, (response) => {
      if (chrome.runtime.lastError || !response || response.ok !== true) {
        setStatus('Could not download this image.');
        return;
      }
      setStatus('Image download started.');
    });
  });
}

function bindCopyCssAction() {
  const button = document.getElementById('copy-css');
  if (!button) return;

  button.addEventListener('click', async () => {
    const cssSnippet = lastSnapshot && lastSnapshot.cssSnippet;
    if (!cssSnippet) {
      setStatus('No CSS snippet is available for this element.');
      return;
    }

    try {
      await navigator.clipboard.writeText(cssSnippet);
      const original = button.textContent;
      button.textContent = 'Copied';
      setStatus('CSS snippet copied.');
      setTimeout(() => {
        button.textContent = original;
      }, 900);
    } catch {
      setStatus('Copy failed. Try again.');
    }
  });
}

function setStatus(message) {
  statusText.textContent = message;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeAttr(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildDevtoolsSnapshot() {
  const el = $0;
  if (!el) return null;

  function getFullText(node) {
    return (node.textContent || '').replace(/\s+/g, ' ').trim();
  }

  function truncateValue(value, maxLength) {
    const text = String(value);
    return text.length > maxLength ? text.slice(0, maxLength) + '…' : text;
  }

  function primaryFont(fontFamily) {
    return fontFamily.split(',')[0].replace(/['"]/g, '').trim();
  }

  function rgbToHex(rgb) {
    const match = rgb && rgb.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
    if (!match) return null;
    const [r, g, b] = [Number(match[1]), Number(match[2]), Number(match[3])];
    if (r === 0 && g === 0 && b === 0) return null;
    return '#' + [r, g, b].map((part) => part.toString(16).padStart(2, '0')).join('');
  }

  function makeDataRow(key, value, tone, copyValue, swatch) {
    return {
      key,
      value: String(value),
      tone: tone || '',
      copyValue: copyValue || String(value),
      swatch: swatch || ''
    };
  }

  function buildColorRowData(key, value) {
    if (!value || value === 'transparent' || value === 'rgba(0, 0, 0, 0)') return null;
    const display = rgbToHex(value) || value;
    return makeDataRow(key, display, '', display, value);
  }

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

  function escapeCssIdentifier(value) {
    if (typeof CSS !== 'undefined' && CSS && typeof CSS.escape === 'function') {
      return CSS.escape(value);
    }
    return String(value).replace(/[^a-zA-Z0-9_-]/g, (char) => `\\${char}`);
  }

  function buildCssSelector(node) {
    function buildNodeSelectorPart(currentNode, classLimit) {
      const tag = currentNode.tagName.toLowerCase();
      if (currentNode.id) return `${tag}#${escapeCssIdentifier(currentNode.id)}`;
      const classes = Array.from(currentNode.classList)
        .slice(0, classLimit)
        .map((className) => `.${escapeCssIdentifier(className)}`)
        .join('');
      return `${tag}${classes}`;
    }

    function isUniqueSelector(selector) {
      try {
        return document.querySelector(selector) === node;
      } catch (_) {
        return false;
      }
    }

    const ancestry = [];
    let current = node;
    while (current && current !== document.body && ancestry.length < 4) {
      ancestry.unshift(current);
      if (current.id) break;
      current = current.parentElement;
    }

    for (let classLimit = 1; classLimit <= 2; classLimit += 1) {
      for (let start = ancestry.length - 1; start >= 0; start -= 1) {
        const selector = ancestry
          .slice(start)
          .map((currentNode) => buildNodeSelectorPart(currentNode, classLimit))
          .join(' > ');
        if (selector && isUniqueSelector(selector)) return selector;
      }
    }

    return ancestry
      .map((currentNode) => buildNodeSelectorPart(currentNode, 2))
      .join(' > ');
  }

  function hasUsefulOverflow(cs) {
    return cs.overflow !== 'visible' || cs.overflowX !== 'visible' || cs.overflowY !== 'visible';
  }

  function summarizeOverflow(cs) {
    return cs.overflowX === cs.overflowY ? cs.overflowX : `${cs.overflowX} / ${cs.overflowY}`;
  }

  function hasUsefulGap(cs) {
    return cs.gap && cs.gap !== 'normal' && cs.gap !== '0px';
  }

  function formatGap(cs) {
    return cs.rowGap === cs.columnGap ? cs.rowGap : `${cs.rowGap} / ${cs.columnGap}`;
  }

  function hasFlexAlignment(cs) {
    const isFlexible = cs.display.includes('flex') || cs.display.includes('grid');
    if (!isFlexible) return false;
    return cs.justifyContent !== 'normal' || (cs.alignItems !== 'normal' && cs.alignItems !== 'stretch');
  }

  function hasVisibleRadius(borderRadius) {
    return borderRadius && borderRadius !== '0px';
  }

  function hasUsefulFlexItem(cs) {
    return cs.flexGrow !== '0' || cs.flexShrink !== '1' || cs.flexBasis !== 'auto';
  }

  function summarizeFlexItem(cs) {
    return `${cs.flexGrow} ${cs.flexShrink} ${cs.flexBasis}`;
  }

  function hasUsefulGridPlacement(cs) {
    return (
      cs.gridColumnStart !== 'auto' ||
      cs.gridColumnEnd !== 'auto' ||
      cs.gridRowStart !== 'auto' ||
      cs.gridRowEnd !== 'auto'
    );
  }

  function summarizeGridPlacement(cs) {
    return `${cs.gridColumnStart} / ${cs.gridColumnEnd} • ${cs.gridRowStart} / ${cs.gridRowEnd}`;
  }

  function isZeroValue(value) {
    return Number.parseFloat(value) === 0;
  }

  function hasNonZeroBoxValues(values) {
    return values.some((value) => !isZeroValue(value));
  }

  function formatBoxValues(values) {
    const [top, right, bottom, left] = values;
    if (top === right && top === bottom && top === left) return top;
    if (top === bottom && right === left) return `${top} ${right}`;
    if (right === left) return `${top} ${right} ${bottom}`;
    return `${top} ${right} ${bottom} ${left}`;
  }

  function buildCssSnippet(selector, cs, options) {
    const declarations = [];
    const safeSelector = selector || 'element';
    const hasText = !!(options && options.hasText);
    const margin = options && options.margin ? options.margin : [];
    const padding = options && options.padding ? options.padding : [];
    const tag = options && options.tag ? options.tag : '';

    function pushDeclaration(property, value) {
      if (!value) return;
      declarations.push(`  ${property}: ${value};`);
    }

    pushDeclaration('display', cs.display);
    if (cs.position !== 'static') pushDeclaration('position', cs.position);
    if (cs.zIndex !== 'auto') pushDeclaration('z-index', cs.zIndex);

    if (tag !== 'img') {
      if (cs.overflowX === cs.overflowY) {
        if (cs.overflow !== 'visible') pushDeclaration('overflow', cs.overflow);
      } else {
        if (cs.overflowX !== 'visible') pushDeclaration('overflow-x', cs.overflowX);
        if (cs.overflowY !== 'visible') pushDeclaration('overflow-y', cs.overflowY);
      }
    }

    if (hasUsefulGap(cs)) {
      if (cs.rowGap === cs.columnGap) {
        pushDeclaration('gap', cs.rowGap);
      } else {
        pushDeclaration('row-gap', cs.rowGap);
        pushDeclaration('column-gap', cs.columnGap);
      }
    }

    if ((cs.display.includes('flex') || cs.display.includes('grid')) && cs.justifyContent !== 'normal') {
      pushDeclaration('justify-content', cs.justifyContent);
    }
    if ((cs.display.includes('flex') || cs.display.includes('grid')) && cs.alignItems !== 'normal' && cs.alignItems !== 'stretch') {
      pushDeclaration('align-items', cs.alignItems);
    }

    const textColor = rgbToHex(cs.color) || cs.color;
    const backgroundColor = rgbToHex(cs.backgroundColor) || cs.backgroundColor;
    if (hasText && textColor && textColor !== 'transparent' && textColor !== 'rgba(0, 0, 0, 0)') {
      pushDeclaration('color', textColor);
      pushDeclaration('font-family', cs.fontFamily);
      pushDeclaration('font-size', cs.fontSize);
      if (cs.fontWeight !== '400') pushDeclaration('font-weight', cs.fontWeight);
      if (cs.lineHeight !== 'normal') pushDeclaration('line-height', cs.lineHeight);
    }
    if (backgroundColor && backgroundColor !== 'transparent' && backgroundColor !== 'rgba(0, 0, 0, 0)') {
      pushDeclaration('background-color', backgroundColor);
    }
    if (cs.opacity !== '1') pushDeclaration('opacity', cs.opacity);
    if (hasVisibleRadius(cs.borderRadius)) pushDeclaration('border-radius', cs.borderRadius);
    if (cs.boxShadow !== 'none') pushDeclaration('box-shadow', cs.boxShadow);
    if (margin.length && hasNonZeroBoxValues(margin)) pushDeclaration('margin', formatBoxValues(margin));
    if (padding.length && hasNonZeroBoxValues(padding)) pushDeclaration('padding', formatBoxValues(padding));

    return `${safeSelector} {\n${declarations.join('\n')}\n}`;
  }

  const cs = getComputedStyle(el);
  const rect = el.getBoundingClientRect();
  const tag = el.tagName.toLowerCase();
  const fullText = getFullText(el);
  const identity = {
    tag,
    selector: buildSelector(el),
    rows: []
  };

  if (el.id) identity.rows.push(makeDataRow('id', '#' + el.id));
  if (el.classList.length) identity.rows.push(makeDataRow('classes', '.' + Array.from(el.classList).slice(0, 4).join(' .')));
  if (fullText) identity.rows.push(makeDataRow('text', truncateValue(fullText, 60), 'neutral', fullText));

  const elementProps = [];
  const state = [];
  const layout = [];
  const visual = [];
  const attributes = [];
  let imageSrc = '';

  if (el.hasAttribute('title')) {
    const title = el.getAttribute('title') || '(empty)';
    elementProps.push(makeDataRow('title', truncateValue(title, 48), title === '(empty)' ? 'neutral' : '', title));
  }

  if (tag === 'a' && el.hasAttribute('href')) {
    const href = el.getAttribute('href') || '(empty)';
    elementProps.push(makeDataRow('href', truncateValue(href, 56), '', href));
    if (el.hasAttribute('target')) elementProps.push(makeDataRow('target', el.getAttribute('target')));
    if (el.hasAttribute('rel')) elementProps.push(makeDataRow('rel', truncateValue(el.getAttribute('rel'), 40), 'neutral', el.getAttribute('rel')));
  }

  if (tag === 'img') {
    if (el.hasAttribute('src')) {
      const src = el.getAttribute('src') || '(empty)';
      imageSrc = el.currentSrc || el.getAttribute('src') || '';
      elementProps.push(makeDataRow('src', truncateValue(src, 56), '', src));
    }
    if (el.hasAttribute('alt')) elementProps.push(makeDataRow('alt', truncateValue(el.getAttribute('alt') || '(empty)', 48), 'neutral', el.getAttribute('alt') || '(empty)'));
    if (typeof el.naturalWidth === 'number' && typeof el.naturalHeight === 'number') {
      elementProps.push(makeDataRow('natural', `${el.naturalWidth}px × ${el.naturalHeight}px`));
    }
  }

  if (tag === 'input' || tag === 'textarea' || tag === 'select') {
    if (el.getAttribute('type')) elementProps.push(makeDataRow('type', el.getAttribute('type')));
    if (el.getAttribute('name')) elementProps.push(makeDataRow('name', el.getAttribute('name')));
    if (el.getAttribute('placeholder')) elementProps.push(makeDataRow('placeholder', truncateValue(el.getAttribute('placeholder'), 48), 'neutral', el.getAttribute('placeholder')));
    if (tag === 'select') {
      if (el.value) elementProps.push(makeDataRow('value', truncateValue(el.value, 48), '', el.value));
    } else {
      const inputType = (el.getAttribute('type') || '').toLowerCase();
      const value = inputType === 'password' ? '(hidden)' : (el.value || el.getAttribute('value'));
      const copyValue = inputType === 'password' ? '(hidden)' : value;
      if (value) elementProps.push(makeDataRow('value', truncateValue(value, 48), inputType === 'password' ? 'neutral' : '', copyValue));
    }
  }

  if (tag === 'button' && el.getAttribute('type')) elementProps.push(makeDataRow('type', el.getAttribute('type')));
  if (tag === 'label' && el.getAttribute('for')) elementProps.push(makeDataRow('for', el.getAttribute('for')));

  if (el.hasAttribute('disabled')) state.push(makeDataRow('disabled', 'true'));
  if (el.hasAttribute('required')) state.push(makeDataRow('required', 'true'));
  if (el.hasAttribute('readonly')) state.push(makeDataRow('readonly', 'true'));
  if (typeof el.checked === 'boolean' && el.checked) state.push(makeDataRow('checked', 'true'));
  if (typeof el.selected === 'boolean' && el.selected) state.push(makeDataRow('selected', 'true'));
  if (el.hasAttribute('hidden')) state.push(makeDataRow('hidden', 'true', 'neutral'));
  if (el.hasAttribute('tabindex')) state.push(makeDataRow('tabindex', el.getAttribute('tabindex')));
  if (el.getAttribute('contenteditable') === 'true') state.push(makeDataRow('editable', 'true'));
  if (cs.visibility !== 'visible') state.push(makeDataRow('visibility', cs.visibility, 'highlight'));
  if (cs.pointerEvents === 'none') state.push(makeDataRow('pointer-events', cs.pointerEvents, 'highlight'));

  layout.push(makeDataRow('size', `${Math.round(rect.width)}px × ${Math.round(rect.height)}px`));
  layout.push(makeDataRow('display', cs.display, cs.display === 'none' ? 'highlight' : ''));
  if (cs.position !== 'static') layout.push(makeDataRow('position', cs.position));
  if (cs.zIndex !== 'auto') layout.push(makeDataRow('z-index', cs.zIndex));
  if (hasUsefulOverflow(cs)) layout.push(makeDataRow('overflow', summarizeOverflow(cs)));
  if (hasUsefulGap(cs)) layout.push(makeDataRow('gap', formatGap(cs)));
  if (hasFlexAlignment(cs)) layout.push(makeDataRow('align', `${cs.justifyContent} / ${cs.alignItems}`));

  const parentLayout = [];
  if (el.parentElement) {
    const pcs = getComputedStyle(el.parentElement);
    const isFlexParent = pcs.display.includes('flex');
    const isGridParent = pcs.display.includes('grid');
    if (isFlexParent || isGridParent) parentLayout.push(makeDataRow('parent', pcs.display));
    if (hasUsefulGap(pcs)) parentLayout.push(makeDataRow('parent gap', formatGap(pcs)));
    if (hasFlexAlignment(pcs)) parentLayout.push(makeDataRow('parent align', `${pcs.justifyContent} / ${pcs.alignItems}`));
    if (isFlexParent && hasUsefulFlexItem(cs)) parentLayout.push(makeDataRow('item flex', summarizeFlexItem(cs)));
    if (isFlexParent && cs.alignSelf !== 'auto') parentLayout.push(makeDataRow('align-self', cs.alignSelf));
    if (isGridParent && hasUsefulGridPlacement(cs)) parentLayout.push(makeDataRow('grid', summarizeGridPlacement(cs)));
    if (isGridParent && cs.justifySelf !== 'auto') parentLayout.push(makeDataRow('justify-self', cs.justifySelf));
    if (isGridParent && cs.alignSelf !== 'auto') parentLayout.push(makeDataRow('align-self', cs.alignSelf));
  }

  const textColor = buildColorRowData('color', cs.color);
  const backgroundColor = buildColorRowData('background', cs.backgroundColor);
  if (textColor) visual.push(textColor);
  if (backgroundColor) visual.push(backgroundColor);
  if (fullText) visual.push(makeDataRow('font', primaryFont(cs.fontFamily)));
  if (fullText) visual.push(makeDataRow('font-size', cs.fontSize));
  if (fullText && cs.fontWeight !== '400') visual.push(makeDataRow('font-weight', cs.fontWeight));
  if (fullText && cs.lineHeight !== 'normal') visual.push(makeDataRow('line-height', cs.lineHeight));
  if (cs.opacity !== '1') visual.push(makeDataRow('opacity', cs.opacity));
  if (hasVisibleRadius(cs.borderRadius)) visual.push(makeDataRow('radius', cs.borderRadius));
  if (cs.boxShadow !== 'none') visual.push(makeDataRow('shadow', truncateValue(cs.boxShadow, 40), 'neutral', cs.boxShadow));

  ['role', 'aria-label', 'aria-labelledby', 'aria-describedby', 'aria-expanded', 'aria-hidden', 'aria-current', 'aria-pressed']
    .forEach((name) => {
      if (!el.hasAttribute(name)) return;
      const value = el.getAttribute(name) || '(empty)';
      attributes.push(makeDataRow(name, truncateValue(value, 48), value === '(empty)' ? 'neutral' : '', value));
    });

  Array.from(el.attributes)
    .filter((attr) => attr.name.startsWith('data-'))
    .slice(0, 4)
    .forEach((attr) => {
      const value = attr.value || '(empty)';
      attributes.push(makeDataRow(attr.name, truncateValue(value, 48), value === '(empty)' ? 'neutral' : '', value));
    });

  const margin = [cs.getPropertyValue('margin-top'), cs.getPropertyValue('margin-right'), cs.getPropertyValue('margin-bottom'), cs.getPropertyValue('margin-left')];
  const border = [cs.getPropertyValue('border-top-width'), cs.getPropertyValue('border-right-width'), cs.getPropertyValue('border-bottom-width'), cs.getPropertyValue('border-left-width')];
  const padding = [cs.getPropertyValue('padding-top'), cs.getPropertyValue('padding-right'), cs.getPropertyValue('padding-bottom'), cs.getPropertyValue('padding-left')];
  const summary = [];
  if (hasNonZeroBoxValues(margin)) summary.push(makeDataRow('margin', formatBoxValues(margin)));
  if (hasNonZeroBoxValues(border)) summary.push(makeDataRow('border', formatBoxValues(border)));
  if (hasNonZeroBoxValues(padding)) summary.push(makeDataRow('padding', formatBoxValues(padding)));

  return {
    source: 'selection',
    capturedAt: Date.now(),
    pageTitle: document.title,
    pageUrl: location.href,
    identity,
    elementProps,
    imageSrc,
    state,
    layout,
    parentLayout,
    cssSnippet: buildCssSnippet(buildCssSelector(el) || tag, cs, { hasText: !!fullText, tag, margin, padding }),
    boxModel: summary.length ? { summary, margin, border, padding, size: `${Math.round(rect.width)} × ${Math.round(rect.height)}` } : null,
    visual,
    attributes
  };
}
