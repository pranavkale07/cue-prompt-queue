import { onLocalChanged, storageArea } from './storage';

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
  /**
   * Pressing Enter while ChatGPT is generating queues the prompt. Off: Enter
   * is left to ChatGPT (useful if Enter inserts a new line for you).
   */
  enterToQueue: boolean;
}

export const SETTINGS_KEY = 'settings';

export const DEFAULT_SETTINGS: Settings = {
  autoSendDelayMs: 400,
  startPaused: false,
  enterToQueue: true,
};

export async function loadSettings(): Promise<Settings> {
  const area = storageArea();
  const stored = area ? await area.get(SETTINGS_KEY) : {};
  return merge(stored[SETTINGS_KEY] as Partial<Settings> | undefined);
}

/** Invoke `fn` whenever the settings change in another context (e.g. the popup). */
export function onSettingsChanged(fn: (settings: Settings) => void): void {
  onLocalChanged((changes) => {
    if (!changes[SETTINGS_KEY]) return;
    fn(merge(changes[SETTINGS_KEY].newValue as Partial<Settings> | undefined));
  });
}

function merge(partial: Partial<Settings> | undefined): Settings {
  return { ...DEFAULT_SETTINGS, ...(partial ?? {}) };
}
