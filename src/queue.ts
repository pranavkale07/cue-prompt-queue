import type { Attachment } from './attachments';
import { onLocalChanged, storageArea } from './storage';

export interface QueueItem {
  id: string;
  text: string;
  /** Chip names of the attachments queued with this prompt. */
  attachments?: string[];
}

type Listener = (items: QueueItem[]) => void;

const STORAGE_PREFIX = 'queue:';
// Where 0.2.0 and earlier kept the queue of every unsaved chat, in all tabs.
const LEGACY_NEW_KEY = STORAGE_PREFIX + 'new';
const TAB_ID_KEY = 'cue:tab';

/**
 * An id for this tab that survives reloads (sessionStorage is per tab), so a
 * new chat's queue stays with the tab it was made in instead of showing up in
 * every tab's new chat.
 */
function tabId(): string {
  try {
    let id = sessionStorage.getItem(TAB_ID_KEY);
    if (!id) {
      id = newId();
      sessionStorage.setItem(TAB_ID_KEY, id);
    }
    return id;
  } catch {
    return 'tab';
  }
}

function keyFor(convId: string): string {
  return convId === 'new' ? `${LEGACY_NEW_KEY}:${tabId()}` : STORAGE_PREFIX + convId;
}

function newId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

/**
 * Ordered list of pending prompts for a single conversation, mirrored to
 * chrome.storage.local so it survives reloads. The conversation id scopes the
 * stored key; switching conversations loads that conversation's own queue.
 *
 * Attachment data (files, long pastes) is kept in memory only, keyed by item
 * id; storage keeps just their names. After a reload the names remain but the
 * data is gone, which `attachmentsFor` reports so the item is never sent
 * without them.
 *
 * Other tabs open on the same conversation share the stored queue: changes
 * they make are picked up from storage.onChanged.
 */
export class Queue {
  private items: QueueItem[] = [];
  private convId = 'new';
  private listeners = new Set<Listener>();
  private attachmentData = new Map<string, Attachment[]>();
  // Values this tab wrote that onChanged hasn't echoed back yet.
  private ownWrites: string[] = [];

  constructor() {
    onLocalChanged((changes) => {
      const change = changes[this.storageKey];
      if (change) this.sync((change.newValue as QueueItem[] | undefined) ?? []);
    });
  }

  /** Load the queue for `convId` from storage, replacing current contents. */
  async load(convId: string): Promise<void> {
    this.convId = convId;
    const key = keyFor(convId);
    const area = storageArea();
    const stored = area ? await area.get([key, LEGACY_NEW_KEY]) : {};
    if (this.convId !== convId) return; // switched again while loading
    this.items = (stored[key] as QueueItem[] | undefined) ?? [];
    const legacy = stored[LEGACY_NEW_KEY] as QueueItem[] | undefined;
    if (convId === 'new' && this.items.length === 0 && legacy?.length) {
      // Adopt a new-chat queue saved by an older version, once.
      this.items = legacy;
      await this.persist();
      await area?.remove(LEGACY_NEW_KEY);
    }
    this.emit();
  }

  /**
   * Re-key the in-memory queue to a new conversation id without reloading —
   * used when a brand-new chat ("new") is assigned a real id after the first
   * send, so queued items carry over seamlessly.
   */
  async rekey(newConvId: string): Promise<void> {
    const oldKey = keyFor(this.convId);
    const newKey = keyFor(newConvId);
    this.convId = newConvId;
    // Never overwrite a queue already stored for that conversation.
    const area = storageArea();
    const stored = ((area ? await area.get(newKey) : {})[newKey] as QueueItem[] | undefined) ?? [];
    if (stored.length) {
      const ids = new Set(this.items.map((it) => it.id));
      this.items = [...stored.filter((it) => !ids.has(it.id)), ...this.items];
      this.emit();
    }
    await this.persist();
    if (oldKey !== keyFor(newConvId)) {
      await storageArea()?.remove(oldKey);
    }
  }

  get conversationId(): string {
    return this.convId;
  }

  /** The storage key of the current queue; it identifies the queue across tabs. */
  get storageKey(): string {
    return keyFor(this.convId);
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

  /** `names` are the attachments' chip names, parallel to `attachments`. */
  add(text: string, attachments: Attachment[] = [], names: string[] = []): void {
    const trimmed = text.trim();
    if (!trimmed && attachments.length === 0) return;
    const item: QueueItem = { id: newId(), text: trimmed };
    if (attachments.length > 0) {
      item.attachments = names;
      this.attachmentData.set(item.id, attachments);
    }
    this.items.push(item);
    this.commit();
  }

  /**
   * The attachments to send with `item`: [] if it has none, null if it had
   * some but their data is gone (the page was reloaded since it was queued).
   */
  attachmentsFor(item: QueueItem): Attachment[] | null {
    if (!item.attachments?.length) return [];
    return this.attachmentData.get(item.id) ?? null;
  }

  removeById(id: string): void {
    this.items = this.items.filter((it) => it.id !== id);
    this.attachmentData.delete(id);
    this.commit();
  }

  /**
   * Remove an item that was just sent. `key` is the storageKey it was sent
   * from: if the user has since switched to another conversation, it's removed
   * from that one's stored queue rather than from the one now shown.
   */
  async removeSent(id: string, key: string): Promise<void> {
    if (this.items.some((it) => it.id === id)) {
      this.removeById(id);
      return;
    }
    this.attachmentData.delete(id);
    const area = storageArea();
    if (!area || key === this.storageKey) return;
    const stored = ((await area.get(key))[key] as QueueItem[] | undefined) ?? [];
    const rest = stored.filter((it) => it.id !== id);
    if (rest.length === stored.length) return;
    await (rest.length ? area.set({ [key]: rest }) : area.remove(key));
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
    for (const it of this.items) this.attachmentData.delete(it.id);
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
    const area = storageArea();
    if (!area) return;
    this.ownWrites.push(JSON.stringify(this.items));
    // A write that changed nothing is never echoed; don't let those pile up.
    if (this.ownWrites.length > 20) this.ownWrites.shift();
    // Don't leave a key behind for every conversation that ever had a queue.
    const key = this.storageKey;
    await (this.items.length ? area.set({ [key]: this.items }) : area.remove(key));
  }

  /** Take on a change to this conversation's stored queue made by another tab. */
  private sync(items: QueueItem[]): void {
    const json = JSON.stringify(items);
    const own = this.ownWrites.indexOf(json);
    if (own >= 0) {
      // Our own write coming back (and any older ones of ours before it).
      this.ownWrites.splice(0, own + 1);
      return;
    }
    if (json === JSON.stringify(this.items)) return;
    this.items = items;
    for (const id of this.attachmentData.keys()) {
      if (!items.some((it) => it.id === id)) this.attachmentData.delete(id);
    }
    this.emit();
  }

  private emit(): void {
    const snapshot = this.getItems();
    for (const fn of this.listeners) fn(snapshot);
  }
}
