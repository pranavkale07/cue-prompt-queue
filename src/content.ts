import { ChatGptAdapter } from './adapters/chatgpt';
import { Queue } from './queue';
import { Engine } from './engine';
import { Dock } from './panel';
import { Interceptor } from './interceptor';
import { AttachmentTracker } from './attachments';
import { DriverLock } from './lock';
import { loadSettings, onSettingsChanged } from './settings';

const CONV_WATCH_MS = 700;
// A new chat gets its id within a second or two of its first send. A change
// from "new" to an id any later than this is the user opening another chat.
const NEW_CHAT_SEND_WINDOW_MS = 15000;

/** The latest send in this tab, by the engine or the user. */
interface LastSend {
  conv: string;
  at: number;
}

async function main(): Promise<void> {
  const adapter = new ChatGptAdapter();
  if (!adapter.matches()) return;

  // Wait for the composer to mount before wiring anything up.
  const ready = await waitFor(() => adapter.isReady(), 20000);

  const queue = new Queue();
  await queue.load(adapter.getConversationId());

  const lastSend: LastSend = { conv: '', at: 0 };
  const noteSend = () => {
    lastSend.conv = adapter.getConversationId();
    lastSend.at = Date.now();
  };

  const engine = new Engine(adapter, queue, noteSend);
  const lock = new DriverLock((held) => engine.setDriver(held));
  lock.acquire(queue.storageKey);

  // Apply saved settings, and keep reacting to changes made in the popup.
  let settings = await loadSettings();
  engine.setDelay(settings.autoSendDelayMs);
  if (settings.startPaused) engine.setRunning(false);
  onSettingsChanged((s) => {
    settings = s;
    engine.setDelay(s.autoSendDelayMs);
  });

  const dock = new Dock(adapter, queue, engine);
  await dock.mount();

  // DOM-drift guard: if ChatGPT's composer never appeared, the selectors have
  // likely changed. Surface it visibly instead of running blind, and stop.
  if (!ready) {
    console.error('[Cue] composer not found; selectors:', adapter.selfCheck());
    dock.showFatal("Couldn't find ChatGPT's input. Try reloading; the extension may need an update.");
    return;
  }

  const attachments = new AttachmentTracker(adapter);
  attachments.install();

  const interceptor = new Interceptor(adapter, queue, attachments, {
    notify: (msg) => dock.flash(msg),
    onUserStop: () => engine.pauseForStop(),
    onUserSend: noteSend,
    enterQueues: () => settings.enterToQueue,
    canQueueAttachments: () => lock.isHeld,
  });
  interceptor.install();

  engine.start();
  watchConversation(adapter, queue, lock, lastSend);
}

/**
 * ChatGPT is a SPA: the URL changes without a reload. Watch for it and keep the
 * queue scoped to the right conversation.
 *  - "new" → real id right after a send from the new chat: that chat just got
 *    its id, so carry the in-memory queue over.
 *  - any other change (including opening a saved chat from a new one): load
 *    that conversation's own stored queue.
 */
function watchConversation(
  adapter: ChatGptAdapter,
  queue: Queue,
  lock: DriverLock,
  lastSend: LastSend,
): void {
  let current = adapter.getConversationId();
  window.setInterval(() => {
    const next = adapter.getConversationId();
    if (next === current) return;
    const gotId =
      current === 'new' &&
      next !== 'new' &&
      lastSend.conv === 'new' &&
      Date.now() - lastSend.at < NEW_CHAT_SEND_WINDOW_MS;
    current = next;
    void (gotId ? queue.rekey(next) : queue.load(next)).then(() => lock.acquire(queue.storageKey));
  }, CONV_WATCH_MS);
}

function waitFor(predicate: () => boolean, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    if (predicate()) return resolve(true);
    const deadline = Date.now() + timeoutMs;
    const iv = window.setInterval(() => {
      if (predicate()) {
        window.clearInterval(iv);
        resolve(true);
      } else if (Date.now() > deadline) {
        window.clearInterval(iv);
        resolve(false);
      }
    }, 200);
  });
}

void main();
