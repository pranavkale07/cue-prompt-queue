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
  | 'standby' // another tab is sending this conversation's queue
  | 'error'; // last send failed or the site showed an error; auto-send halted

export interface EngineStatus {
  state: EngineState;
  running: boolean;
  delayMs: number;
  error?: string;
  /** Why auto-send isn't sending (states 'held', 'standby', and 'paused' after Stop). */
  notice?: string;
}

type StatusListener = (status: EngineStatus) => void;

const TICK_MS = 250;
const SUBMIT_TIMEOUT_MS = 4000;
const SUBMIT_POLL_MS = 150;
const SEND_CONFIRM_TIMEOUT_MS = 8000;
const SEND_CONFIRM_POLL_MS = 150;
const ATTACH_TIMEOUT_MS = 120000;
const ATTACH_POLL_MS = 250;
// After a send, how long to wait for the reply to visibly start before
// treating the page as idle again.
const RESPONSE_START_TIMEOUT_MS = 15000;

const STOPPED_NOTICE = 'You stopped the reply, so auto-send is paused. Press ▶ to continue.';
// The other tab holds the queue even while paused there (see DriverLock).
const STANDBY_NOTICE = 'Another tab with this chat open sends its queue. Close it to send from here.';

/**
 * Drives the queue: when the page is idle and items are pending, it waits a
 * configurable delay, injects the next prompt, submits it, and confirms the
 * send before moving on. A single polling tick (cheap, every 250ms) reads the
 * adapter's generation state — more robust than trying to diff streaming text.
 *
 * Only the tab holding the conversation's DriverLock sends (setDriver); other
 * tabs on the same conversation stand by.
 */
export class Engine {
  private running = true;
  private state: EngineState = 'idle';
  private delayMs = 400;
  private error?: string;
  private notice?: string;
  private pauseNotice?: string;
  private driver = false;

  private timer: number | null = null;
  private sending = false;
  private idleSince = 0;
  // When the last send went out, until the reply is seen generating.
  private awaitingSince = 0;
  // A site error the user chose to resume past.
  private ackedError: string | null = null;

  private listeners = new Set<StatusListener>();

  constructor(
    private readonly adapter: SiteAdapter,
    private readonly queue: Queue,
    /** Called after each prompt the engine sends. */
    private readonly onSend: () => void = () => {},
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
    this.pauseNotice = undefined;
    if (running) {
      if (this.state === 'error') this.state = 'idle'; // leave the halt; recompute settles the rest
      this.error = undefined;
      this.idleSince = 0;
      // Resuming over an error the site still shows means "send anyway".
      this.ackedError = this.adapter.responseError();
    }
    this.recompute();
    this.emit(); // `running` changed even if the state didn't (e.g. mid-reply)
  }

  /**
   * The user stopped a reply. They usually do that because it went wrong, so
   * don't follow it with the next prompt: pause until they resume.
   */
  pauseForStop(): void {
    if (!this.running || this.queue.size === 0) return;
    this.running = false;
    this.pauseNotice = STOPPED_NOTICE;
    this.recompute();
    this.emit();
  }

