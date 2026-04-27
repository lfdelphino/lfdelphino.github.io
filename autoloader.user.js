// ==UserScript==
// @name         BG1 Autoloader
// @namespace    https://bg1.local/
// @version      1.13
// @description  Load BG1 (local or prod), auto-refresh targets, and optionally auto-modify on match
// @author       Luiz Delphino
// @match        https://disneyworld.disney.go.com/vas/
// @match        https://disneyworld.disney.go.com/*/vas/
// @match        https://disneyland.disney.go.com/vas/
// @match        https://disneyland.disney.go.com/*/vas/
// @grant        none
// ==/UserScript==
'use strict';

const CONFIG = {
  mode: 'prod', // 'local' or 'prod'
  prodBaseUrl: 'https://joelface.github.io/bg1/',
  localBaseUrl: 'https://localhost:3000/bg1/',
  autoModifyOnMatch: true,
  pollIntervalSec: 15,
  postRefreshDelayMs: 1800,
};
const SCRIPT_VERSION =
  (typeof GM_info !== 'undefined' &&
    GM_info &&
    GM_info.script &&
    typeof GM_info.script.version === 'string' &&
    GM_info.script.version) ||
  '1.13';

const SETTINGS_KEY = 'bg1.autoloader.settings.v1';
const PANEL_POS_KEY = 'bg1.autoloader.panelPos.v1';

const bg1BaseUrl = (CONFIG.mode === 'local'
  ? CONFIG.localBaseUrl
  : CONFIG.prodBaseUrl
).replace(/\/?$/, '/');

const entryScript = CONFIG.mode === 'local' ? 'bg1-dev.ts' : 'bg1.js';
const BOOT_FLAG = '__bg1AutoloaderBootedV1';

if (window.self !== window.top) {
  // Prevent running inside nested frames.
} else if (window[BOOT_FLAG]) {
  // Prevent duplicate execution on the same page context.
} else if (
  location.href.startsWith(bg1BaseUrl) ||
  document.documentElement?.getAttribute('data-bg1-autoloader-injected') ===
    '1'
) {
  // Prevent recursive execution/injection loops.
} else {
  window[BOOT_FLAG] = true;
  injectBg1();
  waitForElement('button[title="Refresh Experiences"]', 60_000)
    .then(initAutoFinder)
    .catch(() => undefined);
}

function injectBg1() {
  document.open();
  document.write(
    `<!doctype html><html data-bg1-autoloader-injected="1"><head><link rel="stylesheet" href="${bg1BaseUrl}bg1.css"></head><body></body></html>`
  );
  document.close();

  const script = document.createElement('script');
  script.type = 'module';
  script.src = bg1BaseUrl + entryScript;
  document.head.appendChild(script);
}

