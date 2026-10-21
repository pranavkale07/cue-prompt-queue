# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.3.0] - 2026-10-21

### Fixed
- Opening a saved chat from a new chat no longer wipes that chat's queue, and a
  queue made in a new chat no longer moves into (and auto-sends in) whichever
  chat you open next. It now stays with the new chat.
- Two tabs open on the same chat no longer send every queued prompt twice.
  Tabs on a chat share its queue (adding or removing in one shows in the
  other), and only one tab sends it; the others say so.
- Each tab's new chat has its own queue instead of sharing one across tabs.
- Pressing ChatGPT's Stop button no longer sends the next prompt right away.
  Auto-send pauses until you press ▶.
- When a reply fails or ChatGPT shows an error or a usage limit, auto-send stops
  with the error shown, instead of sending the rest of the queue into a broken
  chat. Pressing ▶ resumes anyway.
- Cue waits until a reply has visibly started before treating ChatGPT as idle,
  so a slow-to-appear Stop button can't make it send the next prompt too early
  (with a short delay, this used to halt with "never saw it leave the composer").
- Switching chats while a prompt is being sent no longer sends it into the chat
  you switched to, or removes a prompt from that chat's queue.
- An auto-send error stays on screen after you send a message yourself.
- The ⏸/▶ button now updates when you pause or resume while a reply is
  generating.
- No more errors from the dock after the extension is updated while a ChatGPT
  tab is open.
- Empty queues are removed from storage instead of being kept forever.

### Added
- Long queued prompts get a ▾/▴ button next to ✕ to expand and collapse them
  again (clicking the text still works too). Expanded prompts stay expanded
  when the queue changes, e.g. after the prompt above them is sent.
- Setting: "Enter queues while generating" (on by default). Turn it off to
  leave Enter to ChatGPT; the Queue button still works.
- Clear asks for a second click ("Clear all?") so one stray click can't wipe
  the queue.
- End-to-end tests against a mock ChatGPT page: `npm run test:e2e`.

## [0.2.0] - 2026-10-20

### Added
- Queue prompts with attachments. Images, files, and long pastes you paste, drop,
  or pick in the composer are queued along with the text, shown as 📎 and a
  count on the queue item (hover for the names), and attached again when the
  prompt is sent. Cue waits for the uploads to finish before sending. Prompts
  with only attachments and no text can be queued too.
- Queued attachments are kept in the tab's memory, so they don't survive a page
  reload (the text does). If that happens, auto-send stops with a notice
  instead of sending the prompt without its attachments.

### Fixed
- Works with ChatGPT's redesigned composer (October 2026). Auto-send had stopped
  with "Send button never became available", and the Queue button no longer
  appeared, because the send/stop buttons and the composer layout changed.
- Pressing Enter (or the Queue button) with an image, file, or long paste in the
  composer no longer queues just the text. ChatGPT turns pastes of 10,000+
  characters into a `pasted.txt` attachment; before, the attachment stayed
  behind and went out with whichever prompt was sent next, or Enter silently
  did nothing. Attachments are now queued with the prompt; ones Cue can't
  copy (e.g. files added from Google Drive or your ChatGPT library) leave the
  composer as it is, with a notice explaining why.
- Auto-send no longer overwrites what you're typing. If the composer has your
  own draft or an attachment when a response finishes, Cue waits and says so,
  then sends the next prompt once the composer is clear.
- Multi-line prompts now keep their line breaks when queued. Previously the lines
  were run together into one (e.g. `point A` / `point B` became
  `point Apoint B`), and that altered text is what got sent.
- Auto-send no longer stops with "Could not inject prompt text into the
  composer" on multi-line prompts.

### Changed
- Queue items now show up to three lines with their own line breaks instead of
  a single truncated line. Click an item to expand it to the full prompt;
  very long prompts scroll within the item so the rest of the queue stays
  reachable.

## [0.1.0] - 2026-06-12

### Added
- Initial release.
- Queue multiple prompts in ChatGPT and auto-send them one at a time as each
  response finishes.
- Queue from the keyboard: press Enter while ChatGPT is generating to add the
  current input to the queue, or use the Queue button injected into the composer
  in any state.
- Playlist-style dock above the composer: drag to reorder, delete individual
  prompts, or collapse to a one-line strip. Shadow-DOM isolated from the page.
- Per-conversation queues persisted via `chrome.storage.local`, surviving page
  reloads. A queue started in a new chat carries over once it gets a real id.
- Configurable auto-send delay and "start paused" option via the toolbar popup.
- Pause/resume auto-send; halts safely if a send fails.
