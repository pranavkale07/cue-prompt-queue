import type { SiteAdapter } from './types';

/**
 * ChatGPT (chatgpt.com / chat.openai.com) adapter.
 *
 * Selectors verified live against chatgpt.com (June 2026):
 *  - Composer:  #prompt-textarea  (a ProseMirror contenteditable <div>)
 *  - Send:      [data-testid="send-button"] / #composer-submit-button  (aria-label "Send prompt")
 *  - Generating:[data-testid="stop-button"]  (aria-label "Stop answering")
 *
 * Each lookup has layered fallbacks (testid → id → aria-label) so minor UI
 * changes degrade gracefully instead of breaking outright.
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
  'div[contenteditable="true"][id="prompt-textarea"]',
  'main form div[contenteditable="true"]',
];

const SEND_SELECTORS = [
  '[data-testid="send-button"]',
  '#composer-submit-button',
  'button[aria-label="Send prompt"]',
];

const STOP_SELECTORS = [
  '[data-testid="stop-button"]',
  'button[aria-label="Stop answering"]',
  'button[aria-label*="Stop" i]',
];

// The composer is a named CSS grid; the trailing area holds the dictation/voice
// and send/stop buttons and stays mounted across state changes.
const TRAILING_SELECTORS = [
  'form div[class*="grid-area:trailing"]',
  'div[class*="grid-area:trailing"]',
];

// The composer <form> — matches the visible rounded input box's width/position.
const ANCHOR_SELECTORS = [
  'form[class*="composer"]',
];

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
    return firstMatch(TRAILING_SELECTORS);
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

  getConversationId(): string {
    const m = location.pathname.match(/\/c\/([0-9a-fA-F-]+)/);
    return m ? m[1] : 'new';
  }

  selfCheck(): Record<string, boolean> {
    return {
      editor: firstMatch(EDITOR_SELECTORS) !== null,
      actionsContainer: firstMatch(TRAILING_SELECTORS) !== null,
      composerAnchor: this.getComposerAnchor() !== null,
    };
  }
}
