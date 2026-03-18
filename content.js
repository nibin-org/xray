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
