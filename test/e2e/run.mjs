// End-to-end tests: loads the built extension (dist/) into Chromium and runs it
// against test/e2e/mock-chatgpt.html, served at https://chatgpt.com/* through
// request interception (no network access to ChatGPT is needed or used).
//
//   npm run build && npm run test:e2e            # all tests
//   npm run test:e2e -- stop                     # tests whose name contains "stop"
//
// The mock copies the DOM contract of src/adapters/chatgpt.ts, so these tests
// cover the extension's logic, not whether the selectors still match the live
// site. Check that by hand on chatgpt.com.
import { chromium } from 'playwright';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const DIST = resolve(here, '../../dist');
const MOCK = readFileSync(join(here, 'mock-chatgpt.html'), 'utf8');
const ORIGIN = 'https://chatgpt.com';
const CHAT_A = '/c/aaaaaaaa-0000-4000-8000-000000000001';
const CHAT_B = '/c/bbbbbbbb-0000-4000-8000-000000000002';
const ID_A = CHAT_A.slice(3);
const ID_B = CHAT_B.slice(3);

// Chrome derives an unpacked extension's id from its absolute path.
const EXT_ID = [...createHash('sha256').update(DIST).digest('hex').slice(0, 32)]
  .map((h) => String.fromCharCode(97 + parseInt(h, 16)))
  .join('');

// ---- harness ---------------------------------------------------------------

async function launch() {
  const dir = mkdtempSync(join(tmpdir(), 'cue-e2e-'));
  const ctx = await chromium.launchPersistentContext(dir, {
    channel: 'chromium', // the full browser's headless mode; headless-shell can't load extensions
    headless: !process.env.HEADED,
    viewport: { width: 1100, height: 760 },
    args: [`--disable-extensions-except=${DIST}`, `--load-extension=${DIST}`],
  });
  await ctx.route(`${ORIGIN}/**`, (route) =>
    route.request().resourceType() === 'document'
      ? route.fulfill({ contentType: 'text/html', body: MOCK })
      : route.fulfill({ status: 404, body: '' }),
  );
  ctx.cleanup = async () => {
    await ctx.close();
    rmSync(dir, { recursive: true, force: true });
  };
  return ctx;
}

/** Read/write chrome.storage.local from an extension page. */
async function extPage(ctx) {
  const page = await ctx.newPage();
  await page.goto(`chrome-extension://${EXT_ID}/popup.html`);
  return page;
}
async function storageGet(ctx) {
  const page = await extPage(ctx);
  const all = await page.evaluate(() => chrome.storage.local.get(null));
  await page.close();
  return all;
}
async function storageSet(ctx, values) {
  const page = await extPage(ctx);
  await page.evaluate((v) => chrome.storage.local.set(v), values);
  await page.close();
}

async function openChat(ctx, path, { responseMs = 2000 } = {}) {
  const page = await ctx.newPage();
  await page.goto(ORIGIN + path);
  await page.evaluate((ms) => (window.mock.responseMs = ms), responseMs);
  await page.waitForSelector('#gpt-queue-add-btn', { timeout: 10000 });
  return page;
}

async function type(page, text) {
  await page.locator('.ProseMirror').click();
  await page.keyboard.type(text);
}
/** Send directly, like the user pressing Enter while idle. */
async function sendNow(page, text) {
  await type(page, text);
  await page.keyboard.press('Enter');
}
/** Queue via the injected Queue button. */
async function queue(page, text) {
  await type(page, text);
  await page.click('#gpt-queue-add-btn');
}
async function pasteFile(page, name) {
  await page.locator('.ProseMirror').click();
  await page.evaluate((n) => {
    const dt = new DataTransfer();
    dt.items.add(new File(['hello'], n, { type: 'text/plain' }));
    document.querySelector('.ProseMirror').dispatchEvent(
      new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }),
    );
  }, name);
}

const rows = (page) => page.locator('#gpt-queue-host .row .text').allInnerTexts();
const label = (page) => page.locator('#gpt-queue-host .strip .label').innerText();
const dotState = (page) => page.locator('#gpt-queue-host .dot').getAttribute('class');
const clickPlayPause = (page) => page.locator('#gpt-queue-host .strip .icon-btn').first().click();
const clickClear = (page) => page.locator('#gpt-queue-host .strip .icon-btn').nth(1).click();
const nav = (page, name) => page.click(`nav a:text-is("${name}")`);
const sent = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('mockSent') || '[]'));
const generating = (page) => page.locator('button[aria-label="Stop"]').count().then((n) => n > 0);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function until(fn, what, timeout = 15000) {
  const deadline = Date.now() + timeout;
  let last;
  while (Date.now() < deadline) {
    last = await fn();
    if (last) return last;
    await sleep(100);
  }
  throw new Error(`timed out waiting for ${what} (last: ${JSON.stringify(last)})`);
}

