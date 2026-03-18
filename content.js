if (window.__XRAY_INSPECTOR_INSTANCE__ && window.__XRAY_INSPECTOR_INSTANCE__.destroy) {
  window.__XRAY_INSPECTOR_INSTANCE__.destroy(false);
}

(() => {
  const INSTANCE_ID = `xray_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const sharedState = window.__XRAY_INSPECTOR_SHARED__ || (window.__XRAY_INSPECTOR_SHARED__ = {
    activeInstanceId: null,
    inspectingEnabled: false
  });

  let isEnabled = false;
  let lockedTarget = null;
  let highlightEl = null;
  let panelEl = null;
  let panelScroll = null;
  let collapsedSections = new Set();

  window.__DOM_INSPECTOR_DISABLE__ = () => disable(false);
  window.__XRAY_INSPECTOR_INSTANCE__ = {
    destroy,
    instanceId: INSTANCE_ID
  };

  const messageListener = (msg) => {
    if (msg.type === 'TOGGLE_INSPECTOR') {
      sharedState.activeInstanceId = INSTANCE_ID;
      msg.enabled ? enable() : disable(false);
    }
  };

  chrome.runtime.onMessage.addListener(messageListener);

  // ─── Enable / Disable ────────────────────────────────────────────
  function enable() {
    sharedState.activeInstanceId = INSTANCE_ID;
    sharedState.inspectingEnabled = true;
    if (isEnabled) return;
    isEnabled = true;
    createHighlight();
    createPanel();
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
    showHome(true);
    chrome.storage.local.get(null, (items) => {
      const keys = Object.keys(items).filter(k => k.startsWith('inspector_'));
      if (keys.length) chrome.storage.local.remove(keys);
    });
    chrome.runtime.sendMessage({ type: 'INSPECTOR_CLOSED' }).catch(() => {});
  }

  // Re-enable inspecting from panel toggle
  function enableInspecting() {
    sharedState.activeInstanceId = INSTANCE_ID;
    sharedState.inspectingEnabled = true;
    if (isEnabled) return;
    isEnabled = true;
    createHighlight();
    createPanel();
    showHome();
    addInspectingListeners();
    updatePanelToggle(true);
    chrome.runtime.sendMessage({ type: 'INSPECTOR_OPENED' }).catch(() => {});
  }

  // Full disable — removes panel too
  function disable(notifyPopup = true) {
    isEnabled = false;
    lockedTarget = null;
    removeInspectingListeners();
    if (sharedState.activeInstanceId === INSTANCE_ID) {
      sharedState.activeInstanceId = null;
      sharedState.inspectingEnabled = false;
    }
    removeHighlight();
    removePanel();
    chrome.storage.local.get(null, (items) => {
      const keys = Object.keys(items).filter(k => k.startsWith('inspector_'));
      if (keys.length) chrome.storage.local.remove(keys);
    });
    if (notifyPopup) {
      chrome.runtime.sendMessage({ type: 'INSPECTOR_CLOSED' }).catch(() => {});
    }
  }

  function destroy(notifyPopup = false) {
    disable(notifyPopup);
    chrome.runtime.onMessage.removeListener(messageListener);
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

  function showHome(disabled = false) {
    lockedTarget = null;
    if (highlightEl) highlightEl.style.display = 'none';
    if (panelScroll) {
      panelScroll.innerHTML = disabled
        ? `<div class="__dip_empty__">
          <div class="__dip_empty_icon__">⬡</div>
          <div class="__dip_empty_text__">Inspector is off.<br>Toggle on to inspect elements.</div>
        </div>`
        : `<div class="__dip_empty__">
          <div class="__dip_empty_icon__">⬡</div>
          <div class="__dip_empty_text__">Click any element on the page<br>to inspect its properties</div>
        </div>`;
    }
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
      return;
    }
    panelEl = document.createElement('div');
    panelEl.id = '__dom_inspector_panel__';
    panelEl.innerHTML = `
      <div class="__dip_header__">
        <div class="__dip_header_icon__">⬡</div>
        <span class="__dip_header_title__">Xray</span>
        <label class="__dip_panel_toggle__" id="__dip_panel_toggle__" title="Toggle inspector">
          <input type="checkbox" id="__dip_panel_toggle_input__" checked>
          <span class="__dip_panel_toggle_track__"><span class="__dip_panel_toggle_thumb__"></span></span>
        </label>
        <button class="__dip_close__" id="__dip_close_btn__" title="Close panel">✕</button>
      </div>
      <div class="__dip_scroll__"></div>
      <div class="__dip_footer__">Click any value to copy • ESC to turn off</div>
    `;
    document.body.appendChild(panelEl);
    panelScroll = panelEl.querySelector('.__dip_scroll__');

    document.getElementById('__dip_close_btn__').addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      disable(true);
    });

    document.getElementById('__dip_panel_toggle_input__').addEventListener('change', (e) => {
      e.stopPropagation();
      if (e.target.checked) {
        enableInspecting();
      } else {
        disableInspecting();
      }
    });
  }

  function removePanel() {
    const el = document.getElementById('__dom_inspector_panel__');
    if (el) el.remove();
    panelEl = null;
    panelScroll = null;
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
      disable(true);
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
    if (!panelScroll) panelScroll = document.querySelector('#__dom_inspector_panel__ .__dip_scroll__');
    if (!panelScroll) return;
    const cs = window.getComputedStyle(el);
    const rect = el.getBoundingClientRect();

    panelScroll.innerHTML = `
      <div class="__dip_content_fade__">
        ${renderIdentity(el, cs)}
        ${renderBoxModel(cs, rect)}
        ${renderLayout(rect, cs)}
        ${renderVisual(cs)}
        ${renderBehaviour(cs)}
        ${renderAttributes(el)}
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

  function renderIdentity(el, cs) {
    const tag = el.tagName.toLowerCase();
    const selector = buildSelector(el);
    const text = (el.textContent || '').trim().slice(0, 60);
    return section('identity', '🏷️', 'Identity', `
      <div class="__dip_tag_badge__">
        <span class="__dip_tag_inner__">&lt;</span>${escHtml(tag)}<span class="__dip_tag_inner__">&gt;</span>
      </div>
      <div class="__dip_selector__" title="Click to copy">${escHtml(selector)}</div>
      ${row('id', el.id ? '#' + el.id : '—')}
      ${row('classes', el.classList.length ? '.' + [...el.classList].slice(0, 4).join(' .') : '—')}
      ${text ? row('text', text.length >= 60 ? text + '…' : text, 'neutral', text) : ''}
      ${row('role', el.getAttribute('role') || '—', 'neutral')}
    `);
  }

  function renderBoxModel(cs, rect) {
    const g = p => cs.getPropertyValue(p);
    const w = Math.round(rect.width), h = Math.round(rect.height);
    return section('boxmodel', '📐', 'Box Model', `
      <div class="__dip_boxmodel__">
        <div class="__dip_bm_outer__">
          <div class="__dip_bm_label__">margin</div>
          <div class="__dip_bm_top__">${g('margin-top')}</div>
          <div class="__dip_bm_sides__">
            <span class="__dip_bm_side_val__">${g('margin-left')}</span>
            <div class="__dip_bm_center__"><div class="__dip_bm_border__">
              <div class="__dip_bm_label__">border</div>
              <div class="__dip_bm_top__">${g('border-top-width')}</div>
              <div class="__dip_bm_sides__">
                <span class="__dip_bm_side_val__">${g('border-left-width')}</span>
                <div class="__dip_bm_center__"><div class="__dip_bm_padding__">
                  <div class="__dip_bm_label__">padding</div>
                  <div class="__dip_bm_top__">${g('padding-top')}</div>
                  <div class="__dip_bm_sides__">
                    <span class="__dip_bm_side_val__">${g('padding-left')}</span>
                    <div class="__dip_bm_center__"><div class="__dip_bm_content__">${w} × ${h}</div></div>
                    <span class="__dip_bm_side_val__">${g('padding-right')}</span>
                  </div>
                  <div class="__dip_bm_bottom__">${g('padding-bottom')}</div>
                </div></div>
                <span class="__dip_bm_side_val__">${g('border-right-width')}</span>
              </div>
              <div class="__dip_bm_bottom__">${g('border-bottom-width')}</div>
            </div></div>
            <span class="__dip_bm_side_val__">${g('margin-right')}</span>
          </div>
          <div class="__dip_bm_bottom__">${g('margin-bottom')}</div>
        </div>
      </div>`);
  }

  function renderLayout(rect, cs) {
    return section('layout', '📏', 'Size & Layout', `
      ${row('size', `${Math.round(rect.width)}px × ${Math.round(rect.height)}px`)}
      ${row('top / left', `${Math.round(rect.top)}px / ${Math.round(rect.left)}px`)}
      ${row('display', cs.display, cs.display === 'none' ? 'highlight' : '')}
      ${row('position', cs.position)}
      ${row('z-index', cs.zIndex)}
      ${row('overflow', cs.overflow)}
    `);
  }

  function renderVisual(cs) {
    return section('visual', '🎨', 'Visual', `
      ${colorRow('color', cs.color)}
      ${colorRow('background', cs.backgroundColor)}
      ${row('font-family', cs.fontFamily.split(',')[0].replace(/['"]/g, '').trim())}
      ${row('font-size', cs.fontSize)}
      ${row('font-weight', cs.fontWeight)}
      ${row('line-height', cs.lineHeight)}
      ${row('opacity', cs.opacity)}
      ${row('border-radius', cs.borderRadius !== '0px' ? cs.borderRadius : '—', 'neutral')}
      ${row('box-shadow', cs.boxShadow !== 'none' ? cs.boxShadow.slice(0, 36) + '…' : '—', 'neutral', cs.boxShadow)}
    `);
  }

  function renderBehaviour(cs) {
    return section('behaviour', '⚙️', 'Behaviour', `
      ${row('cursor', cs.cursor)}
      ${row('pointer-events', cs.pointerEvents)}
      ${row('visibility', cs.visibility)}
      ${row('user-select', cs.userSelect)}
      ${row('transition', cs.transition !== 'all 0s ease 0s' ? cs.transition.slice(0, 36) + '…' : '—', 'neutral', cs.transition)}
    `);
  }

  function renderAttributes(el) {
    const attrs = [...el.attributes];
    if (!attrs.length) return section('attrs', '📋', 'Attributes', '<div style="color:#374151;font-size:9px;padding:2px 0">No attributes</div>');
    return section('attrs', '📋', 'Attributes', attrs.map(a => row(a.name, a.value || '(empty)', a.value ? '' : 'neutral')).join(''));
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

  function escHtml(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }
  function escAttr(s) {
    return String(s).replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  }

})();
