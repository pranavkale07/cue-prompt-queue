import { ChatGptAdapter } from './adapters/chatgpt';
import { Queue } from './queue';
import { Engine } from './engine';
import { Dock } from './panel';
import { Interceptor } from './interceptor';
import { loadSettings, onSettingsChanged } from './settings';

const CONV_WATCH_MS = 700;

async function main(): Promise<void> {
  const adapter = new ChatGptAdapter();
  if (!adapter.matches()) return;

  // Wait for the composer to mount before wiring anything up.
  const ready = await waitFor(() => adapter.isReady(), 20000);

  const queue = new Queue();
  await queue.load(adapter.getConversationId());

  const engine = new Engine(adapter, queue);

  // Apply saved settings, and keep reacting to changes made in the popup.
  const settings = await loadSettings();
  engine.setDelay(settings.autoSendDelayMs);
  if (settings.startPaused) engine.setRunning(false);
  onSettingsChanged((s) => engine.setDelay(s.autoSendDelayMs));

  const dock = new Dock(adapter, queue, engine);
  await dock.mount();

  // DOM-drift guard: if ChatGPT's composer never appeared, the selectors have
  // likely changed. Surface it visibly instead of running blind, and stop.
  if (!ready) {
    console.error('[Cue] composer not found; selectors:', adapter.selfCheck());
    dock.showFatal("Couldn't find ChatGPT's input. Try reloading; the extension may need an update.");
    return;
  }

  const interceptor = new Interceptor(adapter, queue, (msg) => dock.flash(msg));
  interceptor.install();

  engine.start();
  watchConversation(adapter, queue);
}

/**
 * ChatGPT is a SPA: the URL changes without a reload. Watch for it and keep the
 * queue scoped to the right conversation.
 *  - "new" → real id (first message sent): carry the in-memory queue over.
 *  - any other change: load that conversation's own stored queue.
 */
function watchConversation(adapter: ChatGptAdapter, queue: Queue): void {
  let current = adapter.getConversationId();
  window.setInterval(() => {
    const next = adapter.getConversationId();
    if (next === current) return;
    const wasNew = current === 'new';
    current = next;
    if (wasNew && next !== 'new') {
      void queue.rekey(next);
    } else {
      void queue.load(next);
    }
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
