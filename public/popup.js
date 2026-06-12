// Popup logic. Plain JS (not part of the content-script bundle) so it can be
// loaded directly by popup.html as the toolbar action popup.
//
// NOTE: SETTINGS_KEY and DEFAULTS mirror src/settings.ts. Keep them in sync.
const SETTINGS_KEY = 'settings';
const DEFAULTS = { autoSendDelayMs: 400, startPaused: false };

const delayEl = document.getElementById('delay');
const startPausedEl = document.getElementById('startPaused');
const savedEl = document.getElementById('saved');

function fill(settings) {
  delayEl.value = String(settings.autoSendDelayMs / 1000);
  startPausedEl.checked = Boolean(settings.startPaused);
}

function readForm() {
  const seconds = Number.parseFloat(delayEl.value);
  const safeSeconds = Number.isFinite(seconds) && seconds >= 0 ? Math.min(seconds, 60) : 0;
  return {
    autoSendDelayMs: Math.round(safeSeconds * 1000),
    startPaused: startPausedEl.checked,
  };
}

function flashSaved() {
  savedEl.classList.add('show');
  setTimeout(() => savedEl.classList.remove('show'), 1400);
}

async function load() {
  const stored = await chrome.storage.local.get(SETTINGS_KEY);
  fill({ ...DEFAULTS, ...(stored[SETTINGS_KEY] ?? {}) });
}

async function save() {
  const settings = readForm();
  await chrome.storage.local.set({ [SETTINGS_KEY]: settings });
  fill(settings); // reflect the normalized values back into the form
  flashSaved();
}

async function reset() {
  await chrome.storage.local.set({ [SETTINGS_KEY]: DEFAULTS });
  fill(DEFAULTS);
  flashSaved();
}

document.getElementById('save').addEventListener('click', save);
document.getElementById('reset').addEventListener('click', reset);

load();
