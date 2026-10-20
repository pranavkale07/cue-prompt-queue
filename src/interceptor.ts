import type { SiteAdapter } from './adapters/types';
import type { Queue } from './queue';

const BTN_ID = 'gpt-queue-add-btn';
const REINJECT_MS = 1000;
const ATTACHMENT_NOTICE =
  "Attachments can't be queued. Use \"Show in text field\" for pasted text, or send it directly.";

/**
 * Bridges the host page's native composer to our queue:
 *
 *  1. Enter interception (capture phase): while the model is generating,
 *     pressing Enter in the composer adds the current text to the queue and
 *     clears the input, instead of doing nothing. When idle, Enter is left
 *     untouched so normal sending still works.
 *
 *  2. An injected "Queue" button in the composer's trailing action area that
 *     adds the current input to the queue in any state — for stacking several
 *     prompts up front. It is re-injected if the site re-renders the composer.
 *
 * Attachments (images, files, long pastes turned into files) live outside the
 * text input, so they can't be queued. Rather than queue only the text and
 * leave the attachment behind to go out with some other prompt, both paths
 * refuse and show a notice.
 */
export class Interceptor {
  private observer: MutationObserver | null = null;
  private reinjectTimer: number | null = null;

  constructor(
    private readonly adapter: SiteAdapter,
    private readonly queue: Queue,
    private readonly notify: (message: string) => void,
  ) {}

  install(): void {
    document.addEventListener('keydown', this.onKeydown, true);
    this.ensureButton();
    // Re-inject the button whenever the composer subtree changes, plus a slow
    // interval as a backstop for renders the observer might miss.
    this.observer = new MutationObserver(() => this.ensureButton());
    this.observer.observe(document.body, { childList: true, subtree: true });
    this.reinjectTimer = window.setInterval(() => this.ensureButton(), REINJECT_MS);
  }

  private onKeydown = (e: KeyboardEvent): void => {
    if (e.key !== 'Enter' || e.shiftKey || e.isComposing) return;

    const editor = this.adapter.getEditor();
    const target = e.target as Node | null;
    if (!editor || !target || !editor.contains(target)) return;

    // Idle → let ChatGPT send normally. Busy → capture into the queue.
    if (!this.adapter.isGenerating()) return;

    // Swallow Enter either way: there's nothing for ChatGPT to do with it
    // while it's generating.
    e.preventDefault();
    e.stopImmediatePropagation();
    this.queueCurrent();
  };

  private queueCurrent(): void {
    if (this.adapter.hasAttachments()) {
      this.notify(ATTACHMENT_NOTICE);
      return;
    }
    const text = this.adapter.getText();
    if (!text.trim()) return;
    this.queue.add(text);
    this.adapter.clearInput();
  }

  private ensureButton(): void {
    if (document.getElementById(BTN_ID)) return;
    const container = this.adapter.getActionsContainer();
    if (!container) return;

    const btn = document.createElement('button');
    btn.id = BTN_ID;
    btn.type = 'button';
    btn.title = 'Add this prompt to the queue';
    btn.setAttribute('aria-label', 'Add to queue');
    // Mimic ChatGPT's round composer buttons without depending on its classes.
    Object.assign(btn.style, {
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      width: '36px',
      height: '36px',
      borderRadius: '9999px',
      border: 'none',
      cursor: 'pointer',
      background: 'transparent',
      color: 'currentColor',
      opacity: '0.7',
    } satisfies Partial<CSSStyleDeclaration>);
    btn.addEventListener('mouseenter', () => (btn.style.opacity = '1'));
    btn.addEventListener('mouseleave', () => (btn.style.opacity = '0.7'));
    // List-with-plus glyph: rows of a list plus a "+", reading as "add to queue".
    btn.innerHTML =
      '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" ' +
      'stroke="currentColor" stroke-width="2" stroke-linecap="round" ' +
      'stroke-linejoin="round"><path d="M16 6H3"/><path d="M11 12H3"/>' +
      '<path d="M11 18H3"/><path d="M18 9v6"/><path d="M21 12h-6"/></svg>';
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.queueCurrent();
    });

    container.insertBefore(btn, container.firstChild);
  }

  uninstall(): void {
    document.removeEventListener('keydown', this.onKeydown, true);
    this.observer?.disconnect();
    if (this.reinjectTimer !== null) window.clearInterval(this.reinjectTimer);
    document.getElementById(BTN_ID)?.remove();
  }
}