function eq(actual, expected, what) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${what}: expected ${e}, got ${a}`);
}
function ok(cond, what) {
  if (!cond) throw new Error(what);
}

/** Pause auto-send from the dock (the dock only shows once something's queued). */
async function pause(page) {
  const btn = page.locator('#gpt-queue-host .strip .icon-btn').first();
  await clickPlayPause(page);
  await until(async () => (await btn.getAttribute('title')) === 'Resume auto-send', 'paused', 3000).catch(async (e) => {
    throw new Error(e.message + ' title=' + (await btn.getAttribute('title')) + ' text=' + (await btn.innerText()));
  });
}

// ---- tests -------------------------------------------------------------------

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test('auto-sends queued prompts in order after each reply', async (ctx) => {
  const page = await openChat(ctx, CHAT_A, { responseMs: 1200 });
  await sendNow(page, 'start');
  await until(() => generating(page), 'generation');
  await queue(page, 'one');
  await queue(page, 'two');
  eq(await rows(page), ['one', 'two'], 'rows');
  await until(async () => (await sent(page)).length === 3, '3 sends');
  eq((await sent(page)).map((s) => s.text), ['start', 'one', 'two'], 'send order');
});

test('Enter while generating queues; multi-line text keeps its line breaks', async (ctx) => {
  const page = await openChat(ctx, CHAT_A, { responseMs: 1500 });
  await sendNow(page, 'start');
  await until(() => generating(page), 'generation');
  await type(page, 'line 1');
  await page.keyboard.press('Shift+Enter');
  await page.keyboard.type('line 2');
  await page.keyboard.press('Enter');
  eq(await rows(page), ['line 1\nline 2'], 'rows');
  await until(async () => (await sent(page)).length === 2, '2 sends');
  eq((await sent(page))[1].text, 'line 1\nline 2', 'sent text');
});

test('queues attachments and re-attaches them on send', async (ctx) => {
  const page = await openChat(ctx, CHAT_A, { responseMs: 1500 });
  await sendNow(page, 'start');
  await until(() => generating(page), 'generation');
  await pasteFile(page, 'notes.txt');
  await sleep(700); // upload finishes
  await queue(page, 'see file');
  await until(async () => (await sent(page)).length === 2, '2 sends');
  const s = (await sent(page))[1];
  eq([s.text, s.attachments], ['see file', ['notes.txt']], 'sent prompt');
});

test('opening a chat from a new chat keeps that chat\'s queue', async (ctx) => {
  const page = await openChat(ctx, CHAT_A, { responseMs: 60000 });
  await sendNow(page, 'start');
  await until(() => generating(page), 'generation');
  await queue(page, 'a1');
  await queue(page, 'a2');
  await pause(page);
  await nav(page, 'New chat');
  await sleep(1500);
  await nav(page, 'Chat A');
  await sleep(1500);
  eq(await rows(page), ['a1', 'a2'], 'Chat A rows after new chat → Chat A');
  eq(((await storageGet(ctx))[`queue:${ID_A}`] ?? []).map((i) => i.text), ['a1', 'a2'], 'stored Chat A queue');
});

test('a queue made in a new chat stays there when opening another chat', async (ctx) => {
  await storageSet(ctx, { settings: { autoSendDelayMs: 400, startPaused: true } });
  const page = await openChat(ctx, '/');
  await queue(page, 'n1');
  eq(await rows(page), ['n1'], 'new chat rows');
  await nav(page, 'Chat B');
  await sleep(1500);
  eq(await rows(page), [], 'Chat B rows');
  await nav(page, 'New chat');
  await sleep(1500);
  eq(await rows(page), ['n1'], 'new chat rows after coming back');
  ok(!(await sent(page)).some((s) => s.text === 'n1'), 'n1 must not be sent');
});

test('first send in a new chat carries the rest of the queue into the new conversation', async (ctx) => {
  const page = await openChat(ctx, '/', { responseMs: 2000 });
  await sendNow(page, 'first');
  await until(() => generating(page), 'generation');
  await queue(page, 'second');
  await until(async () => (await sent(page)).length === 2, '2 sends');
  const [, second] = await sent(page);
  const conv = new URL(page.url()).pathname.slice(3);
  eq(second.conv, conv, 'second prompt went to the new conversation');
  const stored = await storageGet(ctx);
  ok(!Object.keys(stored).some((k) => k.startsWith('queue:new')), 'no leftover new-chat queue');
});

test('two tabs on the same chat send each prompt once', async (ctx) => {
  const t1 = await openChat(ctx, CHAT_A, { responseMs: 3000 });
  await sendNow(t1, 'start');
  await until(() => generating(t1), 'generation');
  await queue(t1, 'q1');
  await queue(t1, 'q2');
  const t2 = await openChat(ctx, CHAT_A, { responseMs: 1000 });
  await sleep(500);
  eq(await rows(t2), ['q1', 'q2'], 'second tab sees the queue');
  ok(/another tab/i.test(await label(t2)), `second tab stands by (got "${await label(t2)}")`);
  await queue(t2, 'q3'); // t2 is idle, but t1 drives this chat
  await until(async () => (await rows(t1)).includes('q3'), 'q3 synced to first tab', 5000);
  await until(async () => (await sent(t1)).length >= 4, '4 sends', 20000);
  await sleep(3000);
  const texts = (await sent(t1)).map((s) => s.text);
  eq(texts, ['start', 'q1', 'q2', 'q3'], 'sends across both tabs');
});

test('pressing Stop pauses auto-send until resumed', async (ctx) => {
  const page = await openChat(ctx, CHAT_A, { responseMs: 60000 });
  await sendNow(page, 'start');
  await until(() => generating(page), 'generation');
  await queue(page, 'q1');
  await page.click('button[aria-label="Stop"]');
  await sleep(2000);
  eq((await sent(page)).map((s) => s.text), ['start'], 'nothing auto-sent after Stop');
  eq(await dotState(page), 'dot paused', 'dock paused');
  ok(/stopped/i.test(await label(page)), `notice explains the pause (got "${await label(page)}")`);
  await page.evaluate(() => (window.mock.responseMs = 500));
  await clickPlayPause(page);
  await until(async () => (await sent(page)).length === 2, 'q1 sent after resume');
});

test('an error reply stops auto-send and the error stays visible', async (ctx) => {
  await storageSet(ctx, { settings: { autoSendDelayMs: 400, startPaused: true } });
  const page = await openChat(ctx, CHAT_A, { responseMs: 800 });
  await queue(page, 'q1');
  await queue(page, 'q2');
  await page.evaluate(() => (window.mock.nextError = 'Something went wrong while generating the response.'));
  await clickPlayPause(page);
  await until(async () => (await sent(page)).length === 1, 'q1 sent');
  await sleep(2500);
  eq((await sent(page)).map((s) => s.text), ['q1'], 'q2 not sent after the error');
  eq(await dotState(page), 'dot error', 'dock in error state');
  // A manual send while halted must not wipe the error.
  await sendNow(page, 'manual');
  await until(() => generating(page), 'manual generation');
  await until(async () => !(await generating(page)), 'manual reply done');
  await sleep(800);
  eq(await dotState(page), 'dot error', 'still in error state after a manual send');
  ok(/went wrong/i.test(await label(page)), `error still shown (got "${await label(page)}")`);
  // Resuming continues with q2, now that the error is behind the latest turn.
  await clickPlayPause(page);
  await until(async () => (await sent(page)).some((s) => s.text === 'q2'), 'q2 sent after resume');
});

test('an unstyled usage-limit notice also stops auto-send', async (ctx) => {
  await storageSet(ctx, { settings: { autoSendDelayMs: 400, startPaused: true } });
  const page = await openChat(ctx, CHAT_A, { responseMs: 800 });
  await queue(page, 'q1');
  await queue(page, 'q2');
  await page.evaluate(() => {
    window.mock.plainError = true;
    window.mock.nextError = "You've hit your limit. Please try again later.";
  });
  await clickPlayPause(page);
  await until(async () => (await dotState(page)) === 'dot error', 'error state');
  eq((await sent(page)).map((s) => s.text), ['q1'], 'q2 not sent');
});

test('error wording inside the conversation itself does not stop auto-send', async (ctx) => {
  const page = await openChat(ctx, CHAT_A, { responseMs: 800 });
  await sendNow(page, 'start');
  await until(() => generating(page), 'generation');
  await queue(page, 'Something went wrong with my code, I hit the rate limit');
  await queue(page, 'after');
  await until(async () => (await sent(page)).length === 3, '3 sends').catch(async (e) => {
    throw new Error(`${e.message}; notice: "${await label(page)}"`);
  });
  ok((await dotState(page)) !== 'dot error', `no error (notice: "${await label(page)}")`);
});

test('waits for the reply to start even when the Stop button shows up late', async (ctx) => {
  await storageSet(ctx, { settings: { autoSendDelayMs: 0, startPaused: true } });
  const page = await openChat(ctx, CHAT_A, { responseMs: 800 });
  await page.evaluate(() => (window.mock.stopDelayMs = 900));
  await queue(page, 'q1');
  await queue(page, 'q2');
  await clickPlayPause(page);
  await until(async () => (await sent(page)).length === 2, '2 sends', 15000);
  await sleep(1500);
  ok((await dotState(page)) !== 'dot error', `no error (notice: "${await label(page)}")`);
  eq((await sent(page)).map((s) => s.text), ['q1', 'q2'], 'both sent once, in order');
});

test('switching chats mid-send leaves both queues intact', async (ctx) => {
  await storageSet(ctx, {
    settings: { autoSendDelayMs: 400, startPaused: true },
    [`queue:${ID_B}`]: [{ id: 'b1', text: 'b1' }],
  });
  const page = await openChat(ctx, CHAT_A, { responseMs: 800 });
  await page.evaluate(() => (window.mock.uploadMs = 4000));
  await pasteFile(page, 'big.txt');
  await sleep(4300);
  await queue(page, 'with file');
  await clickPlayPause(page);
  await until(async () => (await dotState(page)) === 'dot sending', 'sending');
  await nav(page, 'Chat B');
  await sleep(6000);
  // Auto-send is on, so Chat B sends its own prompt; Chat A keeps its own.
  const texts = (await sent(page)).map((s) => `${s.conv === ID_B ? 'B' : '?'}:${s.text}`);
  eq(texts, ['B:b1'], 'sends');
  const stored = await storageGet(ctx);
  eq((stored[`queue:${ID_A}`] ?? []).map((i) => i.text), ['with file'], 'Chat A queue');
});

test('Enter-to-queue can be turned off', async (ctx) => {
  await storageSet(ctx, { settings: { autoSendDelayMs: 400, startPaused: false, enterToQueue: false } });
  const page = await openChat(ctx, CHAT_A, { responseMs: 3000 });
  await sendNow(page, 'start');
  await until(() => generating(page), 'generation');
  await type(page, 'not queued');
  await page.keyboard.press('Enter');
  await sleep(300);
  eq(await rows(page), [], 'nothing queued');
  eq(await page.locator('.ProseMirror').innerText(), 'not queued', 'text left in the composer');
});

test('an expanded row stays expanded when another prompt is queued', async (ctx) => {
  const page = await openChat(ctx, CHAT_A, { responseMs: 60000 });
  await sendNow(page, 'start');
  await until(() => generating(page), 'generation');
  await queue(page, 'first');
  await page.locator('#gpt-queue-host .row .text').first().click();
  await queue(page, 'second');
  const cls = await page.locator('#gpt-queue-host .row .text').first().getAttribute('class');
  ok(cls.includes('expanded'), `first row still expanded (class "${cls}")`);
});

test('Clear needs a second click to confirm', async (ctx) => {
  const page = await openChat(ctx, CHAT_A, { responseMs: 60000 });
  await sendNow(page, 'start');
  await until(() => generating(page), 'generation');
  await queue(page, 'a');
  await queue(page, 'b');
  await clickClear(page);
  eq(await rows(page), ['a', 'b'], 'first click keeps the queue');
  await clickClear(page);
  eq(await rows(page), [], 'second click clears');
});

test('an emptied queue is removed from storage', async (ctx) => {
  const page = await openChat(ctx, CHAT_A, { responseMs: 1000 });
  await sendNow(page, 'start');
  await until(() => generating(page), 'generation');
  await queue(page, 'q1');
  await until(async () => (await sent(page)).length === 2, 'q1 sent');
  await sleep(500);
  ok(!(`queue:${ID_A}` in (await storageGet(ctx))), 'no stored key for an empty queue');
});

test('a new-chat queue saved by an older version is picked up', async (ctx) => {
  await storageSet(ctx, {
    settings: { autoSendDelayMs: 400, startPaused: true },
    'queue:new': [{ id: 'old1', text: 'from 0.2.0' }],
  });
  const page = await openChat(ctx, '/');
  await sleep(500);
  eq(await rows(page), ['from 0.2.0'], 'rows');
  ok(!('queue:new' in (await storageGet(ctx))), 'legacy key removed');
});

// ---- runner ------------------------------------------------------------------

const filter = process.argv[2];
const selected = tests.filter((t) => !filter || t.name.includes(filter));
let failed = 0;
for (const t of selected) {
  const ctx = await launch();
  const started = Date.now();
  try {
    await t.fn(ctx);
    console.log(`  ✓ ${t.name} (${((Date.now() - started) / 1000).toFixed(1)}s)`);
  } catch (e) {
    failed++;
    console.log(`  ✗ ${t.name}\n      ${e.message.split('\n')[0]}`);
  } finally {
    await ctx.cleanup();
  }
}
console.log(`\n${selected.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