async function initAutoFinder() {
  const settings = loadSettings();
  let running = false;
  let timerId = 0;
  let evalTimerId = 0;
  let cycleBusy = false;
  let optionRefreshPending = false;
  let evaluatePending = false;
  let modifyInProgress = false;

  const panel = document.createElement('div');
  panel.id = 'bg1af-panel';
  panel.style.cssText = [
    'position:fixed',
    'right:8px',
    'bottom:8px',
    'z-index:2147483647',
    'background:#111',
    'color:#fff',
    'padding:10px',
    'border-radius:8px',
    'width:min(320px,calc(100vw - 16px))',
    'max-width:calc(100vw - 16px)',
    'font:12px/1.35 Arial,sans-serif',
    'box-shadow:0 8px 24px rgba(0,0,0,.45)',
  ].join(';');
  panel.innerHTML = `
    <div id="bg1af-drag-handle" style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px;cursor:move;user-select:none;touch-action:none;">
      <strong style="font-size:13px;">BG1 Auto Finder</strong>
      <span id="bg1af-mode" style="opacity:.75;">${CONFIG.mode.toUpperCase()} v${SCRIPT_VERSION}</span>
    </div>

    <label style="display:block;margin-bottom:6px;">Attractions to Watch/Modify</label>
    <div id="bg1af-watch-list" style="display:flex;flex-direction:column;gap:6px;margin-bottom:6px;"></div>
    <div style="opacity:.75;margin-bottom:6px;">In auto-modify mode, target time is ignored and each plan party is modified only if an earlier time exists.</div>
    <div style="display:flex;gap:8px;margin-bottom:8px;">
      <button id="bg1af-add-watch" style="flex:1;padding:6px;border:0;border-radius:5px;background:#2d5d95;color:#fff;font-weight:700;cursor:pointer;">+ Add Attraction</button>
    </div>

    <label style="display:block;margin-bottom:6px;">Refresh Interval (seconds)</label>
    <input id="bg1af-interval" type="number" min="1" max="300" step="1" value="${settings.intervalSec}" style="width:100%;margin-bottom:8px;padding:5px;border-radius:4px;border:1px solid #444;background:#222;color:#fff;" />
    <label style="display:flex;align-items:center;gap:6px;margin-bottom:8px;">
      <input id="bg1af-auto-modify" type="checkbox" />
      <span>Auto modify LL on match</span>
    </label>

    <div style="display:flex;gap:8px;margin-bottom:8px;">
      <button id="bg1af-start" style="flex:1;padding:7px;border:0;border-radius:5px;background:#2a9d44;color:#fff;font-weight:700;cursor:pointer;">Start</button>
      <button id="bg1af-stop" style="flex:1;padding:7px;border:0;border-radius:5px;background:#963535;color:#fff;font-weight:700;cursor:pointer;">Stop</button>
    </div>

    <div id="bg1af-status" style="opacity:.9;min-height:2.7em;">Idle</div>
    <div id="bg1af-log" style="margin-top:6px;max-height:140px;overflow:auto;padding:6px;border-radius:5px;background:#1b1b1b;border:1px solid #333;font-family:Consolas,'Courier New',monospace;font-size:11px;line-height:1.35;"></div>
  `;

  document.body.appendChild(panel);

  const watchList = panel.querySelector('#bg1af-watch-list');
  const addWatchBtn = panel.querySelector('#bg1af-add-watch');
  const intervalInput = panel.querySelector('#bg1af-interval');
  const autoModifyInput = panel.querySelector('#bg1af-auto-modify');
  const startBtn = panel.querySelector('#bg1af-start');
  const stopBtn = panel.querySelector('#bg1af-stop');
  const status = panel.querySelector('#bg1af-status');
  const logBox = panel.querySelector('#bg1af-log');
  const dragHandle = panel.querySelector('#bg1af-drag-handle');

  if (
    !(watchList instanceof HTMLDivElement) ||
    !(addWatchBtn instanceof HTMLButtonElement) ||
    !(intervalInput instanceof HTMLInputElement) ||
    !(autoModifyInput instanceof HTMLInputElement) ||
    !(startBtn instanceof HTMLButtonElement) ||
    !(stopBtn instanceof HTMLButtonElement) ||
    !(status instanceof HTMLDivElement) ||
    !(logBox instanceof HTMLDivElement) ||
    !(dragHandle instanceof HTMLDivElement)
  ) {
    return;
  }

  autoModifyInput.checked = settings.autoModify;

  const PANEL_MARGIN = 8;
  function clampPanelPos(x, y) {
    const maxX = Math.max(PANEL_MARGIN, window.innerWidth - panel.offsetWidth - PANEL_MARGIN);
    const maxY = Math.max(PANEL_MARGIN, window.innerHeight - panel.offsetHeight - PANEL_MARGIN);
    return {
      x: Math.max(PANEL_MARGIN, Math.min(maxX, Math.round(x))),
      y: Math.max(PANEL_MARGIN, Math.min(maxY, Math.round(y))),
    };
  }

  function applyPanelPos(pos) {
    panel.style.left = `${pos.x}px`;
    panel.style.top = `${pos.y}px`;
    panel.style.right = 'auto';
    panel.style.bottom = 'auto';
  }

  const panelPos = loadPanelPos();
  if (panelPos) {
    const clamped = clampPanelPos(panelPos.x, panelPos.y);
    applyPanelPos(clamped);
    savePanelPos(clamped);
  }

  let drag;
  function onDragStart(event) {
    const rect = panel.getBoundingClientRect();
    drag = {
      pointerId: event.pointerId,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
    };
    dragHandle.setPointerCapture(event.pointerId);
  }

  function onDragMove(event) {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const pos = clampPanelPos(event.clientX - drag.offsetX, event.clientY - drag.offsetY);
    applyPanelPos(pos);
  }

  function onDragEnd(event) {
    if (!drag || event.pointerId !== drag.pointerId) return;
    dragHandle.releasePointerCapture(event.pointerId);
    drag = undefined;
    const pos = clampPanelPos(parseInt(panel.style.left, 10) || 0, parseInt(panel.style.top, 10) || 0);
    applyPanelPos(pos);
    savePanelPos(pos);
  }

  dragHandle.addEventListener('pointerdown', onDragStart);
  dragHandle.addEventListener('pointermove', onDragMove);
  dragHandle.addEventListener('pointerup', onDragEnd);
  dragHandle.addEventListener('pointercancel', onDragEnd);
  window.addEventListener('resize', () => {
    if (panel.style.right !== 'auto' || panel.style.bottom !== 'auto') return;
    const pos = clampPanelPos(parseInt(panel.style.left, 10) || PANEL_MARGIN, parseInt(panel.style.top, 10) || PANEL_MARGIN);
    applyPanelPos(pos);
    savePanelPos(pos);
  });

  const MAX_STATUS_LOGS = 12;
  const statusLogs = [];
  let statusPinUntil = 0;

  function appendStatusLog(text, level = 'info') {
    const timestamp = new Date().toLocaleTimeString();
    statusLogs.push({ timestamp, text, level });
    if (statusLogs.length > MAX_STATUS_LOGS) statusLogs.shift();

    logBox.innerHTML = '';
    for (const entry of statusLogs) {
      const line = document.createElement('div');
      line.style.whiteSpace = 'pre-wrap';
      line.style.wordBreak = 'break-word';
      if (entry.level === 'error') line.style.color = '#ff9a9a';
      else if (entry.level === 'success') line.style.color = '#9cffc0';
      else if (entry.level === 'warn') line.style.color = '#ffd27f';
      else line.style.color = '#e7e7e7';
      line.textContent = `[${entry.timestamp}] ${entry.text}`;
      logBox.appendChild(line);
    }
    logBox.scrollTop = logBox.scrollHeight;
  }

  function inferStatusLevel(text) {
    const lower = String(text || '').toLowerCase();
    if (lower.includes('error') || lower.includes('failed')) return 'error';
    if (lower.includes('found') || lower.includes('updated') || lower.includes('started')) {
      return 'success';
    }
    if (lower.includes('retry') || lower.includes('no ll time') || lower.includes('unable')) {
      return 'warn';
    }
    return 'info';
  }

  function setStatus(text, options = {}) {
    const level = options.level || inferStatusLevel(text);
    const holdMs = Number(options.holdMs) || 0;
    const force = options.force === true;
    const now = Date.now();

    appendStatusLog(text, level);
    if (!force && now < statusPinUntil) return;

    status.textContent = text;
    if (holdMs > 0) statusPinUntil = now + holdMs;
  }

  function getAttractionRows() {
    const primary = Array.from(document.querySelectorAll('ul[data-testid] li'));
    if (primary.length > 0) return primary;

    const liFallback = Array.from(document.querySelectorAll('li')).filter(li => {
      if (!li.querySelector('h3')) return false;
      const text = li.textContent || '';
      return /\bLL\b/i.test(text) || !!li.querySelector('time[datetime], button');
    });
    if (liFallback.length > 0) return liFallback;

    return Array.from(document.querySelectorAll('h3'))
      .map(h => h.closest('li, article, section, [role="listitem"]') || h.parentElement)
      .filter((row, index, all) => !!row && all.indexOf(row) === index);
  }

  function attractionNames() {
    return getAttractionRows()
      .map(row => row.querySelector('h3')?.textContent?.trim() || '')
      .filter(Boolean);
  }

  function populateAttractionSelect(select, selectedName) {
    const names = attractionNames();
    const selected = (selectedName || '').trim();
    select.innerHTML = '';

    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = 'Select attraction...';
    select.appendChild(placeholder);

    for (const name of names) {
      const option = document.createElement('option');
      option.value = name;
      option.textContent = name;
      select.appendChild(option);
    }

    if (selected && !names.includes(selected)) {
      const missing = document.createElement('option');
      missing.value = selected;
      missing.textContent = `${selected} (not listed)`;
      select.appendChild(missing);
    }

    select.value = selected;
    if (!select.value) placeholder.selected = true;
  }

  function getWatchRows() {
    return Array.from(watchList.querySelectorAll('[data-watch-row]'));
  }

  function getWatches() {
    return getWatchRows()
      .map(row => {
        const attractionInput = row.querySelector('.bg1af-watch-attraction');
        const targetInput = row.querySelector('.bg1af-watch-target');
        return {
          attraction:
            attractionInput instanceof HTMLSelectElement
              ? attractionInput.value.trim()
              : '',
          targetTime:
            targetInput instanceof HTMLInputElement
              ? targetInput.value.trim()
              : '',
        };
      })
      .filter(watch => watch.attraction);
  }

  function createWatchRow(watch = {}) {
    const row = document.createElement('div');
    row.dataset.watchRow = '1';
    row.style.cssText = 'display:grid;grid-template-columns:1fr auto auto;gap:6px;';
    row.innerHTML = `
      <select class="bg1af-watch-attraction" style="width:100%;padding:5px;border-radius:4px;border:1px solid #444;background:#222;color:#fff;"></select>
      <input class="bg1af-watch-target" type="time" title="Target Earliest Time (alert mode only)" style="width:92px;padding:5px;border-radius:4px;border:1px solid #444;background:#222;color:#fff;" />
      <button class="bg1af-watch-remove" title="Remove target" style="width:30px;padding:0;border:0;border-radius:4px;background:#7a2d2d;color:#fff;font-weight:700;cursor:pointer;">×</button>
    `;

    const attractionInput = row.querySelector('.bg1af-watch-attraction');
    const targetInput = row.querySelector('.bg1af-watch-target');
    const removeBtn = row.querySelector('.bg1af-watch-remove');

    if (
      !(attractionInput instanceof HTMLSelectElement) ||
      !(targetInput instanceof HTMLInputElement) ||
      !(removeBtn instanceof HTMLButtonElement)
    ) {
      return;
    }

    populateAttractionSelect(attractionInput, watch.attraction || '');
    targetInput.value = typeof watch.targetTime === 'string' ? watch.targetTime : '';

    attractionInput.addEventListener('change', saveCurrentSettings);
    targetInput.addEventListener('change', saveCurrentSettings);
    removeBtn.addEventListener('click', () => {
      row.remove();
      if (getWatchRows().length === 0) createWatchRow();
      updateTargetInputsState();
      saveCurrentSettings();
    });

    watchList.appendChild(row);
    updateTargetInputsState();
  }

  function syncWatchRows() {
    const rows = getWatchRows();
    if (rows.length === 0) {
      createWatchRow();
      return;
    }
    for (const row of rows) {
      const attractionInput = row.querySelector('.bg1af-watch-attraction');
      if (!(attractionInput instanceof HTMLSelectElement)) continue;
      populateAttractionSelect(attractionInput, attractionInput.value);
    }
  }

  function updateTargetInputsState() {
    const disableTarget = autoModifyInput.checked;
    for (const row of getWatchRows()) {
      const targetInput = row.querySelector('.bg1af-watch-target');
      if (!(targetInput instanceof HTMLInputElement)) continue;
      targetInput.disabled = disableTarget;
      targetInput.style.opacity = disableTarget ? '0.45' : '1';
    }
  }

  function parseTimeToMinutes(value) {
    const raw = (value || '').trim().toLowerCase();
    if (!raw) return null;

    let m = raw.match(/^(\d{1,2}):(\d{2})$/);
    if (m) return Number(m[1]) * 60 + Number(m[2]);

    m = raw.match(/^(\d{1,2}):(\d{2}):(\d{2})$/);
    if (m) return Number(m[1]) * 60 + Number(m[2]);

    m = raw.match(/^(\d{1,2}):(\d{2})\s*([ap]m)$/);
    if (m) {
      let hour = Number(m[1]) % 12;
      if (m[3] === 'pm') hour += 12;
      return hour * 60 + Number(m[2]);
    }

    m = raw.match(/^(\d{1,2}):(\d{2}):(\d{2})\s*([ap]m)$/);
    if (m) {
      let hour = Number(m[1]) % 12;
      if (m[4] === 'pm') hour += 12;
      return hour * 60 + Number(m[2]);
    }

    m = raw.match(/^(\d{1,2})\s*([ap]m)$/);
    if (m) {
      let hour = Number(m[1]) % 12;
      if (m[2] === 'pm') hour += 12;
      return hour * 60;
    }

    return null;
  }

  function minutesToTime(minutes) {
    const h = Math.floor(minutes / 60)
      .toString()
      .padStart(2, '0');
    const m = (minutes % 60).toString().padStart(2, '0');
    return `${h}:${m}`;
  }

  function getLlMinutesFromRow(row) {
    const llBlock = Array.from(
      row.querySelectorAll('div.flex.items-center.flex-1.whitespace-nowrap')
    ).find(item => {
      const label = item.firstElementChild;
      return label?.textContent?.trim().toUpperCase() === 'LL';
    });

    if (!llBlock) {
      // Fallback if class names/layout change: look for any LL-labeled block.
      const fallbackBlock = Array.from(row.querySelectorAll('div')).find(div =>
        /\bLL\b/i.test(div.textContent || '')
      );
      if (!fallbackBlock) return null;
      return extractTimeFromBlock(fallbackBlock);
    }

    return extractTimeFromBlock(llBlock);
  }

  function extractTimeFromBlock(block) {
    const timeEl = Array.from(block.querySelectorAll('time[datetime]')).find(t =>
      /^\d{1,2}:\d{2}(:\d{2})?$/.test(t.getAttribute('datetime') || '')
    );

    if (timeEl instanceof HTMLTimeElement) {
      const minutes = parseTimeToMinutes(timeEl.getAttribute('datetime') || '');
      if (minutes !== null) return minutes;
      return parseTimeToMinutes(timeEl.textContent || '');
    }

    const btnText = block.querySelector('button')?.textContent || '';
    return parseTimeToMinutes(btnText);
  }

  function findAttractionTime(name) {
    const row = getAttractionRows().find(
      li => li.querySelector('h3')?.textContent?.trim() === name
    );
    if (!row) return null;
    return getLlMinutesFromRow(row);
  }

  function findAttractionRow(name) {
    return getAttractionRows().find(
      li => li.querySelector('h3')?.textContent?.trim() === name
    );
  }

  const normalizeText = text => (text || '').replace(/\s+/g, ' ').trim();
  const isVisible = elem =>
    !!elem && !!(elem.offsetWidth || elem.offsetHeight || elem.getClientRects().length);
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

  function findButtonByText(pattern) {
    return Array.from(document.querySelectorAll('button')).find(
      btn => isVisible(btn) && pattern.test(normalizeText(btn.textContent))
    );
  }

  function isOnLlTab() {
    const refreshBtn = document.querySelector('button[title="Refresh Experiences"]');
    return refreshBtn instanceof HTMLButtonElement;
  }

  function isOnPlansTab() {
    const refreshBtn = document.querySelector('button[title="Refresh Plans"]');
    return refreshBtn instanceof HTMLButtonElement;
  }

  function hasHomeTabButtons() {
    return (
      findButtonByText(/^ll$/i) instanceof HTMLButtonElement &&
      findButtonByText(/^plans$/i) instanceof HTMLButtonElement
    );
  }

  async function ensureHomeTabButtons(timeoutMs = 10000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (hasHomeTabButtons()) return true;
      const backBtn = document.querySelector('button[title="Go Back"]');
      if (backBtn instanceof HTMLButtonElement && isVisible(backBtn)) {
        backBtn.click();
        // eslint-disable-next-line no-await-in-loop
        await sleep(250);
        continue;
      }
      // eslint-disable-next-line no-await-in-loop
      await sleep(120);
    }
    return false;
  }

  async function switchToTab(tabName) {
    const wantsLl = tabName === 'LL';
    if ((wantsLl && isOnLlTab()) || (!wantsLl && isOnPlansTab())) return true;

    if (!(await ensureHomeTabButtons())) return false;

    const tabBtn = await waitForValue(
      () => findButtonByText(wantsLl ? /^ll$/i : /^plans$/i),
      4000,
      120
    );
    if (!(tabBtn instanceof HTMLButtonElement)) return false;
    tabBtn.click();

    const switched = await waitForValue(
      () => ((wantsLl ? isOnLlTab() : isOnPlansTab()) ? true : null),
      6000,
      120
    );
    return !!switched;
  }

  async function ensurePlansContextForModify() {
    if (!(await switchToTab('Plans'))) return false;
    const ready = await waitForValue(
      () => (isOnPlansTab() ? true : null),
      3000,
      120
    );
    return !!ready;
  }

  async function returnToLLForPolling() {
    await switchToTab('LL');
  }

  function findLlActionButton(row) {
    const llBlock = Array.from(
      row.querySelectorAll('div.flex.items-center.flex-1.whitespace-nowrap')
    ).find(item => {
      const label = item.firstElementChild;
      return label?.textContent?.trim().toUpperCase() === 'LL';
    });
    const btnInBlock = llBlock?.querySelector('button');
    if (btnInBlock instanceof HTMLButtonElement) return btnInBlock;

    const fallbackBtn = Array.from(row.querySelectorAll('button')).find(btn => {
      const title = (btn.getAttribute('title') || '').toLowerCase();
      if (title.includes('favorite') || title.includes('more info')) return false;
      const text = normalizeText(btn.textContent).toLowerCase();
      return !!text && (text.includes('book') || parseTimeToMinutes(text) !== null);
    });
    return fallbackBtn instanceof HTMLButtonElement ? fallbackBtn : null;
  }

  function parseTimeFromButton(button) {
    const aria = button.getAttribute('aria-label') || '';
    const ariaMatch = aria.match(/(\d{2}:\d{2}:\d{2})/);
    if (ariaMatch) {
      const m = parseTimeToMinutes(ariaMatch[1]);
      if (m !== null) return m;
    }
    const timeEl = button.querySelector('time[datetime]');
    if (timeEl instanceof HTMLTimeElement) {
      const dt = parseTimeToMinutes(timeEl.getAttribute('datetime') || '');
      if (dt !== null) return dt;
      return parseTimeToMinutes(normalizeText(timeEl.textContent));
    }
    return parseTimeToMinutes(normalizeText(button.textContent));
  }

  function parsePlanRowStartMinutes(row) {
    const firstTime = row.querySelector('time[datetime], time');
    if (firstTime instanceof HTMLTimeElement) {
      const byAttr = parseTimeToMinutes(firstTime.getAttribute('datetime') || '');
      if (byAttr !== null) return byAttr;
      const byText = parseTimeToMinutes(firstTime.textContent || '');
      if (byText !== null) return byText;
    }

    const rowText = normalizeText(row.textContent);
    const match = rowText.match(
      /(\d{1,2}:\d{2}(?::\d{2})?\s*[ap]m|\d{1,2}:\d{2}(?::\d{2})?)/i
    );
    if (!match) return -1;
    const parsed = parseTimeToMinutes(match[1] || '');
    return parsed === null ? -1 : parsed;
  }

  function getPlanRowsForAttraction(attraction) {
    const target = normalizeText(attraction).toLowerCase();
    const rows = Array.from(document.querySelectorAll('li[data-testid="plan"]'));

    return rows
      .map((row, index) => {
        const nameEl =
          row.querySelector('div.text-lg') ||
          row.querySelector('div[class*="text-lg"]');
        const name = normalizeText(nameEl?.textContent || '');
        const nameLower = name.toLowerCase();
        const matchesAttraction =
          !!name &&
          (nameLower === target ||
            nameLower.includes(target) ||
            target.includes(nameLower));
        if (!matchesAttraction) return null;

        const modifyButton = Array.from(row.querySelectorAll('button')).find(
          btn =>
            btn instanceof HTMLButtonElement &&
            isVisible(btn) &&
            /^modify$/i.test(normalizeText(btn.textContent))
        );
        if (!(modifyButton instanceof HTMLButtonElement)) return null;

        const startMinutes = parsePlanRowStartMinutes(row);
        if (startMinutes < 0) return null;
        return {
          row,
          name,
          startMinutes,
          modifyButton,
          key: `${nameLower}|${startMinutes}|${index}`,
        };
      })
      .filter(Boolean)
      .sort((a, b) => b.startMinutes - a.startMinutes);
  }

  async function waitForValue(fn, timeoutMs = 15000, intervalMs = 150) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const value = fn();
      if (value) return value;
      // eslint-disable-next-line no-await-in-loop
      await new Promise(resolve => setTimeout(resolve, intervalMs));
    }
    return null;
  }

  function findDismissButton() {
    const textBtn = findButtonByText(/^(cancel|back|close|done|not now)$/i);
    if (textBtn instanceof HTMLButtonElement) return textBtn;

    const attrBtn = Array.from(
      document.querySelectorAll('button[aria-label], button[title]')
    ).find(btn => {
      if (!(btn instanceof HTMLButtonElement) || !isVisible(btn)) return false;
      const label = normalizeText(btn.getAttribute('aria-label') || '');
      const title = normalizeText(btn.getAttribute('title') || '');
      return /cancel|close|back/i.test(label) || /cancel|close|back/i.test(title);
    });
    return attrBtn instanceof HTMLButtonElement ? attrBtn : null;
  }

  function hasNoEligibleGuestsState() {
    const headings = Array.from(
      document.querySelectorAll('h1, h2, h3, [role="heading"], p')
    )
      .map(el => normalizeText(el.textContent).toLowerCase())
      .filter(Boolean);
    return headings.some(
      text =>
        text.includes('no eligible guests') ||
        text.includes('unable to modify') ||
        text.includes('no one in your party is currently eligible')
    );
  }

  async function exitModifyFlow() {
    const dismissBtn = findDismissButton();
    if (dismissBtn) {
      dismissBtn.click();
      await new Promise(resolve => setTimeout(resolve, 250));
      return true;
    }

    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
    );
    await new Promise(resolve => setTimeout(resolve, 250));
    return false;
  }

  async function chooseEarliestReturnTime(maxMinutesExclusive) {
    return waitForValue(() => {
      if (hasNoEligibleGuestsState()) return { noEligible: true };
      const buttons = Array.from(
        document.querySelectorAll('[data-testid="time-buttons"] button')
      ).filter(isVisible);
      const candidates = buttons
        .map(btn => ({
          btn,
          minutes: parseTimeFromButton(btn),
        }))
        .filter(
          item =>
            item.minutes !== null &&
            (maxMinutesExclusive === null || item.minutes < maxMinutesExclusive)
        )
        .sort((a, b) => a.minutes - b.minutes);

      const chosen = candidates[0];
      if (!chosen || !(chosen.btn instanceof HTMLButtonElement)) return null;
      chosen.btn.click();
      return { minutes: chosen.minutes };
    }, 8000);
  }

  async function attemptModifyFromCurrentScreen(hit, currentPlanMinutes) {
    const noEligibleScreen = await waitForValue(
      () => (hasNoEligibleGuestsState() ? true : null),
      1800,
      120
    );
    if (noEligibleScreen) {
      setStatus(
        `${hit.attraction}: no eligible guests right now. Skipping this party for now...`
      );
      await exitModifyFlow();
      return { status: 'noEligible' };
    }

    const changeBtn = await waitForValue(
      () => findButtonByText(/^change$/i),
      6000,
      120
    );
    if (changeBtn instanceof HTMLButtonElement) changeBtn.click();

    const selected = await chooseEarliestReturnTime(currentPlanMinutes);
    if (!selected) {
      setStatus(
        `Auto-modify: no earlier selectable return time for ${hit.attraction}. Continuing search...`
      );
      await exitModifyFlow();
      return { status: 'noEarlier' };
    }
    if (selected.noEligible) {
      setStatus(
        `${hit.attraction}: no eligible guests right now. Skipping this party for now...`
      );
      await exitModifyFlow();
      return { status: 'noEligible' };
    }

    const submitBtn = await waitForValue(
      () => findButtonByText(/^(modify|book) lightning lane$/i),
      12000
    );
    if (!(submitBtn instanceof HTMLButtonElement)) {
      setStatus(
        `Auto-modify failed: submit button not found for ${hit.attraction}. Continuing search...`
      );
      await exitModifyFlow();
      return { status: 'failed' };
    }

    submitBtn.click();
    return { status: 'success', selectedMinutes: selected.minutes };
  }

  async function attemptModifyFromPlans(hit) {
    const attemptedKeys = new Set();
    const updates = [];
    let attemptedCount = 0;
    let failedCount = 0;

    for (;;) {
      if (!(await ensurePlansContextForModify())) {
        setStatus('Auto-modify retry: unable to open Plans tab.');
        return {
          status: updates.length > 0 ? 'success' : 'retry',
          updates,
          attemptedCount,
        };
      }

      const candidates = getPlanRowsForAttraction(hit.attraction).filter(
        candidate => !attemptedKeys.has(candidate.key)
      );
      if (candidates.length === 0) {
        if (updates.length > 0) {
          return { status: 'success', updates, attemptedCount };
        }
        if (attemptedCount > 0) {
          return {
            status: failedCount > 0 ? 'failed' : 'retry',
            updates,
            attemptedCount,
          };
        }
        setStatus(`Auto-modify retry: no modifiable plan rows found for ${hit.attraction}.`);
        return { status: 'retry', updates, attemptedCount };
      }

      const candidate = candidates[0];
      attemptedKeys.add(candidate.key);
      const timeText =
        candidate.startMinutes >= 0 ? minutesToTime(candidate.startMinutes) : '?';
      setStatus(
        `Auto-modify: opening ${candidate.name} plan at ${timeText} (latest first)...`
      );
      candidate.modifyButton.click();

      attemptedCount += 1;
      const result = await attemptModifyFromCurrentScreen(hit, candidate.startMinutes);
      if (result.status === 'success') {
        updates.push({
          fromMinutes: candidate.startMinutes,
          toMinutes: result.selectedMinutes,
        });
        continue;
      }
      if (result.status === 'noEligible') {
        continue;
      }
      if (result.status === 'failed') {
        failedCount += 1;
      }
      // Continue loop and try next matching plan row for this attraction.
    }
  }

  async function autoModifyMatch(hit) {
    const result = await attemptModifyFromPlans(hit);
    await returnToLLForPolling();

    if (result.updates && result.updates.length > 0) {
      const summary = result.updates
        .map(update => `${minutesToTime(update.fromMinutes)} -> ${minutesToTime(update.toMinutes)}`)
        .join(' | ');
      setStatus(
        `Auto-modify: updated ${result.updates.length} party(s) for ${hit.attraction}. ${summary}. Continuing search...`,
        { level: 'success', holdMs: 4000 }
      );
      notifyFound(
        `Auto-modify updated ${result.updates.length} party(s) for ${hit.attraction}: ${summary}.`,
        { blocking: false }
      );
      return 'success';
    }

    if (result.attemptedCount > 0) {
      setStatus(
        `Auto-modify checked ${result.attemptedCount} party(s) for ${hit.attraction}; no earlier successful update this cycle. Continuing search...`
      );
    }

    return result.status || 'retry';
  }

  function saveCurrentSettings() {
    saveSettings({
      watches: getWatches(),
      autoModify: autoModifyInput.checked,
      intervalSec: clampInterval(intervalInput.value),
    });
  }

  function notifyFound(message, options = {}) {
    const { blocking = !autoModifyInput.checked } = options;
    try {
      const audio = new AudioContext();
      const oscillator = audio.createOscillator();
      const gain = audio.createGain();
      oscillator.type = 'triangle';
      oscillator.frequency.value = 880;
      gain.gain.value = 0.12;
      oscillator.connect(gain);
      gain.connect(audio.destination);
      oscillator.start();
      oscillator.stop(audio.currentTime + 0.25);
    } catch {
      // ignore audio failures
    }

    if ('Notification' in window && Notification.permission === 'granted') {
      new Notification('BG1 Auto Finder', { body: message });
    }

    if (blocking) alert(message);
  }

  function refreshExperiences() {
    const refreshBtn = document.querySelector('button[title="Refresh Experiences"]');
    if (refreshBtn instanceof HTMLButtonElement) {
      refreshBtn.click();
      return true;
    }
    return false;
  }

  async function evaluateMatch() {
    const watches = getWatches();
    if (watches.length === 0) {
      setStatus('Add at least one attraction target to begin.');
      return false;
    }

    const hits = [];
    const missing = [];
    const waiting = [];
    const autoMode = autoModifyInput.checked;

    for (const watch of watches) {
      const { attraction, targetTime } = watch;
      const currentMinutes = findAttractionTime(attraction);
      if (currentMinutes === null) {
        missing.push(attraction);
        continue;
      }

      if (autoMode) {
        hits.push({
          attraction,
          current: minutesToTime(currentMinutes),
          target: null,
        });
        continue;
      }

      const targetMinutes = parseTimeToMinutes(targetTime);
      const current = minutesToTime(currentMinutes);
      const target = targetMinutes === null ? null : minutesToTime(targetMinutes);
      if (targetMinutes === null || currentMinutes <= targetMinutes) {
        hits.push({ attraction, current, target });
      } else {
        waiting.push({
          attraction,
          current,
          target,
          delta: currentMinutes - targetMinutes,
        });
      }
    }

    if (hits.length > 0) {
      const summary = hits
        .map(h => `${h.attraction} ${h.current}${h.target ? ` (<= ${h.target})` : ''}`)
        .join(' | ');
      if (autoMode) {
        if (modifyInProgress) {
          setStatus('Auto-modify already in progress...');
          return false;
        }
        const firstHit = hits[0];
        if (firstHit) {
          setStatus(
            `Availability found for ${firstHit.attraction} (${firstHit.current}). Checking all matching plan parties...`,
            { level: 'success', holdMs: 4000 }
          );
          modifyInProgress = true;
          try {
            await autoModifyMatch(firstHit);
            return false;
          } finally {
            modifyInProgress = false;
          }
        }
        return false;
      } else {
        setStatus(`Found: ${summary}`);
        notifyFound(`Matched targets: ${summary}.`);
        return true;
      }
    }

    if (autoMode) {
      if (missing.length === watches.length) {
        setStatus(`No LL time available yet for watched attractions (${watches.length}).`);
        return false;
      }
      setStatus(
        `Watching ${watches.length} attraction(s) for earlier times and plan-based updates.${missing.length > 0 ? ` ${missing.length} unavailable.` : ''}`
      );
      return false;
    }

    if (waiting.length > 0) {
      waiting.sort((a, b) => a.delta - b.delta);
      const closest = waiting[0];
      setStatus(
        `Watching ${watches.length} targets. Closest: ${closest.attraction} ${closest.current} (target <= ${closest.target}).${missing.length > 0 ? ` ${missing.length} unavailable.` : ''}`
      );
      return false;
    }

    if (missing.length === watches.length) {
      setStatus(`No LL time available yet for watched attractions (${watches.length}).`);
      return false;
    }

    setStatus(`Watching ${watches.length} targets.`);
    return false;
  }

  function runCycle() {
    if (!running || cycleBusy) return;
    if (modifyInProgress) {
      scheduleNextCycle();
      return;
    }
    cycleBusy = true;

    if (!refreshExperiences()) {
      setStatus('Refresh button not found. Open LL tab first.');
      cycleBusy = false;
      scheduleNextCycle();
      return;
    }

    setStatus('Refreshing experiences...');
    evalTimerId = self.setTimeout(async () => {
      if (!running) {
        cycleBusy = false;
        return;
      }
      try {
        if (await evaluateMatch()) {
          stop();
          return;
        }
      } catch (error) {
        const reason =
          error && typeof error.message === 'string'
            ? error.message
            : String(error || 'unknown error');
        setStatus(`Auto finder error: ${reason}. Continuing search...`, { level: 'error' });
      }
      cycleBusy = false;
      scheduleNextCycle();
    }, CONFIG.postRefreshDelayMs);
  }

  function scheduleNextCycle() {
    if (!running) return;
    self.clearTimeout(timerId);
    timerId = self.setTimeout(runCycle, clampInterval(intervalInput.value) * 1000);
  }

  function scheduleEvaluateFromDom() {
    if (!running || evaluatePending || cycleBusy || modifyInProgress) return;
    evaluatePending = true;
    setTimeout(async () => {
      evaluatePending = false;
      if (!running || cycleBusy || modifyInProgress) return;
      try {
        if (await evaluateMatch()) stop();
      } catch (error) {
        const reason =
          error && typeof error.message === 'string'
            ? error.message
            : String(error || 'unknown error');
        setStatus(`Auto finder error: ${reason}. Continuing search...`, { level: 'error' });
      }
    }, 300);
  }

  function start() {
    if (running) return;

    saveCurrentSettings();
    syncWatchRows();

    if (getWatches().length === 0) {
      setStatus('Add at least one attraction target first.');
      return;
    }

    running = true;
    const intervalSec = clampInterval(intervalInput.value);
    intervalInput.value = String(intervalSec);

    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission().catch(() => undefined);
    }

    setStatus('Auto refresh started.');
    cycleBusy = false;
    modifyInProgress = false;
    runCycle();
  }

  function stop() {
    if (!running) {
      setStatus('Stopped.');
      return;
    }
    running = false;
    cycleBusy = false;
    modifyInProgress = false;
    self.clearTimeout(timerId);
    self.clearTimeout(evalTimerId);
    timerId = 0;
    evalTimerId = 0;
    setStatus('Stopped.');
  }

  startBtn.addEventListener('click', start);
  stopBtn.addEventListener('click', stop);
  addWatchBtn.addEventListener('click', () => {
    createWatchRow();
    updateTargetInputsState();
    saveCurrentSettings();
  });
  autoModifyInput.addEventListener('change', () => {
    updateTargetInputsState();
    saveCurrentSettings();
  });
  intervalInput.addEventListener('change', () => {
    intervalInput.value = String(clampInterval(intervalInput.value));
    saveCurrentSettings();
  });

  for (const watch of settings.watches) createWatchRow(watch);
  if (getWatchRows().length === 0) createWatchRow();
  syncWatchRows();
  updateTargetInputsState();
  setStatus('Ready. Add attraction targets and press Start.');

  function scheduleOptionsRefresh() {
    if (optionRefreshPending) return;
    optionRefreshPending = true;
    requestAnimationFrame(() => {
      optionRefreshPending = false;
      syncWatchRows();
      if (running) saveCurrentSettings();
    });
  }

  const observer = new MutationObserver(mutations => {
    const hasExternalChange = mutations.some(
      m => !(m.target instanceof Node) || !panel.contains(m.target)
    );
    if (!hasExternalChange) return;
    scheduleOptionsRefresh();
    scheduleEvaluateFromDom();
  });
  observer.observe(document.body, { childList: true, subtree: true });
  self.setTimeout(scheduleOptionsRefresh, 300);
  self.setTimeout(scheduleOptionsRefresh, 1500);
}

