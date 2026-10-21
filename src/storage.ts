/**
 * chrome.storage.local, or null when the extension context is gone — e.g. the
 * extension was reloaded/updated while this tab stayed open, which severs the
 * content script's bridge and leaves `chrome.storage` undefined. Reading
 * `chrome.*` after invalidation can also throw, hence the try/catch. Callers
 * fall back to in-memory state so nothing crashes; persistence resumes once
 * the tab is reloaded.
 */
export function storageArea(): chrome.storage.LocalStorageArea | null {
  try {
    return chrome?.storage?.local ?? null;
  } catch {
    return null;
  }
}

/** Subscribe to chrome.storage.local changes, if the extension context is alive. */
export function onLocalChanged(
  fn: (changes: Record<string, chrome.storage.StorageChange>) => void,
): void {
  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local') fn(changes);
    });
  } catch {
    // Context invalidated: there's nothing to listen to.
  }
}