  /** Whether this tab may send the current conversation's queue. */
  setDriver(driver: boolean): void {
    this.driver = driver;
    this.idleSince = 0;
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
      notice: this.notice,
    };
  }

  private setState(state: EngineState, notice?: string): void {
    if (this.state === state && this.notice === notice) return;
    this.state = state;
    this.notice = notice;
    this.emit();
  }

  private emit(): void {
    const s = this.snapshot();
    for (const fn of this.listeners) fn(s);
  }

  /** Recompute a resting state when not mid-send (e.g. after pause/resume). */
  private recompute(): void {
    if (this.sending || this.state === 'error') return;
    if (this.adapter.isGenerating()) this.setState('generating');
    else if (!this.running) this.setState('paused', this.pauseNotice);
    else if (this.queue.size === 0) this.setState('idle');
    else if (!this.driver) this.setState('standby', STANDBY_NOTICE);
    else this.setState('waiting');
  }

  private async tick(): Promise<void> {
    if (this.sending) return;
    // Halted until the user resumes. Checked first so the error stays on
    // screen even if the user sends something by hand meanwhile.
    if (this.state === 'error') return;

    if (this.adapter.isGenerating()) {
      this.idleSince = 0;
      this.awaitingSince = 0;
      this.setState('generating');
      return;
    }

    // Just sent: the reply may not have visibly started yet (the Stop button
    // can lag the send). Don't mistake that gap for the reply being over.
    if (this.awaitingSince !== 0) {
      if (this.siteError()) return this.failOnSiteError();
      if (Date.now() - this.awaitingSince < RESPONSE_START_TIMEOUT_MS) {
        this.setState('generating');
        return;
      }
      this.awaitingSince = 0;
    }

    // Page is idle. Start the cooldown clock the moment we first observe idle.
    if (this.idleSince === 0) this.idleSince = Date.now();

    if (!this.running) {
      this.setState('paused', this.pauseNotice);
      return;
    }
    if (this.queue.size === 0) {
      this.setState('idle');
      return;
    }
    if (!this.driver) {
      this.setState('standby', STANDBY_NOTICE);
      return;
    }
    // The page moved to another conversation and its queue isn't loaded yet.
    if (this.queue.conversationId !== this.adapter.getConversationId()) return;
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

    // The last reply failed (or a usage limit hit): sending more would only
    // pile prompts onto a broken conversation.
    if (this.siteError()) return this.failOnSiteError();

    await this.sendNext();
  }

  /** An error the site shows for the latest turn, unless the user resumed past it. */
  private siteError(): string | null {
    const err = this.adapter.responseError();
    return err !== null && err !== this.ackedError ? err : null;
  }

  private failOnSiteError(): void {
    this.awaitingSince = 0;
    this.fail(`ChatGPT showed an error, so auto-send stopped: "${this.siteError()}"`);
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
    // If the user opens another conversation mid-send, the prompt must not go
    // out there; and once sent, it's removed from the queue it came from.
    const key = this.queue.storageKey;
    const conv = this.adapter.getConversationId();
    const stillHere = () => this.adapter.getConversationId() === conv;

    try {
      if (!item.text) {
        this.adapter.clearInput(); // attachments-only prompt
      } else if (!this.adapter.setText(item.text)) {
        return this.fail('Could not inject prompt text into the composer.');
      }
      if (attachments.length > 0 && !(await this.attachAll(item, attachments, stillHere))) {
        if (!stillHere()) return this.abandon(item);
        return this.fail('Attachments never finished uploading, so the prompt was not sent.');
      }
      if (!stillHere()) return this.abandon(item);
      if (!(await this.deliver(item.text, stillHere))) {
        if (!stillHere()) return this.abandon(item);
        return this.fail('Send button never became available.');
      }

      const sent = await this.confirmSent();
      if (!sent) {
        return this.fail('Sent the prompt but never saw it leave the composer.');
      }

      // Success — drop the item and wait for the reply to start (and then
      // finish) before considering the next prompt.
      await this.queue.removeSent(item.id, key);
      this.idleSince = 0;
      this.awaitingSince = Date.now();
      this.ackedError = null;
      this.error = undefined;
      this.onSend();
      this.setState('generating');
    } finally {
      this.sending = false;
    }
  }

  /**
   * The user left the conversation before the prompt went out. Take back what
   * we put in the composer and keep the item queued in its own conversation.
   */
  private abandon(item: QueueItem): void {
    if (collapseWs(this.adapter.getText()) === collapseWs(item.text)) this.adapter.clearInput();
    if (this.hasAttachmentsOf(item)) this.adapter.clearAttachments();
    this.idleSince = 0;
    this.setState('idle');
  }

  /**
   * Re-attach `item`'s attachments (unless a failed send already left them in
   * the composer) and wait until every chip is there and done uploading.
   */
  private async attachAll(
    item: QueueItem,
    attachments: Attachment[],
    stillHere: () => boolean,
  ): Promise<boolean> {
    if (!this.hasAttachmentsOf(item)) {
      this.adapter.clearAttachments();
      for (const a of attachments) this.adapter.attach(a);
    }
    const deadline = Date.now() + ATTACH_TIMEOUT_MS;
    while (Date.now() < deadline && stillHere()) {
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
  private async deliver(text: string, stillHere: () => boolean): Promise<boolean> {
    const deadline = Date.now() + SUBMIT_TIMEOUT_MS;
    while (Date.now() < deadline && stillHere()) {
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