function clampInterval(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return CONFIG.pollIntervalSec;
  return Math.min(300, Math.max(1, Math.round(num)));
}

function loadSettings() {
  try {
    const parsed = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
    const watches = Array.isArray(parsed.watches)
      ? parsed.watches
          .map(w => ({
            attraction:
              typeof w?.attraction === 'string' ? w.attraction.trim() : '',
            targetTime:
              typeof w?.targetTime === 'string' ? w.targetTime.trim() : '',
          }))
          .filter(w => w.attraction)
      : [];
    const migratedAttractions = Array.isArray(parsed.attractions)
      ? parsed.attractions.filter(a => typeof a === 'string')
      : typeof parsed.attraction === 'string' && parsed.attraction
        ? [parsed.attraction]
        : [];
    const migratedTargetTime =
      typeof parsed.targetTime === 'string' ? parsed.targetTime : '';
    const finalWatches =
      watches.length > 0
        ? watches
        : migratedAttractions.map(attraction => ({
            attraction,
            targetTime: migratedTargetTime,
          }));
    const autoModify =
      typeof parsed.autoModify === 'boolean'
        ? parsed.autoModify
        : CONFIG.autoModifyOnMatch;
    return {
      watches: finalWatches,
      autoModify,
      intervalSec: clampInterval(parsed.intervalSec),
    };
  } catch {
    return {
      watches: [],
      autoModify: CONFIG.autoModifyOnMatch,
      intervalSec: CONFIG.pollIntervalSec,
    };
  }
}

function saveSettings(settings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

function loadPanelPos() {
  try {
    const parsed = JSON.parse(localStorage.getItem(PANEL_POS_KEY) || '{}');
    const x = Number(parsed.x);
    const y = Number(parsed.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    return { x: Math.max(0, Math.round(x)), y: Math.max(0, Math.round(y)) };
  } catch {
    return null;
  }
}

function savePanelPos(pos) {
  localStorage.setItem(
    PANEL_POS_KEY,
    JSON.stringify({ x: Math.max(0, pos.x), y: Math.max(0, pos.y) })
  );
}

function waitForElement(selector, timeoutMs) {
  return new Promise((resolve, reject) => {
    const immediate = document.querySelector(selector);
    if (immediate) {
      resolve(immediate);
      return;
    }

    const observer = new MutationObserver(() => {
      const element = document.querySelector(selector);
      if (element) {
        observer.disconnect();
        resolve(element);
      }
    });

    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
    });

    setTimeout(() => {
      observer.disconnect();
      reject(new Error(`Timed out waiting for ${selector}`));
    }, timeoutMs);
  });
}
