export interface QueueItem {
  id: string;
  text: string;
}

type Listener = (items: QueueItem[]) => void;

const STORAGE_PREFIX = 'queue:';

function keyFor(convId: string): string {
  return STORAGE_PREFIX + convId;
}

function newId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

/**
 * chrome.storage.local, or null when the extension context is gone — e.g. the
 * extension was reloaded/updated while this tab stayed open, which severs the
 * content script's bridge and leaves `chrome.storage` undefined. Reading
 * `chrome.*` after invalidation can also throw, hence the try/catch. Callers
 * fall back to an in-memory queue so nothing crashes; persistence resumes once
 * the tab is reloaded.
 */
function storageArea(): chrome.storage.LocalStorageArea | null {
  try {
    return chrome?.storage?.local ?? null;
  } catch {
    return null;
  }
}

/**
 * Ordered list of pending prompts for a single conversation, mirrored to
 * chrome.storage.local so it survives reloads. The conversation id scopes the
 * stored key; switching conversations loads that conversation's own queue.
 */
export class Queue {
  private items: QueueItem[] = [];
  private convId = 'new';
  private listeners = new Set<Listener>();

  /** Load the queue for `convId` from storage, replacing current contents. */
  async load(convId: string): Promise<void> {
    this.convId = convId;
    const area = storageArea();
    const stored = area ? await area.get(keyFor(convId)) : {};
    this.items = (stored[keyFor(convId)] as QueueItem[] | undefined) ?? [];
    this.emit();
  }

  /**
   * Re-key the in-memory queue to a new conversation id without reloading —
   * used when a brand-new chat ("new") is assigned a real id after the first
   * send, so queued items carry over seamlessly.
   */
  async rekey(newConvId: string): Promise<void> {
    const oldKey = keyFor(this.convId);
    this.convId = newConvId;
    await this.persist();
    if (oldKey !== keyFor(newConvId)) {
      await storageArea()?.remove(oldKey);
    }
  }

  get conversationId(): string {
    return this.convId;
  }

  getItems(): QueueItem[] {
    return [...this.items];
  }

  get size(): number {
    return this.items.length;
  }

  peek(): QueueItem | undefined {
    return this.items[0];
  }

  add(text: string): void {
    const trimmed = text.trim();
    if (!trimmed) return;
    this.items.push({ id: newId(), text: trimmed });
    this.commit();
  }

  removeById(id: string): void {
    this.items = this.items.filter((it) => it.id !== id);
    this.commit();
  }

  /** Remove and return the head item. */
  shift(): QueueItem | undefined {
    const item = this.items.shift();
    this.commit();
    return item;
  }

  editText(id: string, text: string): void {
    const item = this.items.find((it) => it.id === id);
    if (!item) return;
    item.text = text.trim();
    this.commit();
  }

  move(id: string, direction: -1 | 1): void {
    const i = this.items.findIndex((it) => it.id === id);
    if (i < 0) return;
    const j = i + direction;
    if (j < 0 || j >= this.items.length) return;
    [this.items[i], this.items[j]] = [this.items[j], this.items[i]];
    this.commit();
  }

  /**
   * Move `id` to `targetIndex`, where targetIndex is the desired position in the
   * list *after the item has been removed* (the convention drag-and-drop uses).
   * No-op if it wouldn't change the order.
   */
  moveToIndex(id: string, targetIndex: number): void {
    const from = this.items.findIndex((it) => it.id === id);
    if (from < 0) return;
    const [item] = this.items.splice(from, 1);
    const to = Math.max(0, Math.min(targetIndex, this.items.length));
    if (to === from) {
      this.items.splice(from, 0, item);
      return; // unchanged → no commit
    }
    this.items.splice(to, 0, item);
    this.commit();
  }

  clear(): void {
    this.items = [];
    this.commit();
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    fn(this.getItems());
    return () => this.listeners.delete(fn);
  }

  private commit(): void {
    this.emit();
    void this.persist();
  }

  private async persist(): Promise<void> {
    await storageArea()?.set({ [keyFor(this.convId)]: this.items });
  }

  private emit(): void {
    const snapshot = this.getItems();
    for (const fn of this.listeners) fn(snapshot);
  }
}
