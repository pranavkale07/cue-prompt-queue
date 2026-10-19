import dockCss from './panel.css?inline';
import type { SiteAdapter } from './adapters/types';
import type { Queue, QueueItem } from './queue';
import type { Engine, EngineStatus } from './engine';

const UI_STATE_KEY = 'dock:ui';
const GAP_PX = 8;

interface UiState {
  collapsed: boolean;
}

/**
 * Queue dock: a Spotify-playlist-style strip docked just above ChatGPT's
 * composer. Visible only while the queue is non-empty. Rows can be dragged to
 * reorder or deleted; the always-visible bottom strip collapses the list to a
 * single line. Rendered in a Shadow root for style isolation, and kept aligned
 * to the composer's width/position.
 */
export class Dock {
  private host: HTMLDivElement;
  private root: ShadowRoot;
  private els!: {
    dock: HTMLDivElement;
    rows: HTMLUListElement;
    caret: HTMLSpanElement;
    label: HTMLSpanElement;
    dot: HTMLSpanElement;
    playBtn: HTMLButtonElement;
    clearBtn: HTMLButtonElement;
  };

  private ui: UiState = { collapsed: false };
  private items: QueueItem[] = [];

  // Notices shown in the strip in place of the count.
  private fatalNotice: string | null = null; // unrecoverable (e.g. composer not found)
  private engineError: string | null = null; // recoverable send error

  // drag state
  private draggingId: string | null = null;
  private dropIndex = 0;
  private marker: HTMLLIElement;

  // positioning
  private observedAnchor: HTMLElement | null = null;
  private resizeObserver: ResizeObserver;

  // theme (mirrors ChatGPT's own light/dark setting)
  private themeObserver: MutationObserver;

  constructor(
    private readonly adapter: SiteAdapter,
    private readonly queue: Queue,
    private readonly engine: Engine,
  ) {
    this.host = document.createElement('div');
    this.host.id = 'gpt-queue-host';
    this.root = this.host.attachShadow({ mode: 'open' });
    this.marker = document.createElement('li');
    this.marker.className = 'marker';
    this.resizeObserver = new ResizeObserver(() => this.reposition());
    this.themeObserver = new MutationObserver(() => this.applyTheme());
  }

  /** Match the dock's theme to ChatGPT's (it sets `dark` on <html>). */
  private applyTheme(): void {
    const html = document.documentElement;
    const dark =
      html.classList.contains('dark') ||
      getComputedStyle(html).colorScheme.includes('dark');
    this.els.dock.classList.toggle('theme-dark', dark);
  }

