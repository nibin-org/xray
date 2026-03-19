if (window.__XRAY_INSPECTOR_INSTANCE__ && window.__XRAY_INSPECTOR_INSTANCE__.destroy) {
  window.__XRAY_INSPECTOR_INSTANCE__.destroy(false);
}

(() => {
  const INSTANCE_ID = `xray_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const DEFAULT_FOOTER_MESSAGE = 'Click any value to copy • ESC to turn off';
  const SETTINGS_FOOTER_MESSAGE = 'Manage Xray settings and DevTools integration.';
  const DEVTOOLS_ENABLED_KEY = 'xray_devtools_enabled';
  const PANEL_WIDTH_KEY = 'xray_panel_width';
  const PANEL_POSITION_KEY = 'xray_panel_position';
  const DEFAULT_PANEL_WIDTH = 350;
  const MIN_PANEL_WIDTH = 350;
  const MAX_PANEL_WIDTH = 550;
  const DEFAULT_PANEL_POSITION = 'right';
  const sharedState = window.__XRAY_INSPECTOR_SHARED__ || (window.__XRAY_INSPECTOR_SHARED__ = {
    activeInstanceId: null,
    inspectingEnabled: false
  });

  let isEnabled = false;
  let currentTabId = null;
  let lockedTarget = null;
  let footerResetTimer = null;
  let highlightEl = null;
  let panelEl = null;
  let panelScroll = null;
  let activeSidebarTab = 'settings';
  let devtoolsPersistedEnabled = false;
  let devtoolsHintPending = false;
  let lastInspectedTarget = null;
  let panelWidth = DEFAULT_PANEL_WIDTH;
  let panelPosition = DEFAULT_PANEL_POSITION;
  let resizeCleanup = null;
  let resizeDragCleanup = null;
  let collapsedSections = new Set();

  window.__DOM_INSPECTOR_DISABLE__ = () => disable(false);
  window.__XRAY_INSPECTOR_INSTANCE__ = {
    destroy,
    instanceId: INSTANCE_ID
  };

  const messageListener = (msg, sender, sendResponse) => {
    if (!msg || !msg.type) return;
    if (msg.type === 'OPEN_XRAY_SIDEBAR') {
      if (msg.tabId) currentTabId = msg.tabId;
      sharedState.activeInstanceId = INSTANCE_ID;
      enable();
      return;
    }
    if (msg.type === 'GET_XRAY_SIDEBAR_STATUS') {
      sendResponse({ visible: !!document.getElementById('__dom_inspector_panel__') });
      return;
    }
    if (msg.type === 'TOGGLE_INSPECTOR') {
      if (msg.tabId) currentTabId = msg.tabId;
      sharedState.activeInstanceId = INSTANCE_ID;
      msg.enabled ? enable() : disable(false);
    }
  };

  const storageChangeListener = (changes, areaName) => {
    if (areaName !== 'local' || !changes[DEVTOOLS_ENABLED_KEY]) return;
    const enabled = changes[DEVTOOLS_ENABLED_KEY].newValue === true;
    devtoolsPersistedEnabled = enabled;
    updateDevtoolsToggle(enabled, { showPending: devtoolsHintPending });
  };

  chrome.runtime.onMessage.addListener(messageListener);
  chrome.storage.onChanged.addListener(storageChangeListener);

  // ─── Enable / Disable ────────────────────────────────────────────
  function enable() {
    sharedState.activeInstanceId = INSTANCE_ID;
    sharedState.inspectingEnabled = true;
    createHighlight();
    createPanel();
    setDefaultSidebarTab();
    updatePanelToggle(true);
    updateInspectorControl(true);
    setInspectorStoredState(true);
    if (isEnabled) return;
    isEnabled = true;
    showHome();
    addInspectingListeners();
  }

  // Disable only inspecting, keep panel visible
  function disableInspecting() {
    if (!isEnabled && !isActiveInstance()) {
      return;
    }
    isEnabled = false;
    sharedState.activeInstanceId = INSTANCE_ID;
    sharedState.inspectingEnabled = false;
    lockedTarget = null;
    removeHighlight();
    removeInspectingListeners();
    updatePanelToggle(false);
    updateInspectorControl(false);
    showHome(true);
    setInspectorStoredState(false);
    safeSendMessage({ type: 'INSPECTOR_CLOSED' });
  }

  // Re-enable inspecting from panel toggle
  function enableInspecting() {
    sharedState.activeInstanceId = INSTANCE_ID;
    sharedState.inspectingEnabled = true;
    createHighlight();
    createPanel();
    setDefaultSidebarTab();
    updatePanelToggle(true);
    updateInspectorControl(true);
    setInspectorStoredState(true);
    if (isEnabled) return;
    isEnabled = true;
    showHome();
    addInspectingListeners();
    safeSendMessage({ type: 'INSPECTOR_OPENED' });
  }

  // Full disable — removes panel too
  function disable(notifyPopup = true) {
    isEnabled = false;
    lockedTarget = null;
    lastInspectedTarget = null;
    removeInspectingListeners();
    if (sharedState.activeInstanceId === INSTANCE_ID) {
      sharedState.activeInstanceId = null;
      sharedState.inspectingEnabled = false;
    }
    removeHighlight();
    removePanel();
    setInspectorStoredState(false);
    if (notifyPopup) {
      safeSendMessage({ type: 'INSPECTOR_CLOSED' });
    }
  }

  function destroy(notifyPopup = false) {
    disable(notifyPopup);
    chrome.runtime.onMessage.removeListener(messageListener);
    chrome.storage.onChanged.removeListener(storageChangeListener);
    if (window.__XRAY_INSPECTOR_INSTANCE__ && window.__XRAY_INSPECTOR_INSTANCE__.instanceId === INSTANCE_ID) {
      delete window.__XRAY_INSPECTOR_INSTANCE__;
    }
    if (window.__DOM_INSPECTOR_DISABLE__ && window.__XRAY_INSPECTOR_INSTANCE__ == null) {
      delete window.__DOM_INSPECTOR_DISABLE__;
    }
  }

  function updatePanelToggle(checked) {
    const input = document.getElementById('__dip_panel_toggle_input__');
    if (input) input.checked = checked;
  }

  function getMaxPanelWidth() {
    return Math.max(MIN_PANEL_WIDTH, Math.min(MAX_PANEL_WIDTH, window.innerWidth - 24));
  }

  function normalizePanelWidth(width) {
    const numericWidth = Number(width);
    if (!Number.isFinite(numericWidth)) return DEFAULT_PANEL_WIDTH;
    return Math.max(MIN_PANEL_WIDTH, Math.min(getMaxPanelWidth(), Math.round(numericWidth)));
  }

  function applyPanelWidth() {
    if (!panelEl) return;
    panelEl.style.width = `${panelWidth}px`;
    updateResizeMeta();
  }

  function normalizePanelPosition(position) {
    return position === 'left' ? 'left' : 'right';
  }

  function applyPanelPosition() {
    if (!panelEl) return;
    panelEl.setAttribute('data-side', panelPosition);
    updatePositionControls();
  }

  function updateResizeMeta() {
    const value = document.getElementById('__dip_resize_value__');
    if (value) value.textContent = `${panelWidth}px`;
  }

  function updatePositionControls() {
    const badge = document.getElementById('__dip_position_value__');
    const leftButton = document.getElementById('__dip_position_left__');
    const rightButton = document.getElementById('__dip_position_right__');

    if (badge) badge.textContent = panelPosition === 'left' ? 'Left' : 'Right';
    if (leftButton) leftButton.classList.toggle('active', panelPosition === 'left');
    if (rightButton) rightButton.classList.toggle('active', panelPosition === 'right');
  }

  function getDefaultFooterMessage() {
    return activeSidebarTab === 'settings' ? SETTINGS_FOOTER_MESSAGE : DEFAULT_FOOTER_MESSAGE;
  }

  function updateInspectorControl(enabled) {
    const control = document.getElementById('__dip_inspector_control__');
    const badge = document.getElementById('__dip_inspector_badge__');
    const status = document.getElementById('__dip_inspector_status__');

    if (control) control.classList.toggle('active', enabled);
    if (badge) {
      badge.textContent = enabled ? 'On' : 'Off';
      badge.classList.toggle('off', !enabled);
    }
    if (status) {
      status.textContent = enabled
        ? 'Click elements on the page to capture details'
        : 'Turn it on to capture details from the page';
    }
  }

  function updateDevtoolsToggle(enabled, options = {}) {
    const { showPending = false } = options;
    const input = document.getElementById('__dip_devtools_toggle_input__');
    const control = document.getElementById('__dip_devtools_control__');
    const badge = document.getElementById('__dip_devtools_badge__');
    const meta = document.getElementById('__dip_devtools_meta__');
    const button = document.getElementById('__dip_devtools_btn__');

    if (input) input.checked = enabled;
    if (control) control.classList.toggle('active', enabled);
    if (badge) {
      badge.textContent = enabled ? 'On' : 'Off';
      badge.classList.toggle('off', !enabled);
    }
    if (meta) {
      meta.classList.toggle('visible', showPending);
      meta.textContent = showPending ? 'Restart DevTools to apply this change.' : '';
    }
    if (button) button.disabled = !enabled;
  }

  function syncPanelControls() {
    updatePanelToggle(sharedState.inspectingEnabled);
    updateInspectorControl(sharedState.inspectingEnabled);
    updateDevtoolsToggle(devtoolsPersistedEnabled, { showPending: devtoolsHintPending });
  }

  function updateTabButtons() {
    const homeTab = document.getElementById('__dip_tab_home__');
    const settingsTab = document.getElementById('__dip_tab_settings__');
    if (homeTab) homeTab.classList.toggle('active', activeSidebarTab === 'home');
    if (settingsTab) settingsTab.classList.toggle('active', activeSidebarTab === 'settings');
  }

  function setActiveSidebarTab(tab, options = {}) {
    activeSidebarTab = tab === 'settings' ? 'settings' : 'home';
    updateTabButtons();
    renderCurrentView();
  }

  function setDefaultSidebarTab() {
    activeSidebarTab = lastInspectedTarget && document.contains(lastInspectedTarget)
      ? 'home'
      : 'settings';
    updateTabButtons();
    renderCurrentView();
  }

  function loadDevtoolsPreference() {
    safeStorageGet([DEVTOOLS_ENABLED_KEY], (result) => {
      devtoolsPersistedEnabled = result[DEVTOOLS_ENABLED_KEY] === true;
      syncPanelControls();
    });
  }

  function loadPanelWidthPreference() {
    safeStorageGet([PANEL_WIDTH_KEY], (result) => {
      panelWidth = normalizePanelWidth(result[PANEL_WIDTH_KEY]);
      applyPanelWidth();
    });
  }

  function loadPanelPositionPreference() {
    safeStorageGet([PANEL_POSITION_KEY], (result) => {
      panelPosition = normalizePanelPosition(result[PANEL_POSITION_KEY]);
      applyPanelPosition();
    });
  }

  function resetPanelWidth() {
    panelWidth = DEFAULT_PANEL_WIDTH;
    applyPanelWidth();
    safeStorageRemove([PANEL_WIDTH_KEY]);
    updateFooterMessage('Sidebar width reset to default.', 'info', true);
  }

  function resetAllSettings() {
    panelWidth = DEFAULT_PANEL_WIDTH;
    panelPosition = DEFAULT_PANEL_POSITION;
    devtoolsPersistedEnabled = false;
    devtoolsHintPending = false;

    applyPanelWidth();
    applyPanelPosition();
    updateDevtoolsToggle(false, { showPending: false });

    safeStorageRemove([DEVTOOLS_ENABLED_KEY, PANEL_WIDTH_KEY, PANEL_POSITION_KEY]);

    if (!sharedState.inspectingEnabled) {
      enableInspecting();
    } else {
      updatePanelToggle(true);
      updateInspectorControl(true);
      setInspectorStoredState(true);
    }

    setActiveSidebarTab('settings');
    updateFooterMessage('Settings reset to defaults.', 'info', true);
  }

  function setInspectorStoredState(enabled) {
    if (!currentTabId) return;
    const storageKey = `inspector_${currentTabId}`;
    if (enabled) {
      safeStorageSet({ [storageKey]: true });
      return;
    }
    safeStorageRemove([storageKey]);
  }

  function showHome() {
    lockedTarget = null;
    if (highlightEl) highlightEl.style.display = 'none';
    renderCurrentView();
  }

  // ─── Highlight ───────────────────────────────────────────────────
  function createHighlight() {
    if (document.getElementById('__dom_inspector_highlight__')) {
      highlightEl = document.getElementById('__dom_inspector_highlight__');
      return;
    }
    highlightEl = document.createElement('div');
    highlightEl.id = '__dom_inspector_highlight__';
    document.body.appendChild(highlightEl);
  }

  function removeHighlight() {
    const el = document.getElementById('__dom_inspector_highlight__');
    if (el) el.remove();
    highlightEl = null;
  }

  function positionHighlight(el, locked) {
    if (!highlightEl || !el) return;
    const r = el.getBoundingClientRect();
    Object.assign(highlightEl.style, {
      top: r.top + 'px',
      left: r.left + 'px',
      width: r.width + 'px',
      height: r.height + 'px',
      display: 'block'
    });
    highlightEl.setAttribute('data-tag', el.tagName.toLowerCase());
    highlightEl.classList.toggle('locked', !!locked);
  }

  // ─── Panel ───────────────────────────────────────────────────────
  function createPanel() {
    const existing = document.getElementById('__dom_inspector_panel__');
    if (existing) {
      panelEl = existing;
      panelScroll = panelEl.querySelector('.__dip_scroll__');
      notifySidebarVisibility(true);
      syncPanelControls();
      loadDevtoolsPreference();
      loadPanelWidthPreference();
      loadPanelPositionPreference();
      applyPanelWidth();
      applyPanelPosition();
      return;
    }
    panelEl = document.createElement('div');
    panelEl.id = '__dom_inspector_panel__';
    panelEl.innerHTML = `
      <div class="__dip_resize_handle__" id="__dip_resize_handle__" title="Drag to resize sidebar"></div>
      <div class="__dip_header__">
        <div class="__dip_header_brand__">
          <div class="__dip_header_icon__">⬡</div>
          <div class="__dip_header_copy__">
            <span class="__dip_header_title__">Xray</span>
            <span class="__dip_header_subtitle__">DOM Inspector</span>
          </div>
        </div>
        <button class="__dip_close__" id="__dip_close_btn__" title="Hide sidebar">✕</button>
      </div>
      <div class="__dip_tabbar__">
        <button class="__dip_tab__ active" id="__dip_tab_home__" type="button">Home</button>
        <button class="__dip_tab__" id="__dip_tab_settings__" type="button">Settings</button>
      </div>
      <div class="__dip_scroll__"></div>
      <div class="__dip_footer__" id="__dip_footer__">${DEFAULT_FOOTER_MESSAGE}</div>
    `;
    document.body.appendChild(panelEl);
    panelScroll = panelEl.querySelector('.__dip_scroll__');
    notifySidebarVisibility(true);
    bindResizeHandle();
    applyPanelWidth();
    applyPanelPosition();

    document.getElementById('__dip_close_btn__').addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      handleCloseButton();
    });

    document.getElementById('__dip_tab_home__').addEventListener('click', () => {
      setActiveSidebarTab('home');
    });

    document.getElementById('__dip_tab_settings__').addEventListener('click', () => {
      setActiveSidebarTab('settings');
    });

    updateTabButtons();
    renderCurrentView();
    syncPanelControls();
    loadDevtoolsPreference();
    loadPanelWidthPreference();
    loadPanelPositionPreference();
  }

  function renderCurrentView() {
    if (!panelScroll) panelScroll = document.querySelector('#__dom_inspector_panel__ .__dip_scroll__');
    if (!panelScroll) return;

    updateTabButtons();

    if (activeSidebarTab === 'settings') {
      renderSettingsView();
      return;
    }

    if (!sharedState.inspectingEnabled) {
      renderHomeEmpty(true);
      return;
    }

    if (lastInspectedTarget && document.contains(lastInspectedTarget)) {
      renderElementDetails(lastInspectedTarget);
      return;
    }

    lastInspectedTarget = null;
    renderHomeEmpty(false);
  }

  function renderHomeEmpty(inspectorDisabled) {
    panelScroll.innerHTML = inspectorDisabled
      ? `<div class="__dip_empty__ __dip_content_fade__">
          <div class="__dip_empty_icon__">⬡</div>
          <div class="__dip_empty_title__">Capture is off</div>
          <div class="__dip_empty_text__">Turn it back on from Settings to inspect elements.</div>
          <button class="__dip_empty_action__" type="button" id="__dip_empty_settings_btn__">Open Settings</button>
        </div>`
      : `<div class="__dip_empty__ __dip_content_fade__">
          <div class="__dip_empty_icon__">⬡</div>
          <div class="__dip_empty_title__">Ready to inspect</div>
          <div class="__dip_empty_text__">Click any element on the page<br>to inspect its properties</div>
        </div>`;

    const settingsButton = document.getElementById('__dip_empty_settings_btn__');
    if (settingsButton) {
      settingsButton.addEventListener('click', (e) => {
        e.stopPropagation();
        setActiveSidebarTab('settings');
      });
    }

    updateFooterMessage(getDefaultFooterMessage());
  }

  function renderSettingsView() {
    panelScroll.innerHTML = `
      <div class="__dip_controls__ __dip_content_fade__">
        <div class="__dip_settings_intro__">
          <div class="__dip_settings_title__">Settings</div>
          <div class="__dip_settings_text__">Control how Xray behaves on the page and inside DevTools.</div>
        </div>
        <div class="__dip_control__" id="__dip_inspector_control__">
          <div class="__dip_control_copy__">
            <div class="__dip_control_heading__">
              <span class="__dip_control_title__">Capture</span>
              <span class="__dip_control_badge__" id="__dip_inspector_badge__">On</span>
            </div>
            <div class="__dip_control_desc__" id="__dip_inspector_status__">Click elements on the page to capture details</div>
          </div>
          <label class="__dip_panel_toggle__" title="Toggle page capture">
            <input type="checkbox" id="__dip_panel_toggle_input__" checked>
            <span class="__dip_panel_toggle_track__"><span class="__dip_panel_toggle_thumb__"></span></span>
          </label>
        </div>
        <div class="__dip_control__" id="__dip_devtools_control__">
          <div class="__dip_control_copy__">
            <div class="__dip_control_heading__">
              <span class="__dip_control_title__">DevTools</span>
              <span class="__dip_control_badge__" id="__dip_devtools_badge__">On</span>
            </div>
            <div class="__dip_control_desc__">Show Xray inside Chrome DevTools</div>
            <div class="__dip_control_actions__">
              <button class="__dip_secondary_btn__ __dip_secondary_btn_inline__" id="__dip_devtools_btn__" type="button">
                Open in DevTools
              </button>
              <div class="__dip_control_meta__" id="__dip_devtools_meta__"></div>
            </div>
          </div>
          <label class="__dip_panel_toggle__" title="Toggle DevTools integration">
            <input type="checkbox" id="__dip_devtools_toggle_input__" checked>
            <span class="__dip_panel_toggle_track__"><span class="__dip_panel_toggle_thumb__"></span></span>
          </label>
        </div>
        <div class="__dip_control__">
          <div class="__dip_control_copy__">
            <div class="__dip_control_heading__">
              <span class="__dip_control_title__">Sidebar Width</span>
              <span class="__dip_control_badge__" id="__dip_resize_value__">${panelWidth}px</span>
            </div>
            <div class="__dip_control_desc__">Drag the outer edge of the sidebar to resize it. Xray will remember your width.</div>
          </div>
          <button class="__dip_choice_btn__" id="__dip_reset_width__" type="button">Reset</button>
        </div>
        <div class="__dip_control__">
          <div class="__dip_control_copy__">
            <div class="__dip_control_heading__">
              <span class="__dip_control_title__">Sidebar Position</span>
              <span class="__dip_control_badge__" id="__dip_position_value__">${panelPosition === 'left' ? 'Left' : 'Right'}</span>
            </div>
            <div class="__dip_control_desc__">Choose which side of the page Xray should dock to.</div>
          </div>
          <div class="__dip_choice_group__" role="group" aria-label="Sidebar position">
            <button class="__dip_choice_btn__" id="__dip_position_left__" type="button">Left</button>
            <button class="__dip_choice_btn__" id="__dip_position_right__" type="button">Right</button>
          </div>
        </div>
        <button class="__dip_secondary_btn__ __dip_secondary_btn_danger__" id="__dip_reset_settings__" type="button">
          Reset All Settings
        </button>
      </div>
    `;

    bindSettingsControls();
    syncPanelControls();
    updateResizeMeta();
    updatePositionControls();
    updateFooterMessage(getDefaultFooterMessage());
  }

  function bindSettingsControls() {
    const devtoolsButton = document.getElementById('__dip_devtools_btn__');
    const devtoolsToggle = document.getElementById('__dip_devtools_toggle_input__');
    const inspectorToggle = document.getElementById('__dip_panel_toggle_input__');
    const positionLeft = document.getElementById('__dip_position_left__');
    const positionRight = document.getElementById('__dip_position_right__');
    const resetWidthButton = document.getElementById('__dip_reset_width__');
    const resetSettingsButton = document.getElementById('__dip_reset_settings__');

    if (devtoolsButton) {
      devtoolsButton.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        if (lastInspectedTarget) persistSnapshot(lastInspectedTarget, 'overlay');
        showDevToolsHint();
      });
    }

    if (devtoolsToggle) {
      devtoolsToggle.addEventListener('change', (e) => {
        e.stopPropagation();
        const enabled = e.target.checked;
        devtoolsHintPending = true;
        devtoolsPersistedEnabled = enabled;
        updateDevtoolsToggle(enabled, { showPending: true });
        safeStorageSet({ [DEVTOOLS_ENABLED_KEY]: enabled });
      });
    }

    if (inspectorToggle) {
      inspectorToggle.addEventListener('change', (e) => {
        e.stopPropagation();
        if (e.target.checked) {
          enableInspecting();
        } else {
          disableInspecting();
        }
      });
    }

    if (positionLeft) {
      positionLeft.addEventListener('click', (e) => {
        e.stopPropagation();
        panelPosition = 'left';
        applyPanelPosition();
        safeStorageSet({ [PANEL_POSITION_KEY]: panelPosition });
      });
    }

    if (positionRight) {
      positionRight.addEventListener('click', (e) => {
        e.stopPropagation();
        panelPosition = 'right';
        applyPanelPosition();
        safeStorageSet({ [PANEL_POSITION_KEY]: panelPosition });
      });
    }

    if (resetWidthButton) {
      resetWidthButton.addEventListener('click', (e) => {
        e.stopPropagation();
        resetPanelWidth();
      });
    }

    if (resetSettingsButton) {
      resetSettingsButton.addEventListener('click', (e) => {
        e.stopPropagation();
        resetAllSettings();
      });
    }
  }

  function removePanel() {
    if (resizeDragCleanup) {
      resizeDragCleanup();
      resizeDragCleanup = null;
    }
    if (resizeCleanup) {
      resizeCleanup();
      resizeCleanup = null;
    }
    const el = document.getElementById('__dom_inspector_panel__');
    if (el) el.remove();
    panelEl = null;
    panelScroll = null;
    notifySidebarVisibility(false);
    if (footerResetTimer) {
      clearTimeout(footerResetTimer);
      footerResetTimer = null;
    }
  }

  function closePanelOnly() {
    removePanel();
  }

  function bindResizeHandle() {
    const handle = document.getElementById('__dip_resize_handle__');
    if (!handle) return;

    handle.addEventListener('mousedown', (event) => {
      event.preventDefault();
      event.stopPropagation();

      const startWidth = panelWidth;
      const startX = event.clientX;
      const previousCursor = document.body.style.cursor;
      const previousUserSelect = document.body.style.userSelect;

      document.body.style.cursor = 'ew-resize';
      document.body.style.userSelect = 'none';

      const onMouseMove = (moveEvent) => {
        const delta = moveEvent.clientX - startX;
        const nextWidth = normalizePanelWidth(
          panelPosition === 'left' ? startWidth + delta : startWidth - delta
        );
        if (nextWidth === panelWidth) return;
        panelWidth = nextWidth;
        applyPanelWidth();
      };

      const onMouseUp = () => {
        document.body.style.cursor = previousCursor;
        document.body.style.userSelect = previousUserSelect;
        window.removeEventListener('mousemove', onMouseMove);
        window.removeEventListener('mouseup', onMouseUp);
        resizeDragCleanup = null;
        safeStorageSet({ [PANEL_WIDTH_KEY]: panelWidth });
      };

      window.addEventListener('mousemove', onMouseMove);
      window.addEventListener('mouseup', onMouseUp);

      resizeDragCleanup = () => {
        document.body.style.cursor = previousCursor;
        document.body.style.userSelect = previousUserSelect;
        window.removeEventListener('mousemove', onMouseMove);
        window.removeEventListener('mouseup', onMouseUp);
      };
    });

    window.addEventListener('resize', handleViewportResize);
    resizeCleanup = () => {
      window.removeEventListener('resize', handleViewportResize);
    };
  }

  function handleViewportResize() {
    const normalizedWidth = normalizePanelWidth(panelWidth);
    if (normalizedWidth === panelWidth) return;
    panelWidth = normalizedWidth;
    applyPanelWidth();
    safeStorageSet({ [PANEL_WIDTH_KEY]: panelWidth });
  }

  function addInspectingListeners() {
    document.addEventListener('mouseover', onMouseOver, true);
    document.addEventListener('mouseout', onMouseOut, true);
    document.addEventListener('click', onClick, true);
    document.addEventListener('keydown', onKeyDown, true);
  }

  function removeInspectingListeners() {
    document.removeEventListener('mouseover', onMouseOver, true);
    document.removeEventListener('mouseout', onMouseOut, true);
    document.removeEventListener('click', onClick, true);
    document.removeEventListener('keydown', onKeyDown, true);
  }

  function isActiveInstance() {
    return sharedState.activeInstanceId === INSTANCE_ID;
  }

  function canInspect() {
    return isEnabled && isActiveInstance() && sharedState.inspectingEnabled;
  }

  // ─── Events ──────────────────────────────────────────────────────
  function isInPanel(el) {
    // Use DOM query instead of variable reference — more reliable after re-injection
    const panel = document.getElementById('__dom_inspector_panel__');
    return panel && (el === panel || panel.contains(el));
  }

  function onMouseOver(e) {
    if (!canInspect()) return;
    const t = e.target;
    if (!t || isInPanel(t) || t.id === '__dom_inspector_highlight__') return;
    lockedTarget = null;
    positionHighlight(t, false);
  }

  function onMouseOut(e) {
    if (!canInspect()) {
      if (highlightEl) highlightEl.style.display = 'none';
      return;
    }
    if (!lockedTarget && highlightEl) {
      const related = e.relatedTarget;
      if (!related || isInPanel(related)) return;
      highlightEl.style.display = 'none';
    }
  }

  function onClick(e) {
    // Close button — handle first before anything else
    if (e.target.id === '__dip_close_btn__' || e.target.closest('#__dip_close_btn__')) {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      handleCloseButton();
      return;
    }

    // Any other click inside panel — let it through (scrolling, copy buttons etc.)
    if (isInPanel(e.target)) return;
    if (e.target.id === '__dom_inspector_highlight__') return;
    if (!canInspect()) return;

    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();

    if (lockedTarget === e.target) return;
    lockedTarget = e.target;
    positionHighlight(e.target, true);
    renderPanel(e.target);
    persistSnapshot(e.target, 'overlay');
  }

  function onKeyDown(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      disable(true);
    }
  }

  // ─── Render ──────────────────────────────────────────────────────
  function renderPanel(el) {
    lastInspectedTarget = el;
    if (activeSidebarTab !== 'home') {
      setActiveSidebarTab('home');
      return;
    }
    renderElementDetails(el);
  }

  function renderElementDetails(el) {
    if (!panelScroll) panelScroll = document.querySelector('#__dom_inspector_panel__ .__dip_scroll__');
    if (!panelScroll || !el) return;
    const cs = window.getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    const sections = [
      renderIdentity(el),
      renderElementProps(el),
      renderState(el, cs),
      renderLayout(rect, cs),
      renderParentLayout(el, cs),
      renderBoxModel(cs, rect),
      renderVisual(el, cs),
      renderAttributes(el)
    ].filter(Boolean).join('');

    panelScroll.innerHTML = `
      <div class="__dip_content_fade__">
        ${sections}
      </div>`;

    panelScroll.querySelectorAll('.__dip_section__').forEach(sec => {
      if (collapsedSections.has(sec.dataset.sectionId)) sec.classList.add('collapsed');
    });

    panelScroll.querySelectorAll('.__dip_section_header__').forEach(hdr => {
      hdr.addEventListener('click', () => {
        const sec = hdr.closest('.__dip_section__');
        const id = sec.dataset.sectionId;
        sec.classList.toggle('collapsed');
        collapsedSections[sec.classList.contains('collapsed') ? 'add' : 'delete'](id);
      });
    });

    panelScroll.querySelectorAll('.__dip_val__').forEach(v => {
      v.addEventListener('click', (e) => {
        e.stopPropagation();
        navigator.clipboard.writeText(v.dataset.copy || v.textContent).then(() => {
          const orig = v.textContent;
          v.classList.add('copied');
          v.textContent = '✓ copied';
          setTimeout(() => { v.textContent = orig; v.classList.remove('copied'); }, 1200);
        });
      });
    });

    panelScroll.querySelectorAll('.__dip_selector__').forEach(s => {
      s.addEventListener('click', (e) => {
        e.stopPropagation();
        navigator.clipboard.writeText(s.textContent).then(() => {
          const orig = s.textContent;
          s.textContent = '✓ Copied!';
          setTimeout(() => s.textContent = orig, 1200);
        });
      });
    });

    updateFooterMessage(getDefaultFooterMessage());
  }

  // ─── Section Helpers ─────────────────────────────────────────────
  function section(id, emoji, title, body) {
    return `<div class="__dip_section__" data-section-id="${id}">
      <div class="__dip_section_header__">
        <span class="__dip_section_emoji__">${emoji}</span>
        <span class="__dip_section_title__">${title}</span>
        <span class="__dip_section_chevron__">▾</span>
      </div>
      <div class="__dip_section_body__">${body}</div>
    </div>`;
  }

  function row(key, val, cls = '', copyVal = '') {
    const safe = escHtml(String(val));
    const copy = copyVal || safe;
    return `<div class="__dip_row__">
      <span class="__dip_key__">${key}</span>
      <span class="__dip_val__ ${cls}" data-copy="${escAttr(copy)}" title="${escAttr(copy)}">${safe}</span>
    </div>`;
  }

  function colorRow(key, val) {
    const hex = rgbToHex(val);
    const display = hex || val;
    return `<div class="__dip_row__">
      <span class="__dip_key__">${key}</span>
      <div class="__dip_color_row__">
        <span class="__dip_swatch__" style="background:${val}"></span>
        <span class="__dip_val__" data-copy="${escAttr(display)}" title="${escAttr(display)}">${escHtml(display)}</span>
      </div>
    </div>`;
  }

  function renderIdentity(el) {
    const tag = el.tagName.toLowerCase();
    const selector = buildSelector(el);
    const fullText = getFullText(el);
    const text = truncateValue(fullText, 60);
    const rows = [
      el.id ? row('id', '#' + el.id) : '',
      el.classList.length ? row('classes', '.' + [...el.classList].slice(0, 4).join(' .')) : '',
      fullText ? row('text', text, 'neutral', fullText) : ''
    ].filter(Boolean).join('');

    return section('identity', '🏷️', 'Identity', `
      <div class="__dip_tag_badge__">
        <span class="__dip_tag_inner__">&lt;</span>${escHtml(tag)}<span class="__dip_tag_inner__">&gt;</span>
      </div>
      <div class="__dip_selector__" title="Click to copy">${escHtml(selector)}</div>
      ${rows}
    `);
  }

  function renderElementProps(el) {
    const rows = [];
    const tag = el.tagName.toLowerCase();

    if (el.hasAttribute('title')) {
      const title = el.getAttribute('title') || '(empty)';
      rows.push(row('title', truncateValue(title, 48), title === '(empty)' ? 'neutral' : '', title));
    }

    if (tag === 'a' && el.hasAttribute('href')) {
      const href = el.getAttribute('href') || '(empty)';
      rows.push(row('href', truncateValue(href, 56), '', href));
      if (el.hasAttribute('target')) rows.push(row('target', el.getAttribute('target')));
      if (el.hasAttribute('rel')) rows.push(row('rel', truncateValue(el.getAttribute('rel'), 40), 'neutral', el.getAttribute('rel')));
    }

    if (tag === 'img') {
      if (el.hasAttribute('src')) {
        const src = el.getAttribute('src') || '(empty)';
        rows.push(row('src', truncateValue(src, 56), '', src));
      }
      if (el.hasAttribute('alt')) rows.push(row('alt', truncateValue(el.getAttribute('alt') || '(empty)', 48), 'neutral', el.getAttribute('alt') || '(empty)'));
      if (typeof el.naturalWidth === 'number' && typeof el.naturalHeight === 'number') {
        rows.push(row('natural', `${el.naturalWidth}px × ${el.naturalHeight}px`));
      }
    }

    if (tag === 'input' || tag === 'textarea' || tag === 'select') {
      if (el.getAttribute('type')) rows.push(row('type', el.getAttribute('type')));
      if (el.getAttribute('name')) rows.push(row('name', el.getAttribute('name')));
      if (el.getAttribute('placeholder')) rows.push(row('placeholder', truncateValue(el.getAttribute('placeholder'), 48), 'neutral', el.getAttribute('placeholder')));
      if (tag === 'select') {
        if (el.value) rows.push(row('value', truncateValue(el.value, 48), '', el.value));
      } else {
        const inputType = (el.getAttribute('type') || '').toLowerCase();
        const value = inputType === 'password' ? '(hidden)' : (el.value || el.getAttribute('value'));
        const copyValue = inputType === 'password' ? '(hidden)' : value;
        if (value) rows.push(row('value', truncateValue(value, 48), inputType === 'password' ? 'neutral' : '', copyValue));
      }
    }

    if (tag === 'button' && el.getAttribute('type')) {
      rows.push(row('type', el.getAttribute('type')));
    }

    if (tag === 'label' && el.getAttribute('for')) {
      rows.push(row('for', el.getAttribute('for')));
    }

    return rows.length ? section('element', '🧩', 'Element Props', rows.join('')) : '';
  }

  function renderBoxModel(cs, rect) {
    const g = p => cs.getPropertyValue(p);
    const w = Math.round(rect.width), h = Math.round(rect.height);
    const margin = [g('margin-top'), g('margin-right'), g('margin-bottom'), g('margin-left')];
    const border = [g('border-top-width'), g('border-right-width'), g('border-bottom-width'), g('border-left-width')];
    const padding = [g('padding-top'), g('padding-right'), g('padding-bottom'), g('padding-left')];
    const summaries = [
      hasNonZeroBoxValues(margin) ? row('margin', formatBoxValues(margin)) : '',
      hasNonZeroBoxValues(border) ? row('border', formatBoxValues(border)) : '',
      hasNonZeroBoxValues(padding) ? row('padding', formatBoxValues(padding)) : ''
    ].filter(Boolean).join('');

    if (!summaries) return '';

    return section('boxmodel', '📐', 'Box Model', `
      ${summaries}
      <div class="__dip_boxmodel__">
        <div class="__dip_bm_outer__">
          <div class="__dip_bm_label__">margin</div>
          <div class="__dip_bm_top__">${margin[0]}</div>
          <div class="__dip_bm_sides__">
            <span class="__dip_bm_side_val__">${margin[3]}</span>
            <div class="__dip_bm_center__"><div class="__dip_bm_border__">
              <div class="__dip_bm_label__">border</div>
              <div class="__dip_bm_top__">${border[0]}</div>
              <div class="__dip_bm_sides__">
                <span class="__dip_bm_side_val__">${border[3]}</span>
                <div class="__dip_bm_center__"><div class="__dip_bm_padding__">
                  <div class="__dip_bm_label__">padding</div>
                  <div class="__dip_bm_top__">${padding[0]}</div>
                  <div class="__dip_bm_sides__">
                    <span class="__dip_bm_side_val__">${padding[3]}</span>
                    <div class="__dip_bm_center__"><div class="__dip_bm_content__">${w} × ${h}</div></div>
                    <span class="__dip_bm_side_val__">${padding[1]}</span>
                  </div>
                  <div class="__dip_bm_bottom__">${padding[2]}</div>
                </div></div>
                <span class="__dip_bm_side_val__">${border[1]}</span>
              </div>
              <div class="__dip_bm_bottom__">${border[2]}</div>
            </div></div>
            <span class="__dip_bm_side_val__">${margin[1]}</span>
          </div>
          <div class="__dip_bm_bottom__">${margin[2]}</div>
        </div>
      </div>`);
  }

  function renderState(el, cs) {
    const rows = [
      el.hasAttribute('disabled') ? row('disabled', 'true') : '',
      el.hasAttribute('required') ? row('required', 'true') : '',
      el.hasAttribute('readonly') ? row('readonly', 'true') : '',
      typeof el.checked === 'boolean' && el.checked ? row('checked', 'true') : '',
      typeof el.selected === 'boolean' && el.selected ? row('selected', 'true') : '',
      el.hasAttribute('hidden') ? row('hidden', 'true', 'neutral') : '',
      el.hasAttribute('tabindex') ? row('tabindex', el.getAttribute('tabindex')) : '',
      el.getAttribute('contenteditable') === 'true' ? row('editable', 'true') : '',
      cs.visibility !== 'visible' ? row('visibility', cs.visibility, 'highlight') : '',
      cs.pointerEvents === 'none' ? row('pointer-events', cs.pointerEvents, 'highlight') : '',
      cs.userSelect !== 'auto' && cs.userSelect !== 'text' ? row('user-select', cs.userSelect) : '',
      cs.cursor !== 'auto' ? row('cursor', cs.cursor) : '',
      hasUsefulTransition(cs) ? row('transition', truncateValue(cs.transition, 40), 'neutral', cs.transition) : ''
    ].filter(Boolean).join('');

    return rows ? section('state', '⚙️', 'State', rows) : '';
  }

  function renderLayout(rect, cs) {
    const rows = [
      row('size', `${Math.round(rect.width)}px × ${Math.round(rect.height)}px`),
      row('display', cs.display, cs.display === 'none' ? 'highlight' : ''),
      cs.position !== 'static' ? row('position', cs.position) : '',
      cs.zIndex !== 'auto' ? row('z-index', cs.zIndex) : '',
      hasUsefulOverflow(cs) ? row('overflow', summarizeOverflow(cs)) : '',
      hasUsefulGap(cs) ? row('gap', formatGap(cs)) : '',
      hasFlexAlignment(cs) ? row('align', `${cs.justifyContent} / ${cs.alignItems}`) : ''
    ].filter(Boolean).join('');

    return rows ? section('layout', '📏', 'Layout', rows) : '';
  }

  function renderParentLayout(el, cs) {
    const parent = el.parentElement;
    if (!parent) return '';
    const pcs = window.getComputedStyle(parent);
    const isFlexParent = pcs.display.includes('flex');
    const isGridParent = pcs.display.includes('grid');

    const rows = [
      (isFlexParent || isGridParent) ? row('parent', pcs.display) : '',
      hasUsefulGap(pcs) ? row('parent gap', formatGap(pcs)) : '',
      hasFlexAlignment(pcs) ? row('parent align', `${pcs.justifyContent} / ${pcs.alignItems}`) : '',
      isFlexParent && hasUsefulFlexItem(cs) ? row('item flex', summarizeFlexItem(cs)) : '',
      isFlexParent && cs.alignSelf !== 'auto' ? row('align-self', cs.alignSelf) : '',
      isGridParent && hasUsefulGridPlacement(cs) ? row('grid', summarizeGridPlacement(cs)) : '',
      isGridParent && cs.justifySelf !== 'auto' ? row('justify-self', cs.justifySelf) : '',
      isGridParent && cs.alignSelf !== 'auto' ? row('align-self', cs.alignSelf) : ''
    ].filter(Boolean).join('');

    return rows ? section('parentlayout', '🪜', 'Parent Layout', rows) : '';
  }

  function renderVisual(el, cs) {
    const hasText = !!getTextPreview(el);
    const rows = [
      colorRowIfUseful('color', cs.color),
      colorRowIfUseful('background', cs.backgroundColor),
      hasText ? row('font', primaryFont(cs.fontFamily)) : '',
      hasText ? row('font-size', cs.fontSize) : '',
      hasText && cs.fontWeight !== '400' ? row('font-weight', cs.fontWeight) : '',
      hasText && cs.lineHeight !== 'normal' ? row('line-height', cs.lineHeight) : '',
      cs.opacity !== '1' ? row('opacity', cs.opacity) : '',
      hasVisibleRadius(cs.borderRadius) ? row('radius', cs.borderRadius) : '',
      cs.boxShadow !== 'none' ? row('shadow', truncateValue(cs.boxShadow, 40), 'neutral', cs.boxShadow) : ''
    ].filter(Boolean).join('');

    return rows ? section('visual', '🎨', 'Visual', rows) : '';
  }

  function renderAttributes(el) {
    const importantNames = [
      'role', 'aria-label', 'aria-labelledby', 'aria-describedby',
      'aria-expanded', 'aria-hidden', 'aria-current', 'aria-pressed'
    ];
    const rows = [];

    importantNames.forEach((name) => {
      if (!el.hasAttribute(name)) return;
      const value = el.getAttribute(name) || '(empty)';
      rows.push(row(name, truncateValue(value, 48), value === '(empty)' ? 'neutral' : '', value));
    });

    [...el.attributes]
      .filter((attr) => attr.name.startsWith('data-'))
      .slice(0, 4)
      .forEach((attr) => {
        const value = attr.value || '(empty)';
        rows.push(row(attr.name, truncateValue(value, 48), value === '(empty)' ? 'neutral' : '', value));
      });

    return rows.length ? section('attrs', '📋', 'Useful Attributes', rows.join('')) : '';
  }

  function persistSnapshot(el, source) {
    if (!el) return;
    const snapshot = createSnapshot(el, source);
    if (currentTabId) {
      safeStorageSet({ [`xray_capture_${currentTabId}`]: snapshot });
    }
    safeSendMessage({ type: 'XRAY_CAPTURE_UPDATED', tabId: currentTabId || null, snapshot });
  }

  function createSnapshot(el, source) {
    const cs = window.getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    const fullText = getFullText(el);
    const tag = el.tagName.toLowerCase();
    const selector = buildSelector(el);
    const identityRows = [];
    const elementProps = [];
    const state = [];
    const layout = [];
    const visual = [];
    const attributes = [];

    if (el.id) identityRows.push(makeDataRow('id', '#' + el.id));
    if (el.classList.length) identityRows.push(makeDataRow('classes', '.' + [...el.classList].slice(0, 4).join(' .')));
    if (fullText) identityRows.push(makeDataRow('text', truncateValue(fullText, 60), 'neutral', fullText));

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
    if (cs.userSelect !== 'auto' && cs.userSelect !== 'text') state.push(makeDataRow('user-select', cs.userSelect));
    if (cs.cursor !== 'auto') state.push(makeDataRow('cursor', cs.cursor));
    if (hasUsefulTransition(cs)) state.push(makeDataRow('transition', truncateValue(cs.transition, 40), 'neutral', cs.transition));

    layout.push(makeDataRow('size', `${Math.round(rect.width)}px × ${Math.round(rect.height)}px`));
    layout.push(makeDataRow('display', cs.display, cs.display === 'none' ? 'highlight' : ''));
    if (cs.position !== 'static') layout.push(makeDataRow('position', cs.position));
    if (cs.zIndex !== 'auto') layout.push(makeDataRow('z-index', cs.zIndex));
    if (hasUsefulOverflow(cs)) layout.push(makeDataRow('overflow', summarizeOverflow(cs)));
    if (hasUsefulGap(cs)) layout.push(makeDataRow('gap', formatGap(cs)));
    if (hasFlexAlignment(cs)) layout.push(makeDataRow('align', `${cs.justifyContent} / ${cs.alignItems}`));

    const parentLayout = buildParentLayoutSnapshot(el, cs);
    const boxModel = buildBoxModelSnapshot(cs, rect);

    const hasText = !!getTextPreview(el);
    const textColor = buildColorRowData('color', cs.color);
    const backgroundColor = buildColorRowData('background', cs.backgroundColor);
    if (textColor) visual.push(textColor);
    if (backgroundColor) visual.push(backgroundColor);
    if (hasText) visual.push(makeDataRow('font', primaryFont(cs.fontFamily)));
    if (hasText) visual.push(makeDataRow('font-size', cs.fontSize));
    if (hasText && cs.fontWeight !== '400') visual.push(makeDataRow('font-weight', cs.fontWeight));
    if (hasText && cs.lineHeight !== 'normal') visual.push(makeDataRow('line-height', cs.lineHeight));
    if (cs.opacity !== '1') visual.push(makeDataRow('opacity', cs.opacity));
    if (hasVisibleRadius(cs.borderRadius)) visual.push(makeDataRow('radius', cs.borderRadius));
    if (cs.boxShadow !== 'none') visual.push(makeDataRow('shadow', truncateValue(cs.boxShadow, 40), 'neutral', cs.boxShadow));

    ['role', 'aria-label', 'aria-labelledby', 'aria-describedby', 'aria-expanded', 'aria-hidden', 'aria-current', 'aria-pressed']
      .forEach((name) => {
        if (!el.hasAttribute(name)) return;
        const value = el.getAttribute(name) || '(empty)';
        attributes.push(makeDataRow(name, truncateValue(value, 48), value === '(empty)' ? 'neutral' : '', value));
      });

    [...el.attributes]
      .filter((attr) => attr.name.startsWith('data-'))
      .slice(0, 4)
      .forEach((attr) => {
        const value = attr.value || '(empty)';
        attributes.push(makeDataRow(attr.name, truncateValue(value, 48), value === '(empty)' ? 'neutral' : '', value));
      });

    return {
      source: source || 'overlay',
      capturedAt: Date.now(),
      pageTitle: document.title,
      pageUrl: location.href,
      identity: {
        tag,
        selector,
        rows: identityRows
      },
      elementProps,
      state,
      layout,
      parentLayout,
      boxModel,
      visual,
      attributes
    };
  }

  function buildParentLayoutSnapshot(el, cs) {
    const parent = el.parentElement;
    if (!parent) return [];
    const pcs = window.getComputedStyle(parent);
    const isFlexParent = pcs.display.includes('flex');
    const isGridParent = pcs.display.includes('grid');
    const rows = [];

    if (isFlexParent || isGridParent) rows.push(makeDataRow('parent', pcs.display));
    if (hasUsefulGap(pcs)) rows.push(makeDataRow('parent gap', formatGap(pcs)));
    if (hasFlexAlignment(pcs)) rows.push(makeDataRow('parent align', `${pcs.justifyContent} / ${pcs.alignItems}`));
    if (isFlexParent && hasUsefulFlexItem(cs)) rows.push(makeDataRow('item flex', summarizeFlexItem(cs)));
    if (isFlexParent && cs.alignSelf !== 'auto') rows.push(makeDataRow('align-self', cs.alignSelf));
    if (isGridParent && hasUsefulGridPlacement(cs)) rows.push(makeDataRow('grid', summarizeGridPlacement(cs)));
    if (isGridParent && cs.justifySelf !== 'auto') rows.push(makeDataRow('justify-self', cs.justifySelf));
    if (isGridParent && cs.alignSelf !== 'auto') rows.push(makeDataRow('align-self', cs.alignSelf));

    return rows;
  }

  function buildBoxModelSnapshot(cs, rect) {
    const g = p => cs.getPropertyValue(p);
    const margin = [g('margin-top'), g('margin-right'), g('margin-bottom'), g('margin-left')];
    const border = [g('border-top-width'), g('border-right-width'), g('border-bottom-width'), g('border-left-width')];
    const padding = [g('padding-top'), g('padding-right'), g('padding-bottom'), g('padding-left')];
    const summary = [];

    if (hasNonZeroBoxValues(margin)) summary.push(makeDataRow('margin', formatBoxValues(margin)));
    if (hasNonZeroBoxValues(border)) summary.push(makeDataRow('border', formatBoxValues(border)));
    if (hasNonZeroBoxValues(padding)) summary.push(makeDataRow('padding', formatBoxValues(padding)));

    if (!summary.length) return null;

    return {
      summary,
      margin,
      border,
      padding,
      size: `${Math.round(rect.width)} × ${Math.round(rect.height)}`
    };
  }

  function makeDataRow(key, value, tone = '', copyValue = '') {
    return {
      key,
      value: String(value),
      tone,
      copyValue: copyValue || String(value)
    };
  }

  function buildColorRowData(key, value) {
    if (!value || value === 'transparent' || value === 'rgba(0, 0, 0, 0)') return null;
    const display = rgbToHex(value) || value;
    return {
      key,
      value: display,
      tone: '',
      copyValue: display,
      swatch: value
    };
  }

  function showDevToolsHint() {
    if (!currentTabId) {
      updateFooterMessage('Open DevTools, then choose the Xray tab. Last inspected element is ready there.', 'info', true);
      return;
    }

    safeSendMessage({ type: 'XRAY_DEVTOOLS_STATUS', tabId: currentTabId }).then((response) => {
      if (response && response.enabled === false) {
        updateFooterMessage('Xray DevTools is disabled. Turn it back on from the sidebar.', 'info', true);
        return;
      }
      if (response && response.open) {
        updateFooterMessage('DevTools is already open. Switch to the Xray tab there.', 'info', true);
        return;
      }
      updateFooterMessage('Open DevTools, then choose the Xray tab. Last inspected element is ready there.', 'info', true);
    }).catch(() => {
      updateFooterMessage('Open DevTools, then choose the Xray tab. Last inspected element is ready there.', 'info', true);
    });
  }

  function handleCloseButton() {
    closePanelOnly();
  }

  function isDevToolsOpen() {
    if (!currentTabId) return Promise.resolve(false);
    return safeSendMessage({ type: 'XRAY_DEVTOOLS_STATUS', tabId: currentTabId })
      .then((response) => !!(response && response.open))
      .catch(() => false);
  }

  function updateFooterMessage(message, tone = 'default', temporary = false) {
    const footer = document.getElementById('__dip_footer__');
    if (!footer) return;
    if (footerResetTimer) {
      clearTimeout(footerResetTimer);
      footerResetTimer = null;
    }
    footer.textContent = message;
    footer.setAttribute('data-tone', tone);
    if (temporary) {
      footerResetTimer = setTimeout(() => {
        footer.textContent = getDefaultFooterMessage();
        footer.setAttribute('data-tone', 'default');
      }, 3200);
    }
  }

  function hasExtensionContext() {
    try {
      return !!(chrome && chrome.runtime && chrome.runtime.id && chrome.storage && chrome.storage.local);
    } catch (_) {
      return false;
    }
  }

  function safeSendMessage(message) {
    if (!hasExtensionContext()) return Promise.resolve(null);
    try {
      return chrome.runtime.sendMessage(message).catch(() => null);
    } catch (_) {
      return Promise.resolve(null);
    }
  }

  function notifySidebarVisibility(visible) {
    safeSendMessage({
      type: 'XRAY_SIDEBAR_VISIBILITY_CHANGED',
      tabId: currentTabId || null,
      visible: !!visible
    });
  }

  function safeStorageSet(value) {
    if (!hasExtensionContext()) return;
    try {
      chrome.storage.local.set(value);
    } catch (_) {
      // Ignore invalidated extension contexts after reloads.
    }
  }

  function safeStorageRemove(keys) {
    if (!hasExtensionContext()) return;
    try {
      chrome.storage.local.remove(keys);
    } catch (_) {
      // Ignore invalidated extension contexts after reloads.
    }
  }

  function safeStorageGet(keys, callback) {
    if (!hasExtensionContext()) {
      callback({});
      return;
    }
    try {
      chrome.storage.local.get(keys, (items) => {
        callback(items || {});
      });
    } catch (_) {
      callback({});
    }
  }

  function safeStorageGetAll(callback) {
    if (!hasExtensionContext()) {
      callback({});
      return;
    }
    try {
      chrome.storage.local.get(null, (items) => {
        callback(items || {});
      });
    } catch (_) {
      callback({});
    }
  }

  // ─── Utilities ───────────────────────────────────────────────────
  function buildSelector(el) {
    const parts = [];
    let curr = el;
    while (curr && curr !== document.body && parts.length < 4) {
      let part = curr.tagName.toLowerCase();
      if (curr.id) { part += '#' + curr.id; parts.unshift(part); break; }
      if (curr.classList.length) part += '.' + [...curr.classList].slice(0, 2).join('.');
      parts.unshift(part);
      curr = curr.parentElement;
    }
    return parts.join(' > ');
  }

  function rgbToHex(rgb) {
    const m = rgb.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
    if (!m) return null;
    const [r, g, b] = [+m[1], +m[2], +m[3]];
    if (r === 0 && g === 0 && b === 0) return null;
    return '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
  }

  function getTextPreview(el) {
    return truncateValue(getFullText(el), 60);
  }

  function getFullText(el) {
    return (el.textContent || '').replace(/\s+/g, ' ').trim();
  }

  function truncateValue(value, maxLength) {
    const text = String(value);
    return text.length > maxLength ? text.slice(0, maxLength) + '…' : text;
  }

  function primaryFont(fontFamily) {
    return fontFamily.split(',')[0].replace(/['"]/g, '').trim();
  }

  function colorRowIfUseful(key, value) {
    if (!value || value === 'transparent' || value === 'rgba(0, 0, 0, 0)') return '';
    return colorRow(key, value);
  }

  function hasVisibleRadius(borderRadius) {
    return borderRadius && borderRadius !== '0px';
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

  function isZeroValue(value) {
    return Number.parseFloat(value) === 0;
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
    const col = `${cs.gridColumnStart} / ${cs.gridColumnEnd}`;
    const row = `${cs.gridRowStart} / ${cs.gridRowEnd}`;
    return `${col} • ${row}`;
  }

  function hasUsefulTransition(cs) {
    return cs.transition && cs.transition !== 'all 0s ease 0s';
  }

  function escHtml(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }
  function escAttr(s) {
    return String(s).replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  }

})();
