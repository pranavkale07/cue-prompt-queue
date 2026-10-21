<div align="center">

<img src="public/icons/icon128.png" alt="Cue" width="96" height="96" />

# Cue - Prompt Queue for ChatGPT

[![Version](https://img.shields.io/badge/version-0.2.0-black)](CHANGELOG.md)
[![Manifest V3](https://img.shields.io/badge/Manifest-V3-blue)](https://developer.chrome.com/docs/extensions/mv3/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

**Queue multiple prompts in ChatGPT and auto-send them one at a time, each as
soon as the previous response finishes - instead of waiting and sending
manually.**

</div>

## Features

- **Type in ChatGPT's native input as usual.** While a response is generating,
  pressing **Enter** adds the prompt to the queue instead of doing nothing; when
  idle, Enter sends normally. A **Queue button** injected into the composer adds
  the current input in any state.
- A **playlist-style dock** sits just above the composer, shown only while the
  queue is non-empty. Drag rows to reorder, delete individually, or collapse the
  list to a one-line strip. Shadow-DOM isolated from the site's CSS.
- **Attachments queue too.** Images, files, and long pastes you paste, drop, or
  pick are queued with the prompt and attached again when it's sent (kept in
  the tab's memory only, so they don't survive a page reload).
- Auto-sends the next prompt a short delay after ChatGPT goes idle.
- Per-conversation queues, persisted in `chrome.storage` (survive reloads). A
  queue started in a brand-new chat carries over once the conversation gets a
  real id; opening another chat from a new one leaves both queues alone.
- Pause/resume auto-send. It halts safely if a send fails or ChatGPT shows an
  error (e.g. "Something went wrong", a usage limit), and pauses when you press
  ChatGPT's Stop button.
- Safe with several tabs: tabs on the same chat share its queue, and only one
  of them sends it, so nothing goes out twice.

## Installation

### Manual (load unpacked)

1. Clone this repository and `npm install`
2. `npm run build`
3. Go to `chrome://extensions`, enable **Developer mode**
4. **Load unpacked** -> select the `dist/` folder
5. Open <https://chatgpt.com> - the Queue button appears in the composer, and the
   dock appears above it once you queue a prompt

After code changes, `npm run dev` keeps `dist/` fresh; click the reload icon on
the extension card, then refresh the ChatGPT tab.

## How it works

All site-specific logic lives in one adapter (`src/adapters/chatgpt.ts`):

| Concern | Mechanism (verified against chatgpt.com, October 2026) |
|---|---|
| Input | `form[data-chatgpt-composer] .ProseMirror`, filled via `execCommand('insertText')` so React state updates |
| Submit | click `button[type=submit][aria-label="Send"]` |
| "Generating?" | presence of `button[aria-label="Stop"]` |
| Send confirmed | text and attachment chips leave the composer after submit |
| Attachments | chips in `[data-composer-attachments]`, one `Remove <name>` button each; queued files are re-attached with a synthetic paste |
| Uploading? | an `Uploading <name>` label on a chip, or Send still disabled |
| Conversation id | `/c/<uuid>` in the URL |
| Reply failed | red-styled text (or "Something went wrong" / "hit your limit" wording) after the latest user message, outside the reply itself. Heuristic: not verified against a live error |

Each lookup also tries the older selectors (`#prompt-textarea`,
`[data-testid="send-button"]`, `[data-testid="stop-button"]`) in case ChatGPT
still serves the previous composer to some accounts.

The engine (`src/engine.ts`) polls generation state every 250ms and runs the
queue state machine. Only the tab holding the conversation's Web Lock
(`src/lock.ts`) sends; other tabs on that chat stand by. Adding another site (e.g. Claude) means implementing the
`SiteAdapter` interface - nothing else needs to change.

## Develop

```bash
npm install
npm run dev        # vite build --watch -> rebuilds dist/ on change
npm run build      # typecheck + production build
npm run typecheck
npm run package    # build + zip dist/ into releases/cue-prompt-queue-<version>-chrome.zip
npm run test:e2e   # end-to-end tests (needs a build first, see below)
```

`npm run test:e2e` loads `dist/` into Chromium and drives it against a mock
ChatGPT page (`test/e2e/mock-chatgpt.html`). It checks the extension's logic,
not whether the selectors still match chatgpt.com. The first time, run
`npx playwright install chromium`. Pass a word to run only matching tests
(`npm run test:e2e -- stop`), and set `HEADED=1` to watch.

## Project layout

```
public/
  manifest.json          # MV3 manifest (copied to dist/ verbatim)
  popup.html             # toolbar-icon settings popup (plain HTML)
  popup.js               # popup logic: read/write settings (vanilla JS)
src/
  content.ts             # entry: wires everything, watches conversation changes
  interceptor.ts         # Enter capture + injected "Queue" button
  engine.ts              # idle-detection + auto-send state machine
  queue.ts               # queue model + per-conversation persistence
  settings.ts            # settings model + storage (read by content script)
  storage.ts             # chrome.storage access that survives a context reload
  lock.ts                # which tab sends a conversation's queue (Web Locks)
  panel.ts               # playlist-style dock UI (Shadow DOM)
  panel.css              # dock styles (inlined into the shadow root)
  adapters/
    types.ts             # SiteAdapter interface
    chatgpt.ts           # ChatGPT selectors & DOM interaction
test/e2e/
  mock-chatgpt.html      # stand-in for chatgpt.com's composer and SPA routing
  run.mjs                # end-to-end tests (Playwright)
```

## Privacy & Permissions

- **No data collection.** Your queued prompts and preferences are stored only on
  your device via `chrome.storage.local`. Nothing is transmitted, and there is no
  analytics or remote code. See [PRIVACY.md](PRIVACY.md).
- **`storage`** - save the queue and preferences locally so they survive reloads.
- **Host access to chatgpt.com / chat.openai.com** - the extension runs only on
  ChatGPT, to read the composer and generation state and send queued prompts.

## Contributing

Contributions are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for setup and
guidelines, and [CHANGELOG.md](CHANGELOG.md) for release history.

## License

[MIT](LICENSE) (c) Pranav Kale.

Not affiliated with, endorsed by, or sponsored by OpenAI. "ChatGPT" is a
trademark of OpenAI, used here only to describe compatibility.
