import type { Attachment } from '../attachments';

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

  /** True if `target` is (inside) the site's stop-generating control. */
  isStopControl(target: Element): boolean;

  /** True if `target` is (inside) the site's send control. */
  isSendControl(target: Element): boolean;

  /**
   * The text of an error the site shows for the latest turn (a failed reply,
   * a usage limit), or null if the latest reply looks fine. Errors shown
   * before the latest user message are ignored.
   */
  responseError(): string | null;

  /**
   * True if the composer holds attachments outside the text input: images,
   * files, or a long paste the site turned into a file. These aren't part of
   * getText(), so queuing would drop them or send them with the wrong prompt.
   */
  hasAttachments(): boolean;

  /** Names of the composer's attachment chips, in display order. */
  getAttachmentNames(): string[];

  /** The chip name the site gives `attachment` once it's attached. */
  attachmentName(attachment: Attachment): string;

  /**
   * If `target` is a chip's remove control, the chip's name and its index among
   * chips with that name; otherwise null.
   */
  removedAttachment(target: Element): { name: string; index: number } | null;

  /** Attach a local copy to the composer the way a user paste would. */
  attach(attachment: Attachment): void;

  /** Remove every attachment chip from the composer. */
  clearAttachments(): void;

  /** True while an attachment is still uploading or being processed. */
  isUploading(): boolean;

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
