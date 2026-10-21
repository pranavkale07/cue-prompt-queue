/**
 * Decides which tab sends a conversation's queue. Every tab open on the same
 * conversation shares its stored queue, but only one may send from it:
 * ChatGPT doesn't show a reply streaming in one tab in the others, so a second
 * tab would see its page idle and send the same prompt again.
 *
 * Uses a Web Lock named after the queue's storage key (Web Locks are shared by
 * every tab of the origin). The first tab to ask holds it; the rest wait in
 * line and take over when that tab closes, reloads or leaves the conversation.
 */
export class DriverLock {
  private name: string | null = null;
  private held = false;
  private release: (() => void) | null = null;
  private abort: AbortController | null = null;

  constructor(private readonly onChange: (held: boolean) => void) {}

  get isHeld(): boolean {
    return this.held;
  }

  /** Hold (or line up for) the lock for `key`, giving up any other one. */
  acquire(key: string): void {
    const name = `cue:send:${key}`;
    if (name === this.name) return;
    this.drop();
    this.name = name;
    if (!navigator.locks) {
      this.set(true); // no Web Locks: behave as before, every tab sends
      return;
    }
    const abort = new AbortController();
    this.abort = abort;
    navigator.locks
      .request(name, { signal: abort.signal }, () =>
        new Promise<void>((resolve) => {
          if (this.name !== name) return resolve(); // granted just as we moved on
          this.release = resolve;
          this.set(true);
        }),
      )
      .catch(() => {
        // Aborted while waiting in line: we moved on to another conversation.
      });
  }

  private drop(): void {
    this.abort?.abort();
    this.release?.();
    this.abort = null;
    this.release = null;
    this.name = null;
    this.set(false);
  }

  private set(held: boolean): void {
    if (this.held === held) return;
    this.held = held;
    this.onChange(held);
  }
}
