# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed
- Multi-line prompts kept their line breaks when queued. Previously the lines
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
