import type { Attachment } from '../attachments';
import type { SiteAdapter } from './types';

/**
 * ChatGPT (chatgpt.com / chat.openai.com) adapter.
 *
 * Selectors verified live against chatgpt.com (October 2026 composer redesign):
 *  - Composer:    form[data-chatgpt-composer] .ProseMirror  (no id any more)
 *  - Send:        button[type=submit][aria-label="Send"]
 *  - Generating:  button[aria-label="Stop"]
 *  - Attachments: [data-composer-attachments], one "Remove <name>" button per chip
 *                 (<name> is the File's name verbatim; duplicates allowed), and
 *                 an "Uploading <name>" label while that chip uploads
 *
 * Not verified live: how a failed reply or a usage limit is rendered. The
 * error check (responseError) is a heuristic, see ERROR_STYLE_SELECTOR.
 *
 * The June 2026 selectors (#prompt-textarea, send-button / stop-button testids,
 * the grid-area:trailing slot) are kept first in each list in case ChatGPT
 * rolls back or still serves the old composer to some accounts.
 *
 * Each lookup has layered fallbacks (testid → id → data attribute → aria-label)
 * so minor UI changes degrade gracefully instead of breaking outright.
 */

function firstMatch(selectors: string[]): HTMLElement | null {
  for (const sel of selectors) {
    const el = document.querySelector<HTMLElement>(sel);
    if (el) return el;
  }
  return null;
}

const BLOCK_TAGS = new Set(['P', 'DIV', 'PRE', 'BLOCKQUOTE', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'UL', 'OL', 'LI']);

/**
 * Read the composer's text with line breaks intact. ProseMirror renders each
 * line as its own <p>, and `textContent` concatenates them with no separator,
 * so a multi-line prompt would collapse onto one line.
 */
function readText(node: Node): string {
  let out = '';
  for (const child of node.childNodes) {
    if (child.nodeType === Node.TEXT_NODE) {
      out += child.textContent ?? '';
    } else if (child instanceof HTMLElement) {
      if (child.tagName === 'BR') {
        // ProseMirror adds a placeholder <br> to empty/trailing lines; skip it.
        if (!child.classList.contains('ProseMirror-trailingBreak')) out += '\n';
      } else if (BLOCK_TAGS.has(child.tagName)) {
        if (out && !out.endsWith('\n')) out += '\n';
        const inner = child.tagName === 'PRE' ? child.textContent ?? '' : readText(child);
        out += inner;
        // An empty block is a blank line; otherwise just end the line once.
        if (inner === '' || !out.endsWith('\n')) out += '\n';
      } else {
        out += readText(child);
      }
    }
  }
  return out;
}

