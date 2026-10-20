import type { SiteAdapter } from './adapters/types';
import type { Attachment } from './attachments';
import type { Queue, QueueItem } from './queue';

export type EngineState =
  | 'idle' // nothing queued, nothing happening
  | 'waiting' // queued, waiting out the post-response delay
  | 'sending' // injecting + submitting a prompt
  | 'generating' // model is responding
  | 'paused' // auto-send turned off by the user
  | 'held' // the composer has the user's own draft/attachment; waiting for it to clear
  | 'error'; // last send failed; auto-send halted

export interface EngineStatus {
  state: EngineState;
  running: boolean;
  delayMs: number;
  error?: string;
  /** Why auto-send is held (state 'held'). */
  hold?: string;
}

type StatusListener = (status: EngineStatus) => void;

const TICK_MS = 250;
const SUBMIT_TIMEOUT_MS = 4000;
const SUBMIT_POLL_MS = 150;
const SEND_CONFIRM_TIMEOUT_MS = 8000;
const SEND_CONFIRM_POLL_MS = 150;
const ATTACH_TIMEOUT_MS = 120000;
const ATTACH_POLL_MS = 250;

/**
 * Drives the queue: when the page is idle and items are pending, it waits a
 * configurable delay, injects the next prompt, submits it, and confirms the
 * send before moving on. A single polling tick (cheap, ~600ms) reads the
 * adapter's generation state — more robust than trying to diff streaming text.
 */
export class Engine {
  private running = true;
  private state: EngineState = 'idle';
  private delayMs = 400;
  private error?: string;
  private hold?: string;

  private timer: number | null = null;
  private sending = false;
  private idleSince = 0;

  private listeners = new Set<StatusListener>();

  constructor(
    private readonly adapter: SiteAdapter,
    private readonly queue: Queue,
  ) {}

  start(): void {
    if (this.timer !== null) return;
    this.timer = window.setInterval(() => void this.tick(), TICK_MS);
  }

  stop(): void {
    if (this.timer !== null) {
      window.clearInterval(this.timer);
      this.timer = null;
    }
  }

  setRunning(running: boolean): void {
    this.running = running;
    if (running) {
      this.error = undefined;
      this.idleSince = 0;
    }
    this.recompute();
  }

  get isRunning(): boolean {
    return this.running;
  }

  setDelay(ms: number): void {
    this.delayMs = Math.max(0, ms);
    this.emit();
  }

  subscribe(fn: StatusListener): () => void {
    this.listeners.add(fn);
    fn(this.snapshot());
    return () => this.listeners.delete(fn);
  }

  private snapshot(): EngineStatus {
    return {
      state: this.state,
      running: this.running,
      delayMs: this.delayMs,
      error: this.error,
      hold: this.hold,
    };
  }

  private setState(state: EngineState, hold?: string): void {
    if (this.state === state && this.hold === hold) return;
    this.state = state;
    this.hold = hold;
    this.emit();
  }

  private emit(): void {
    const s = this.snapshot();
    for (const fn of this.listeners) fn(s);
  }

  /** Recompute a resting state when not mid-send (e.g. after pause/resume). */
  private recompute(): void {
    if (this.sending) return;
    if (this.adapter.isGenerating()) this.setState('generating');
    else if (!this.running) this.setState('paused');
    else if (this.queue.size === 0) this.setState('idle');
    else this.setState('waiting');
  }

  private async tick(): Promise<void> {
    if (this.sending) return;

    if (this.adapter.isGenerating()) {
      this.idleSince = 0;
      this.setState('generating');
      return;
    }

    // Page is idle. Start the cooldown clock the moment we first observe idle.
    if (this.idleSince === 0) this.idleSince = Date.now();

    if (this.state === 'error') return; // halted until user resumes
    if (!this.running) {
      this.setState('paused');
      return;
    }
    if (this.queue.size === 0) {
      this.setState('idle');
      return;
    }
    if (Date.now() - this.idleSince < this.delayMs) {
      this.setState('waiting');
      return;
    }

    // Sending replaces the composer's content, so never do it over something
    // the user put there. Resumes on its own once the composer is clear.
    const hold = this.composerHold();
    if (hold) {
      this.setState('held', hold);
      return;
    }

    await this.sendNext();
  }

