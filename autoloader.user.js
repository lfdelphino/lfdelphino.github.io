// ==UserScript==
// @name         BG1 Autoloader
// @namespace    https://bg1.local/
// @version      1.4
// @description  Load BG1 (local or prod), auto-refresh targets, and optionally auto-modify on match
// @author       Luiz Delphino
// @match        https://localhost:3000/bg1/*
// @match        http://localhost:3000/bg1/*
// @match        https://joelface.github.io/bg1/*
// @match        https://disneyworld.disney.go.com/vas/
// @match        https://disneyworld.disney.go.com/*/vas/
// @match        https://disneyland.disney.go.com/vas/
// @match        https://disneyland.disney.go.com/*/vas/
// @match        https://vqguest-svc-wdw.wdprapps.disney.com/application/v1/guest/getQueues
// @match        https://vqguest-svc.wdprapps.disney.com/application/v1/guest/getQueues
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

const SETTINGS_KEY = 'bg1.autoloader.settings.v1';
const PANEL_POS_KEY = 'bg1.autoloader.panelPos.v1';

const bg1BaseUrl = (CONFIG.mode === 'local'
  ? CONFIG.localBaseUrl
  : CONFIG.prodBaseUrl
).replace(/\/?$/, '/');

const entryScript = CONFIG.mode === 'local' ? 'bg1-dev.ts' : 'bg1.js';

injectBg1();
waitForElement('button[title="Refresh Experiences"]', 60_000)
  .then(initAutoFinder)
  .catch(() => undefined);