function collapseWs(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

const EDITOR_SELECTORS = [
  '#prompt-textarea',
  'form[data-chatgpt-composer] .ProseMirror[contenteditable="true"]',
  'main form div[contenteditable="true"]',
];

const SEND_SELECTORS = [
  '[data-testid="send-button"]',
  '#composer-submit-button',
  'button[aria-label="Send prompt"]',
  'form[data-chatgpt-composer] button[type="submit"][aria-label="Send"]',
  'form button[aria-label="Send"]',
];

const STOP_SELECTORS = [
  '[data-testid="stop-button"]',
  'button[aria-label="Stop answering"]',
  'form button[aria-label="Stop"]',
  'form button[aria-label*="Stop" i]',
];
// Clicking one of these pauses auto-send, so match the stop-generating button
// exactly: the loose last selector above could also hit e.g. a dictation stop.
const STOP_CONTROL_SELECTOR = STOP_SELECTORS.slice(0, 3).join(', ');

// Old composer: a named CSS grid whose trailing area holds the dictation/voice
// and send/stop buttons and stays mounted across state changes.
const TRAILING_SELECTORS = [
  'form div[class*="grid-area:trailing"]',
  'div[class*="grid-area:trailing"]',
];

// New composer: the footer's last column holds Think / Dictate / Send. Its
// first flex row is where those buttons sit side by side.
const FOOTER_SELECTORS = [
  'form[data-chatgpt-composer] [data-composer-footer-responsive]',
  '[data-composer-footer-responsive]',
];

// The composer <form> — matches the visible rounded input box's width/position.
const ANCHOR_SELECTORS = [
  'form[data-chatgpt-composer]',
  'form[class*="composer"]',
];

// Pasted-text chips (long pastes), images and files all render here, each with
// a "Remove <name>" button. The container stays mounted when empty.
const ATTACHMENT_SELECTORS = [
  '[data-composer-attachments] button[aria-label^="Remove" i]',
  '[data-composer-attachments][data-visible-attachments]',
];

const CHIP_REMOVE_SELECTOR = '[data-composer-attachments] button[aria-label^="Remove "]';

// A long paste becomes a chip with this name instead of inline text.
const PASTED_TEXT_NAME = 'pasted text attachment';

// Error notices for a turn ("Something went wrong…", a usage limit) are styled
// red; the model's own prose never is. Scoped to what follows the latest user
// message, so an old error that was retried past doesn't count.
const ERROR_STYLE_SELECTOR = [
  '[class*="text-token-text-error"]',
  '[class*="border-red-500"]',
  '[class*="text-red-500"]',
  '[class*="text-red-600"]',
].join(', ');
const ERROR_TEXT = [
  /something went wrong/i,
  /network error/i,
  /error in (the )?message stream/i,
  /too many requests/i,
  /\b(hit|reached)\b.{0,40}\blimit\b/i,
];
// Text that is conversation content, not site UI: replies, user messages and
// the composer. Errors are never looked for in here.
const CONTENT_SELECTOR = '.markdown, [data-message-author-role="user"], [contenteditable="true"]';
const USER_MESSAGE_SELECTOR = '[data-message-author-role="user"]';
const MAX_ERROR_LENGTH = 160;

export class ChatGptAdapter implements SiteAdapter {
  readonly name = 'chatgpt';

  matches(): boolean {
    return /(^|\.)chatgpt\.com$/.test(location.hostname) ||
      /(^|\.)chat\.openai\.com$/.test(location.hostname);
  }

  getEditor(): HTMLElement | null {
    return firstMatch(EDITOR_SELECTORS);
  }

  getText(): string {
    const editor = this.getEditor();
    return editor ? readText(editor).replace(/\n$/, '') : '';
  }

  getActionsContainer(): HTMLElement | null {
    const trailing = firstMatch(TRAILING_SELECTORS);
    if (trailing) return trailing;
    const column = firstMatch(FOOTER_SELECTORS)?.lastElementChild;
    if (!column) return null;
    // Skip `display: contents` wrappers to reach the row the buttons sit in.
    for (const div of column.querySelectorAll<HTMLElement>('div')) {
      if (getComputedStyle(div).display === 'flex') return div;
    }
    return null;
  }

  getComposerAnchor(): HTMLElement | null {
    return firstMatch(ANCHOR_SELECTORS) ?? this.getEditor()?.closest('form') ?? null;
  }

  isReady(): boolean {
    return this.getEditor() !== null;
  }

  setText(text: string): boolean {
    const editor = this.getEditor();
    if (!editor) return false;
    editor.focus();
    // Select existing content and replace via execCommand. This drives
    // ProseMirror's own input handling, which is what updates React state and
    // enables the send button — setting textContent directly does NOT.
    document.execCommand('selectAll', false);
    document.execCommand('delete', false);
    const ok = document.execCommand('insertText', false, text);
    // Verify the text actually landed. Compare with whitespace collapsed:
    // line breaks become paragraphs, which may round-trip as \n or \n\n.
    return ok && collapseWs(readText(editor)) === collapseWs(text);
  }

  clearInput(): void {
    const editor = this.getEditor();
    if (!editor) return;
    editor.focus();
    document.execCommand('selectAll', false);
    document.execCommand('delete', false);
  }

  submit(): boolean {
    const btn = firstMatch(SEND_SELECTORS) as HTMLButtonElement | null;
    if (!btn || btn.disabled) return false;
    btn.click();
    return true;
  }

  isGenerating(): boolean {
    return firstMatch(STOP_SELECTORS) !== null;
  }

  isStopControl(target: Element): boolean {
    return target.closest(STOP_CONTROL_SELECTOR) !== null;
  }

  isSendControl(target: Element): boolean {
    return target.closest(SEND_SELECTORS.join(', ')) !== null;
  }

  responseError(): string | null {
    const root = document.querySelector('main') ?? document.body;
    const users = root.querySelectorAll(USER_MESSAGE_SELECTOR);
    const lastUser = users[users.length - 1] ?? null;
    const afterLastUser = (node: Node): boolean =>
      !lastUser ||
      (!lastUser.contains(node) &&
        (lastUser.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0);

    for (const el of root.querySelectorAll(ERROR_STYLE_SELECTOR)) {
      const text = collapseWs(el.textContent ?? '');
      if (text && afterLastUser(el) && !el.closest(CONTENT_SELECTOR)) return clip(text);
    }
    // Unstyled notices: match their wording, walking only what follows the
    // latest user message.
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    if (lastUser) walker.currentNode = lastUser;
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const parent = node.parentElement;
      if (!parent || !(node.textContent ?? '').trim() || !afterLastUser(node)) continue;
      // Read the whole parent (a notice may be split across inline elements),
      // but never a container that holds conversation content.
      if (parent.closest(CONTENT_SELECTOR) || parent.querySelector(CONTENT_SELECTOR)) continue;
      const text = collapseWs(parent.textContent ?? '');
      if (ERROR_TEXT.some((re) => re.test(text))) return clip(text);
    }
    return null;
  }

  hasAttachments(): boolean {
    return firstMatch(ATTACHMENT_SELECTORS) !== null;
  }

  getAttachmentNames(): string[] {
    return [...document.querySelectorAll(CHIP_REMOVE_SELECTOR)].map(chipName);
  }

  attachmentName(attachment: Attachment): string {
    return attachment.kind === 'text' ? PASTED_TEXT_NAME : attachment.file.name;
  }

  removedAttachment(target: Element): { name: string; index: number } | null {
    const btn = target.closest(CHIP_REMOVE_SELECTOR);
    if (!btn) return null;
    const name = chipName(btn);
    const same = [...document.querySelectorAll(CHIP_REMOVE_SELECTOR)].filter((b) => chipName(b) === name);
    return { name, index: same.indexOf(btn) };
  }

  attach(attachment: Attachment): void {
    const editor = this.getEditor();
    if (!editor) return;
    editor.focus();
    // A paste is the one path that works for both files and long text, and
    // ChatGPT handles it exactly like the user pasting: chip, upload, send.
    const data = new DataTransfer();
    if (attachment.kind === 'file') data.items.add(attachment.file);
    else data.setData('text/plain', attachment.text);
    editor.dispatchEvent(
      new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }),
    );
  }

  clearAttachments(): void {
    document.querySelectorAll<HTMLButtonElement>(CHIP_REMOVE_SELECTOR).forEach((b) => b.click());
  }

  isUploading(): boolean {
    const box = document.querySelector('[data-composer-attachments]');
    if (!box) return false;
    const busy = [...box.querySelectorAll('[aria-label]')].some((el) =>
      /^Uploading /i.test(el.getAttribute('aria-label') ?? ''),
    );
    if (busy || /Adding pasted text/i.test(box.textContent ?? '')) return true;
    // Send stays disabled for a moment after the last "Uploading" label goes.
    const send = firstMatch(SEND_SELECTORS) as HTMLButtonElement | null;
    return this.getAttachmentNames().length > 0 && !!send?.disabled;
  }

  getConversationId(): string {
    const m = location.pathname.match(/\/c\/([0-9a-fA-F-]+)/);
    return m ? m[1] : 'new';
  }

  selfCheck(): Record<string, boolean> {
    return {
      editor: firstMatch(EDITOR_SELECTORS) !== null,
      actionsContainer: this.getActionsContainer() !== null,
      composerAnchor: this.getComposerAnchor() !== null,
    };
  }
}

function clip(text: string): string {
  return text.length > MAX_ERROR_LENGTH ? text.slice(0, MAX_ERROR_LENGTH - 1) + '…' : text;
}

function chipName(removeButton: Element): string {
  return (removeButton.getAttribute('aria-label') ?? '').replace(/^Remove /, '');
}
