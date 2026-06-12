# Privacy Policy - Cue (Prompt Queue for ChatGPT)

_Last updated: 2026-06-12_

Cue ("the extension") is designed to collect as little as
possible. In short: **it does not collect, transmit, or sell any of your data.**

## What the extension stores

The extension stores the following **locally on your device only**, using the
browser's `chrome.storage.local` API:

- The prompts you add to the queue, scoped per conversation.
- Small UI preferences (e.g. whether the queue panel is collapsed).

This data never leaves your browser. It is not sent to the developer, to any
server, or to any third party. There is no analytics, no tracking, and no remote
code execution.

## What the extension accesses

To do its job, the extension runs only on ChatGPT pages
(`https://chatgpt.com` and `https://chat.openai.com`). On those pages it reads
the message composer and the page's generation state in order to queue and send
your prompts. It does not read your conversation history or transmit page
content anywhere.

## Permissions

- **`storage`** — to save your queue and preferences locally so they survive
  page reloads.
- **Host access to chatgpt.com / chat.openai.com** — so the extension can add a
  queue control to the composer and send queued prompts on those sites only.

## Data sharing

None. No data is shared with the developer or any third party because no data
is collected or transmitted in the first place.

## Removal

Uninstalling the extension removes all locally stored queue data.

## Contact

Questions about this policy: pranavkale199@gmail.com
