# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
