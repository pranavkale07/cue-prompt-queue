# Contributing to Cue

Thanks for taking the time to contribute! Cue is a small, focused extension, and
contributions of all sizes are welcome.

## Table of Contents
- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [Development Process](#development-process)
- [Pull Request Process](#pull-request-process)
- [Style Guidelines](#style-guidelines)
- [Reporting Bugs](#reporting-bugs)
- [Feature Requests](#feature-requests)

## Code of Conduct
Be respectful and constructive. Report unacceptable behavior to the maintainer.

## Getting Started
1. Fork the repository
2. Clone your fork:
   ```bash
   git clone https://github.com/your-username/cue-prompt-queue.git
   ```
3. Install dependencies:
   ```bash
   npm install
   ```
4. Build:
   ```bash
   npm run build
   ```
5. Load `dist/` as an unpacked extension in Chrome (`chrome://extensions` ->
   Developer mode -> Load unpacked).

## Development Process
1. Create a branch for your change:
   ```bash
   git checkout -b feature/your-feature-name
   ```
2. Make your changes. `npm run dev` keeps `dist/` rebuilding on save.
3. Run the end-to-end tests (`npm run build && npm run test:e2e`; the first
   time, `npx playwright install chromium`). They use a mock ChatGPT page, so
   also test the full flow on https://chatgpt.com: queue several prompts
   mid-reply, confirm auto-send, reorder, delete, pause/resume, and reload
   persistence.
4. Keep the type checker clean:
   ```bash
   npm run typecheck
   ```

## Pull Request Process
1. Update `README.md` and `CHANGELOG.md` if your change is user-facing.
2. Ensure `npm run build` passes (it runs the type check).
3. Describe what changed and how you tested it.
4. A maintainer review is required before merge.

## Style Guidelines
- **TypeScript**: match the existing style (2 spaces, single quotes, semicolons).
- **Site logic**: keep all ChatGPT-specific DOM handling inside
  `src/adapters/chatgpt.ts`. Supporting another site means implementing the
  `SiteAdapter` interface, not touching the engine or queue.
- **Privacy**: no data collection, no network calls. Everything stays local.

### Commit Messages
Use conventional commit format:
```
feat: queue prompts from the keyboard while generating
fix: re-inject the Queue button after composer re-render
docs: clarify Firefox build steps
```

## Reporting Bugs
Please include:
- Browser version and operating system
- Steps to reproduce
- Expected vs actual behavior
- Any console errors (look for `[Cue]` messages)

## Feature Requests
1. Check existing issues to avoid duplicates.
2. Describe the use case clearly.

Thank you for contributing to Cue!
