/**
 * User-configurable settings, persisted in chrome.storage.local under a single
 * key. The toolbar popup (public/popup.js) writes this same key; the content
 * script reads it here and reacts to live changes via onSettingsChanged.
 *
 * NOTE: SETTINGS_KEY and DEFAULT_SETTINGS are mirrored as literals in
 * public/popup.js (which is plain JS, not part of this bundle). Keep them in
 * sync if you change either.
 */
export interface Settings {
  /** Delay after a response finishes before the next queued prompt is sent. */
  autoSendDelayMs: number;
  /** Start with auto-send paused on every page load. */
  startPaused: boolean;
}

export const SETTINGS_KEY = 'settings';

export const DEFAULT_SETTINGS: Settings = {
  autoSendDelayMs: 400,
  startPaused: false,
};

export async function loadSettings(): Promise<Settings> {
  const stored = await chrome.storage.local.get(SETTINGS_KEY);
  return merge(stored[SETTINGS_KEY] as Partial<Settings> | undefined);
}

/** Invoke `fn` whenever the settings change in another context (e.g. the popup). */
export function onSettingsChanged(fn: (settings: Settings) => void): void {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes[SETTINGS_KEY]) return;
    fn(merge(changes[SETTINGS_KEY].newValue as Partial<Settings> | undefined));
  });
}

function merge(partial: Partial<Settings> | undefined): Settings {
  return { ...DEFAULT_SETTINGS, ...(partial ?? {}) };
}