function injectBg1() {
  document.open();
  document.write(
    `<!doctype html><html><head><link rel="stylesheet" href="${bg1BaseUrl}bg1.css"></head><body></body></html>`
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

  const panel = document.createElement('div');
  panel.id = 'bg1af-panel';
  panel.style.cssText = [
    'position:fixed',
    'right:12px',
    'bottom:12px',
    'z-index:2147483647',
    'background:#111',
    'color:#fff',
    'padding:10px',
    'border-radius:8px',
    'width:320px',
    'font:12px/1.35 Arial,sans-serif',
    'box-shadow:0 8px 24px rgba(0,0,0,.45)',
  ].join(';');
  panel.innerHTML = `
    <div id="bg1af-drag-handle" style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px;cursor:move;user-select:none;touch-action:none;">
      <strong style="font-size:13px;">BG1 Auto Finder</strong>
      <span id="bg1af-mode" style="opacity:.75;">${CONFIG.mode.toUpperCase()}</span>
    </div>

    <label style="display:block;margin-bottom:6px;">Attraction Targets</label>
    <div id="bg1af-watch-list" style="display:flex;flex-direction:column;gap:6px;margin-bottom:6px;"></div>
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
  `;

  document.body.appendChild(panel);

  const watchList = panel.querySelector('#bg1af-watch-list');
  const addWatchBtn = panel.querySelector('#bg1af-add-watch');
  const intervalInput = panel.querySelector('#bg1af-interval');
  const autoModifyInput = panel.querySelector('#bg1af-auto-modify');
  const startBtn = panel.querySelector('#bg1af-start');
  const stopBtn = panel.querySelector('#bg1af-stop');
  const status = panel.querySelector('#bg1af-status');
  const dragHandle = panel.querySelector('#bg1af-drag-handle');

  if (
    !(watchList instanceof HTMLDivElement) ||
    !(addWatchBtn instanceof HTMLButtonElement) ||
    !(intervalInput instanceof HTMLInputElement) ||
    !(autoModifyInput instanceof HTMLInputElement) ||
    !(startBtn instanceof HTMLButtonElement) ||
    !(stopBtn instanceof HTMLButtonElement) ||
    !(status instanceof HTMLDivElement) ||
    !(dragHandle instanceof HTMLDivElement)
  ) {
    return;
  }

  autoModifyInput.checked = settings.autoModify;

  const panelPos = loadPanelPos();
  if (panelPos) {
    panel.style.left = `${panelPos.x}px`;
    panel.style.top = `${panelPos.y}px`;
    panel.style.right = 'auto';
    panel.style.bottom = 'auto';
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
    const maxX = Math.max(0, window.innerWidth - panel.offsetWidth);
    const maxY = Math.max(0, window.innerHeight - panel.offsetHeight);
    const x = Math.max(0, Math.min(maxX, event.clientX - drag.offsetX));
    const y = Math.max(0, Math.min(maxY, event.clientY - drag.offsetY));
    panel.style.left = `${Math.round(x)}px`;
    panel.style.top = `${Math.round(y)}px`;
    panel.style.right = 'auto';
    panel.style.bottom = 'auto';
  }

  function onDragEnd(event) {
    if (!drag || event.pointerId !== drag.pointerId) return;
    dragHandle.releasePointerCapture(event.pointerId);
    drag = undefined;
    savePanelPos({
      x: parseInt(panel.style.left, 10) || 0,
      y: parseInt(panel.style.top, 10) || 0,
    });
  }

  dragHandle.addEventListener('pointerdown', onDragStart);
  dragHandle.addEventListener('pointermove', onDragMove);
  dragHandle.addEventListener('pointerup', onDragEnd);
  dragHandle.addEventListener('pointercancel', onDragEnd);

  function setStatus(text) {
    status.textContent = text;
  }

  function getAttractionRows() {
    return Array.from(document.querySelectorAll('ul[data-testid] li'));
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
      <input class="bg1af-watch-target" type="time" title="Target Earliest Time" style="width:92px;padding:5px;border-radius:4px;border:1px solid #444;background:#222;color:#fff;" />
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
      saveCurrentSettings();
    });

    watchList.appendChild(row);
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

  function findButtonByText(pattern) {
    return Array.from(document.querySelectorAll('button')).find(
      btn => isVisible(btn) && pattern.test(normalizeText(btn.textContent))
    );
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

  async function autoModifyMatch(hit) {
    const row = findAttractionRow(hit.attraction);
    if (!row) {
      setStatus(`Auto-modify failed: ${hit.attraction} row not found.`);
      return;
    }

    const llButton = findLlActionButton(row);
    if (!llButton) {
      setStatus(`Auto-modify failed: no LL action button for ${hit.attraction}.`);
      return;
    }

    setStatus(`Auto-modify: opening ${hit.attraction}...`);
    llButton.click();

    const targetMinutes = hit.target ? parseTimeToMinutes(hit.target) : null;
    if (targetMinutes !== null) {
      const changeBtn = await waitForValue(() => findButtonByText(/^change$/i), 10000);
      if (changeBtn instanceof HTMLButtonElement) {
        changeBtn.click();

        const selected = await waitForValue(() => {
          const buttons = Array.from(
            document.querySelectorAll('[data-testid="time-buttons"] button')
          ).filter(isVisible);
          const candidates = buttons
            .map(btn => ({
              btn,
              minutes: parseTimeFromButton(btn),
            }))
            .filter(item => item.minutes !== null && item.minutes <= targetMinutes)
            .sort((a, b) => a.minutes - b.minutes);
          const chosen = candidates[0]?.btn;
          if (chosen instanceof HTMLButtonElement) {
            chosen.click();
            return true;
          }
          return null;
        }, 8000);
        if (!selected) {
          setStatus(
            `Auto-modify: no selectable return time <= ${minutesToTime(targetMinutes)} for ${hit.attraction}.`
          );
        }
      }
    }

    const submitBtn = await waitForValue(
      () => findButtonByText(/^(modify|book) lightning lane$/i),
      12000
    );
    if (!(submitBtn instanceof HTMLButtonElement)) {
      setStatus(`Auto-modify failed: submit button not found for ${hit.attraction}.`);
      return;
    }

    submitBtn.click();
    const suffix = hit.target ? ` (<= ${hit.target})` : '';
    setStatus(`Auto-modify submitted: ${hit.attraction} ${hit.current}${suffix}.`);
    notifyFound(`Auto-modify submitted: ${hit.attraction} at ${hit.current}${suffix}.`);
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

  function evaluateMatch() {
    const watches = getWatches();
    if (watches.length === 0) {
      setStatus('Add at least one attraction target to begin.');
      return false;
    }

    const hits = [];
    const missing = [];
    const waiting = [];

    for (const watch of watches) {
      const { attraction, targetTime } = watch;
      const currentMinutes = findAttractionTime(attraction);
      if (currentMinutes === null) {
        missing.push(attraction);
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
      if (autoModifyInput.checked) {
        const firstHit = hits[0];
        if (firstHit) {
          setStatus(`Match found. Auto-modifying: ${firstHit.attraction}...`);
          void autoModifyMatch(firstHit);
        }
      } else {
        setStatus(`Found: ${summary}`);
        notifyFound(`Matched targets: ${summary}.`);
      }
      return true;
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
    cycleBusy = true;

    if (!refreshExperiences()) {
      setStatus('Refresh button not found. Open LL tab first.');
      cycleBusy = false;
      scheduleNextCycle();
      return;
    }

    setStatus('Refreshing experiences...');
    evalTimerId = self.setTimeout(() => {
      if (!running) return;
      if (evaluateMatch()) {
        stop();
        return;
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
    if (!running || evaluatePending) return;
    evaluatePending = true;
    setTimeout(() => {
      evaluatePending = false;
      if (!running) return;
      if (evaluateMatch()) stop();
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
    runCycle();
  }

  function stop() {
    if (!running) {
      setStatus('Stopped.');
      return;
    }
    running = false;
    cycleBusy = false;
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
    saveCurrentSettings();
  });
  autoModifyInput.addEventListener('change', saveCurrentSettings);
  intervalInput.addEventListener('change', () => {
    intervalInput.value = String(clampInterval(intervalInput.value));
    saveCurrentSettings();
  });

  for (const watch of settings.watches) createWatchRow(watch);
  if (getWatchRows().length === 0) createWatchRow();
  syncWatchRows();
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
    if (!running) return;
    const hasExternalChange = mutations.some(
      m => !(m.target instanceof Node) || !panel.contains(m.target)
    );
    if (!hasExternalChange) return;
    scheduleOptionsRefresh();
    scheduleEvaluateFromDom();
  });
  observer.observe(document.body, { childList: true, subtree: true });
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