  async mount(): Promise<void> {
    await this.loadUiState();
    this.render();
    document.body.appendChild(this.host);

    this.applyTheme();
    this.themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class', 'style'],
    });

    this.queue.subscribe((items) => {
      this.items = items;
      this.renderRows(items);
      this.renderStrip();
    });
    this.engine.subscribe((status) => this.renderStatus(status));

    window.addEventListener('resize', this.reposition);
    window.addEventListener('scroll', this.reposition, true);
  }

  /**
   * Display an unrecoverable notice (e.g. ChatGPT's composer couldn't be found),
   * keeping the dock visible so the failure is surfaced rather than silent.
   */
  showFatal(message: string): void {
    this.fatalNotice = message;
    this.renderStrip();
  }

  private async loadUiState(): Promise<void> {
    const stored = await chrome.storage.local.get(UI_STATE_KEY);
    if (stored[UI_STATE_KEY]) {
      this.ui = { ...this.ui, ...(stored[UI_STATE_KEY] as UiState) };
    }
  }

  private saveUiState(): void {
    void chrome.storage.local.set({ [UI_STATE_KEY]: this.ui });
  }

  private render(): void {
    const style = document.createElement('style');
    style.textContent = dockCss;
    this.root.appendChild(style);

    const dock = el('div', 'dock hidden') as HTMLDivElement;
    if (this.ui.collapsed) dock.classList.add('collapsed');

    const rows = el('ul', 'rows') as HTMLUListElement;
    rows.addEventListener('dragover', this.onDragOver);
    rows.addEventListener('drop', this.onDrop);

    // Strip (bottom, always visible) — clicking it toggles the list.
    const strip = el('div', 'strip');
    const caret = el('span', 'caret', this.ui.collapsed ? '▴' : '▾') as HTMLSpanElement;
    const label = el('span', 'label', 'Queued') as HTMLSpanElement;
    const dot = el('span', 'dot idle') as HTMLSpanElement;
    const spacer = el('span', 'spacer');
    const playBtn = el('button', 'icon-btn', '⏸') as HTMLButtonElement;
    playBtn.title = 'Pause auto-send';
    const clearBtn = el('button', 'icon-btn', '✕') as HTMLButtonElement;
    clearBtn.title = 'Clear queue';

    strip.append(label, dot, spacer, playBtn, clearBtn, caret);
    strip.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('.icon-btn')) return;
      this.toggleCollapsed();
    });
    playBtn.addEventListener('click', () => this.engine.setRunning(!this.engine.isRunning));
    clearBtn.addEventListener('click', () => this.queue.clear());

    dock.append(rows, strip);
    this.root.appendChild(dock);

    this.els = { dock, rows, caret, label, dot, playBtn, clearBtn };
  }

  private toggleCollapsed(): void {
    this.ui.collapsed = !this.ui.collapsed;
    this.els.dock.classList.toggle('collapsed', this.ui.collapsed);
    this.els.caret.textContent = this.ui.collapsed ? '▴' : '▾';
    this.saveUiState();
    this.reposition();
  }

  /**
   * Update the strip label + dock visibility. A notice (fatal or engine error)
   * takes the label's place; otherwise it shows the queue count. The dock stays
   * visible whenever there's something to show.
   */
  private renderStrip(): void {
    const { dock, label } = this.els;
    const notice = this.fatalNotice ?? this.engineError;
    label.textContent = notice ?? (this.items.length ? `Queued · ${this.items.length}` : 'Queued');
    label.classList.toggle('notice', notice !== null);

    const empty = this.items.length === 0 && notice === null;
    dock.classList.toggle('hidden', empty);
    if (!empty) this.reposition();
  }

  private renderRows(items: QueueItem[]): void {
    const { rows } = this.els;
    rows.replaceChildren();

    items.forEach((item, idx) => {
      const li = el('li', 'row') as HTMLLIElement;
      li.draggable = true;
      li.dataset.id = item.id;

      const grip = el('span', 'grip', '⠿');
      const num = el('span', 'num', String(idx + 1));
      const text = el('span', 'text', item.text);
      text.title = 'Click to expand';
      text.addEventListener('click', () => {
        const expanded = text.classList.toggle('expanded');
        text.title = expanded ? '' : 'Click to expand';
        li.draggable = !expanded; // allow selecting text in the expanded view
      });
      const del = el('button', 'icon-btn', '✕') as HTMLButtonElement;
      del.title = 'Remove';
      del.draggable = false;
      del.addEventListener('click', () => this.queue.removeById(item.id));

      li.addEventListener('dragstart', (e) => this.onDragStart(e, item.id, li));
      li.addEventListener('dragend', () => this.onDragEnd(li));

      li.append(grip, num, text, del);
      rows.appendChild(li);
    });
  }

  private renderStatus(status: EngineStatus): void {
    const { dot, playBtn } = this.els;
    dot.className = `dot ${status.state}`;
    playBtn.textContent = status.running ? '⏸' : '▶';
    playBtn.title = status.running ? 'Pause auto-send' : 'Resume auto-send';
    this.engineError = status.state === 'error' && status.error ? `⚠ ${status.error}` : null;
    this.renderStrip();
  }

  // ---- Drag to reorder -----------------------------------------------------

  private onDragStart(e: DragEvent, id: string, li: HTMLLIElement): void {
    this.draggingId = id;
    li.classList.add('dragging');
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', id); // required for Firefox
    }
  }

  private onDragOver = (e: DragEvent): void => {
    if (!this.draggingId) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';

    const others = [...this.els.rows.querySelectorAll<HTMLLIElement>('.row:not(.dragging)')];
    let idx = others.length;
    for (let k = 0; k < others.length; k++) {
      const r = others[k].getBoundingClientRect();
      if (e.clientY < r.top + r.height / 2) {
        idx = k;
        break;
      }
    }
    this.dropIndex = idx;
    if (idx >= others.length) this.els.rows.appendChild(this.marker);
    else this.els.rows.insertBefore(this.marker, others[idx]);
  };

  private onDrop = (e: DragEvent): void => {
    if (!this.draggingId) return;
    e.preventDefault();
    this.queue.moveToIndex(this.draggingId, this.dropIndex);
  };

  private onDragEnd(li: HTMLLIElement): void {
    li.classList.remove('dragging');
    this.marker.remove();
    this.draggingId = null;
  }

  // ---- Positioning ---------------------------------------------------------

  private reposition = (): void => {
    if (this.items.length === 0 && this.fatalNotice === null && this.engineError === null) return;
    const anchor = this.adapter.getComposerAnchor();
    if (!anchor) {
      this.els.dock.classList.add('hidden');
      return;
    }
    if (anchor !== this.observedAnchor) {
      if (this.observedAnchor) this.resizeObserver.unobserve(this.observedAnchor);
      this.resizeObserver.observe(anchor);
      this.observedAnchor = anchor;
    }
    const r = anchor.getBoundingClientRect();
    const { dock } = this.els;
    dock.style.left = `${r.left}px`;
    dock.style.width = `${r.width}px`;
    dock.style.bottom = `${Math.max(0, window.innerHeight - r.top + GAP_PX)}px`;
  };
}

function el(tag: string, className?: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