  /**
   * Reason the composer can't be used for the next send, if any: an attachment
   * would go out with the queued prompt, and text would be overwritten. Text
   * and attachments that already match the next item (left by a failed send)
   * are fine.
   */
  private composerHold(): string | undefined {
    const next = this.queue.peek();
    if (this.adapter.hasAttachments() && !(next && this.hasAttachmentsOf(next))) {
      return 'Waiting: send or remove the attachment in the composer.';
    }
    const draft = collapseWs(this.adapter.getText());
    if (draft && (!next || draft !== collapseWs(next.text))) {
      return 'Waiting: send or clear your draft in the composer.';
    }
    return undefined;
  }

  /** True if the composer's chips are exactly `item`'s attachments. */
  private hasAttachmentsOf(item: QueueItem): boolean {
    const want = item.attachments ?? [];
    const have = this.adapter.getAttachmentNames();
    return want.length === have.length && want.every((name, i) => name === have[i]);
  }

  private async sendNext(): Promise<void> {
    const item = this.queue.peek();
    if (!item) return;

    // Never send a prompt without the attachments it was queued with.
    const attachments = this.queue.attachmentsFor(item);
    if (attachments === null) {
      return this.fail('Attachments for the next prompt were lost when the page reloaded. Remove it or queue it again.');
    }

    this.sending = true;
    this.setState('sending');

    try {
      if (!item.text) {
        this.adapter.clearInput(); // attachments-only prompt
      } else if (!this.adapter.setText(item.text)) {
        return this.fail('Could not inject prompt text into the composer.');
      }
      if (attachments.length > 0 && !(await this.attachAll(item, attachments))) {
        return this.fail('Attachments never finished uploading, so the prompt was not sent.');
      }
      if (!(await this.deliver(item.text))) {
        return this.fail('Send button never became available.');
      }

      const sent = await this.confirmSent();
      if (!sent) {
        return this.fail('Sent the prompt but never saw it leave the composer.');
      }

      // Success — drop the item and reset the cooldown so we wait for the
      // response to start/finish before considering the next prompt.
      this.queue.shift();
      this.idleSince = 0;
      this.error = undefined;
      this.setState('generating');
    } finally {
      this.sending = false;
    }
  }

  /**
   * Re-attach `item`'s attachments (unless a failed send already left them in
   * the composer) and wait until every chip is there and done uploading.
   */
  private async attachAll(item: QueueItem, attachments: Attachment[]): Promise<boolean> {
    if (!this.hasAttachmentsOf(item)) {
      this.adapter.clearAttachments();
      for (const a of attachments) this.adapter.attach(a);
    }
    const deadline = Date.now() + ATTACH_TIMEOUT_MS;
    while (Date.now() < deadline) {
      await delay(ATTACH_POLL_MS);
      if (this.hasAttachmentsOf(item) && !this.adapter.isUploading()) return true;
    }
    return false;
  }

  /**
   * Click send, retrying until it succeeds. Right after a response ends there's
   * a brief window where ChatGPT hasn't mounted an enabled send button yet, so a
   * single attempt is racy. We poll up to SUBMIT_TIMEOUT_MS, re-injecting the
   * text if the composer dropped it during a re-render.
   */
  private async deliver(text: string): Promise<boolean> {
    const deadline = Date.now() + SUBMIT_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (collapseWs(this.adapter.getText()) !== collapseWs(text)) {
        this.adapter.setText(text);
        await delay(60);
      }
      if (this.adapter.submit()) return true;
      await delay(SUBMIT_POLL_MS);
    }
    return false;
  }

  /**
   * A send is confirmed when the composer empties (ChatGPT clears the text and
   * chips on submit) or the model visibly starts generating, whichever comes
   * first.
   */
  private async confirmSent(): Promise<boolean> {
    const deadline = Date.now() + SEND_CONFIRM_TIMEOUT_MS;
    while (Date.now() < deadline) {
      const editor = this.adapter.getEditor();
      const empty =
        (editor?.textContent ?? '').trim() === '' && !this.adapter.hasAttachments();
      if (empty || this.adapter.isGenerating()) return true;
      await delay(SEND_CONFIRM_POLL_MS);
    }
    return false;
  }

  private fail(message: string): void {
    this.error = message;
    this.running = false;
    this.setState('error');
  }
}

function collapseWs(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
