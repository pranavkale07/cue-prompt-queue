import type { SiteAdapter } from './adapters/types';
import type { AttachmentTracker } from './attachments';
import type { Queue } from './queue';

const BTN_ID = 'gpt-queue-add-btn';
const REINJECT_MS = 1000;
const ATTACHMENT_NOTICE =
  "This attachment can't be queued (Cue only queues files you paste, drop or pick). Send it directly.";
const UPLOADING_NOTICE = 'Wait for the attachment to finish uploading, then queue.';
const STANDBY_ATTACHMENT_NOTICE =
  'Another tab with this chat open sends its queue. Queue attachments from that tab, or send this one directly.';

export interface InterceptorHooks {
  /** Show a short notice in the dock. */
  notify(message: string): void;
  /** The user pressed the site's Stop button. */
  onUserStop(): void;
  /** The user sent something themselves (Enter while idle, or the Send button). */
  onUserSend(): void;
  /** Whether Enter queues while the model is generating (a setting). */
  enterQueues(): boolean;
  /**
   * Whether attachments can be queued here. Their data lives only in this
   * tab, so only the tab that sends the queue can take them.
   */
  canQueueAttachments(): boolean;
}

/**
 * Bridges the host page's native composer to our queue:
 *
 *  1. Enter interception (capture phase): while the model is generating,
 *     pressing Enter in the composer adds the current text to the queue and
 *     clears the input, instead of doing nothing. When idle, Enter is left
 *     untouched so normal sending still works. Can be turned off in settings.
 *
 *  2. An injected "Queue" button in the composer's trailing action area that
 *     adds the current input to the queue in any state — for stacking several
 *     prompts up front. It is re-injected if the site re-renders the composer.
 *
 * Attachments (images, files, long pastes turned into files) live outside the
 * text input. They're queued from the local copies the AttachmentTracker kept
 * when the user added them. If any chip has no copy (e.g. a Google Drive file),
 * both paths refuse and show a notice rather than queue only the text and leave
 * the attachment behind to go out with some other prompt.
 *
 * It also reports clicks on the site's Stop and Send buttons, so the engine
 * can pause after a stopped reply and the conversation watcher can tell a
 * send from plain navigation.
 */
export class Interceptor {
  private observer: MutationObserver | null = null;
  private reinjectTimer: number | null = null;

  constructor(
    private readonly adapter: SiteAdapter,
    private readonly queue: Queue,
    private readonly attachments: AttachmentTracker,
    private readonly hooks: InterceptorHooks,
  ) {}

  install(): void {
    document.addEventListener('keydown', this.onKeydown, true);
    document.addEventListener('click', this.onClick, true);
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
    if (!this.adapter.isGenerating()) {
      if (this.adapter.getText().trim() || this.adapter.hasAttachments()) this.hooks.onUserSend();
      return;
    }
    if (!this.hooks.enterQueues()) return;

    // Swallow Enter either way: there's nothing for ChatGPT to do with it
    // while it's generating.
    e.preventDefault();
    e.stopImmediatePropagation();
    this.queueCurrent();
  };

  private onClick = (e: MouseEvent): void => {
    const target = e.target;
    if (!(target instanceof Element)) return;
    if (this.adapter.isStopControl(target)) this.hooks.onUserStop();
    else if (this.adapter.isSendControl(target)) this.hooks.onUserSend();
  };

  private queueCurrent(): void {
    // Removing a half-uploaded chip mid-upload is racy; let it settle first.
    if (this.adapter.isUploading()) {
      this.hooks.notify(UPLOADING_NOTICE);
      return;
    }
    const attachments = this.attachments.take();
    if (attachments === null) {
      this.hooks.notify(ATTACHMENT_NOTICE);
      return;
    }
    if (attachments.length > 0 && !this.hooks.canQueueAttachments()) {
      this.hooks.notify(STANDBY_ATTACHMENT_NOTICE);
      return;
    }
    const text = this.adapter.getText();
    if (!text.trim() && attachments.length === 0) return;
    const names = attachments.map((a) => this.adapter.attachmentName(a));
    this.queue.add(text, attachments, names);
    this.adapter.clearInput();
    this.adapter.clearAttachments();
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
    document.removeEventListener('click', this.onClick, true);
    this.observer?.disconnect();
    if (this.reinjectTimer !== null) window.clearInterval(this.reinjectTimer);
    document.getElementById(BTN_ID)?.remove();
  }
}
