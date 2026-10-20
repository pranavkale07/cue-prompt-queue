import type { SiteAdapter } from './adapters/types';

/**
 * A local copy of something the user attached in the composer, kept so a
 * queued prompt can re-attach it when it's sent: a file (image, document), or
 * the original text of a long paste the site turned into a file.
 */
export type Attachment =
  | { kind: 'file'; file: File }
  | { kind: 'text'; text: string };

// Pastes shorter than this always land inline as text; ChatGPT only turns
// much longer ones (~10k chars) into an attachment.
const MIN_TEXT_ATTACHMENT = 1000;
// How long after a paste/drop/pick to check which captures became chips.
const RECONCILE_MS = 1500;

/**
 * Keeps a local copy of every attachment the user adds to the composer —
 * pasted, dropped, or picked with the site's file inputs — so it can be queued
 * along with the prompt. Copies are grouped by chip name, in the same order as
 * the site's chips, so duplicates (two "image.png" screenshots) stay matched.
 *
 * Nothing is read from the network or the site's own state: only the `File`s
 * and text the browser hands to the page in paste/drop/change events.
 */
export class AttachmentTracker {
  private captured = new Map<string, Attachment[]>();
  private reconcileTimer: number | null = null;

  constructor(private readonly adapter: SiteAdapter) {}

  install(): void {
    document.addEventListener('paste', this.onPaste, true);
    document.addEventListener('drop', this.onDrop, true);
    document.addEventListener('change', this.onChange, true);
    document.addEventListener('click', this.onClick, true);
  }

  uninstall(): void {
    document.removeEventListener('paste', this.onPaste, true);
    document.removeEventListener('drop', this.onDrop, true);
    document.removeEventListener('change', this.onChange, true);
    document.removeEventListener('click', this.onClick, true);
    if (this.reconcileTimer !== null) window.clearTimeout(this.reconcileTimer);
  }

  /**
   * Local copies for every chip in the composer, in chip order, or null if any
   * chip has none (e.g. a Google Drive or library file Cue never saw).
   */
  take(): Attachment[] | null {
    const used = new Map<string, number>();
    const out: Attachment[] = [];
    for (const name of this.adapter.getAttachmentNames()) {
      const i = used.get(name) ?? 0;
      const copy = this.captured.get(name)?.[i];
      if (!copy) return null;
      used.set(name, i + 1);
      out.push(copy);
    }
    return out;
  }

  private onPaste = (e: ClipboardEvent): void => {
    if (!this.inComposer(e.target)) return;
    const data = e.clipboardData;
    if (!data) return;
    if (data.files.length > 0) {
      this.capture([...data.files].map((file) => ({ kind: 'file', file })));
      return;
    }
    const text = data.getData('text/plain');
    if (text.length >= MIN_TEXT_ATTACHMENT) this.capture([{ kind: 'text', text }]);
  };

  private onDrop = (e: DragEvent): void => {
    const files = e.dataTransfer?.files;
    if (files?.length) this.capture([...files].map((file) => ({ kind: 'file', file })));
  };

  private onChange = (e: Event): void => {
    const input = e.target;
    if (!(input instanceof HTMLInputElement) || input.type !== 'file') return;
    if (!this.inComposer(input) || !input.files?.length) return;
    this.capture([...input.files].map((file) => ({ kind: 'file', file })));
  };

  /** Drop the copy behind a chip when the user removes that chip. */
  private onClick = (e: MouseEvent): void => {
    const target = e.target;
    if (!(target instanceof Element)) return;
    const removed = this.adapter.removedAttachment(target);
    if (removed) this.captured.get(removed.name)?.splice(removed.index, 1);
  };

  private inComposer(target: EventTarget | null): boolean {
    const anchor = this.adapter.getComposerAnchor();
    return !!anchor && target instanceof Node && anchor.contains(target);
  }

  private capture(items: Attachment[]): void {
    // An empty composer means earlier copies were sent or discarded — unless a
    // capture is still pending, whose chip the site may not have rendered yet.
    if (this.reconcileTimer === null && this.adapter.getAttachmentNames().length === 0) {
      this.captured.clear();
    }
    for (const item of items) {
      const name = this.adapter.attachmentName(item);
      const list = this.captured.get(name) ?? [];
      list.push(item);
      this.captured.set(name, list);
    }
    if (this.reconcileTimer !== null) window.clearTimeout(this.reconcileTimer);
    this.reconcileTimer = window.setTimeout(() => this.reconcile(), RECONCILE_MS);
  }

  /**
   * Trim copies that never became chips — a short paste that stayed inline, a
   * file the site rejected — so counts line up with the chips again.
   */
  private reconcile(): void {
    this.reconcileTimer = null;
    const counts = new Map<string, number>();
    for (const name of this.adapter.getAttachmentNames()) {
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
    for (const [name, list] of this.captured) {
      const keep = counts.get(name) ?? 0;
      if (keep === 0) this.captured.delete(name);
      else if (list.length > keep) list.splice(keep);
    }
  }
}
