/**
 * A SiteAdapter encapsulates everything site-specific (selectors, input
 * injection, generation detection) behind a stable interface. The engine and
 * UI never touch the DOM of the host site directly — only through an adapter.
 * To support a new site (e.g. Claude), add another implementation of this.
 */
export interface SiteAdapter {
  /** Human-readable adapter name, used in logs. */
  readonly name: string;

  /** True if this adapter applies to the current page. */
  matches(): boolean;

  /** The composer input element, or null if not present yet. */
  getEditor(): HTMLElement | null;

  /** Current text in the composer. */
  getText(): string;

  /**
   * A stable container in the composer's action area where an injected control
   * (the "Queue" button) can be mounted. Survives send/stop state changes.
   */
  getActionsContainer(): HTMLElement | null;

  /**
   * The visible composer box, used to align the queue dock's width/position so
   * it sits flush just above the input.
   */
  getComposerAnchor(): HTMLElement | null;

  /** True once the composer is mounted and ready to receive input. */
  isReady(): boolean;

  /**
   * Replace the composer's content with `text`, updating the site's framework
   * state so a subsequent submit sends exactly this text. Returns true on success.
   */
  setText(text: string): boolean;

  /** Clear the composer. */
  clearInput(): void;

  /** Submit the current composer content. Returns true if a submit was triggered. */
  submit(): boolean;

  /** True while the model is generating a response. */
  isGenerating(): boolean;

  /**
   * Stable identifier for the current conversation, used to scope the queue.
   * Returns "new" for an unsaved chat that has no id yet.
   */
  getConversationId(): string;

  /**
   * Report which key elements currently resolve. Used at startup for logging
   * and to detect when the site's DOM has drifted out from under the adapter.
   */
  selfCheck(): Record<string, boolean>;
}
