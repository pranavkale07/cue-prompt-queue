import type { SiteAdapter } from './adapters/types';
import type { Queue } from './queue';

export type EngineState =
  | 'idle' // nothing queued, nothing happening
  | 'waiting' // queued, waiting out the post-response delay
  | 'sending' // injecting + submitting a prompt
  | 'generating' // model is responding
  | 'paused' // auto-send turned off by the user
  | 'error'; // last send failed; auto-send halted

export interface EngineStatus {
  state: EngineState;
  running: boolean;
  delayMs: number;
  error?: string;
}

type StatusListener = (status: EngineStatus) => void;

const TICK_MS = 250;
const SUBMIT_TIMEOUT_MS = 4000;
const SUBMIT_POLL_MS = 150;
const SEND_CONFIRM_TIMEOUT_MS = 8000;
const SEND_CONFIRM_POLL_MS = 150;

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
    };
  }

  private setState(state: EngineState): void {
    if (this.state === state) return;
    this.state = state;
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

    await this.sendNext();
  }

  private async sendNext(): Promise<void> {
    const item = this.queue.peek();
    if (!item) return;

    this.sending = true;
    this.setState('sending');

    try {
      if (!this.adapter.setText(item.text)) {
        return this.fail('Could not inject prompt text into the composer.');
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
   * Click send, retrying until it succeeds. Right after a response ends there's
   * a brief window where ChatGPT hasn't mounted an enabled send button yet, so a
   * single attempt is racy. We poll up to SUBMIT_TIMEOUT_MS, re-injecting the
   * text if the composer dropped it during a re-render.
   */
  private async deliver(text: string): Promise<boolean> {
    const deadline = Date.now() + SUBMIT_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (this.adapter.getText().trim() !== text.trim()) {
        this.adapter.setText(text);
        await delay(60);
      }
      if (this.adapter.submit()) return true;
      await delay(SUBMIT_POLL_MS);
    }
    return false;
  }

  /**
   * A send is confirmed when the composer empties (ChatGPT clears it on submit)
   * or the model visibly starts generating, whichever comes first.
   */
  private async confirmSent(): Promise<boolean> {
    const deadline = Date.now() + SEND_CONFIRM_TIMEOUT_MS;
    while (Date.now() < deadline) {
      const editor = this.adapter.getEditor();
      const empty = (editor?.textContent ?? '').trim() === '';
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

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
