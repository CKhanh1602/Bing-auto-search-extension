const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');

async function popup({ saved = {}, initialState = { phase: 'idle', isRunning: false }, command = () => ({ ok: true }) } = {}) {
  const nodes = new Map(), messages = [], writes = [];
  const node = id => {
    if (!nodes.has(id)) {
      const classes = new Set(id === 'settingsPanel' || id === 'manualQuestNotice' ? ['hidden'] : []);
      nodes.set(id, { value: '', style: {}, attributes: {}, textContent: '',
        classList: { add: c => classes.add(c), remove: c => classes.delete(c), contains: c => classes.has(c),
          toggle(c, force) { const add = force === undefined ? !classes.has(c) : force; if (add) classes.add(c); else classes.delete(c); return add; } },
        handlers: {}, addEventListener(type, fn) { this.handlers[type] = fn; },
        setAttribute(name, value) { this.attributes[name] = value; },
        getAttribute(name) { return this.attributes[name]; } });
    }
    return nodes.get(id);
  };
  let init, listener;
  const document = { getElementById: node, body: node('body'), documentElement: {}, addEventListener: (_, fn) => { init = fn; } };
  const chrome = {
    storage: { local: { get: (_, cb) => queueMicrotask(() => cb(saved)), set: value => writes.push(value) } },
    runtime: { onMessage: { addListener(fn) { listener = fn; } },
      sendMessage(msg, cb) { messages.push(msg); if (cb) { cb(initialState); return; } return Promise.resolve(command(msg)); } }
  };
  vm.runInNewContext(fs.readFileSync('popup.js', 'utf8'), { document, chrome });
  init();
  await new Promise(resolve => setImmediate(resolve));
  return { node, messages, writes, document, status: state => listener({ action: 'STATUS_UPDATE', state }) };
}

test('popup has no monitoring dependency and retains ten-second Quest config', async () => {
  const h = await popup();
  assert.equal(Number(h.node('questTimeoutSeconds').value), 10);
  h.node('questTimeoutSeconds').value = '240';
  h.node('btnQuest').handlers.click();
  assert.equal(h.messages.at(-1).action, 'START_QUEST');
  assert.equal(h.messages.at(-1).config.questTimeoutSeconds, 240);
  const html = fs.readFileSync('popup.html', 'utf8');
  const script = fs.readFileSync('popup.js', 'utf8');
  assert.doesNotMatch(html, /btnKeepOpen|monitoring window/i);
  assert.doesNotMatch(script, /chrome\.(tabs|windows)/);
});

test('confirmed STOP response immediately releases start buttons and settings', async () => {
  const stopped = { phase: 'stopped', isRunning: false, isPaused: false, statusText: 'Stopped' };
  const h = await popup({ initialState: { phase: 'quests', isRunning: true }, command: msg => msg.action === 'STOP' ? { ok: true, state: stopped } : { ok: true } });
  assert.equal(h.node('btnQuest').disabled, true);
  await h.node('btnStop').handlers.click();
  for (const id of ['btnQuest', 'btnDesktop', 'btnAll', 'desktopSearches', 'questTimeoutSeconds']) assert.equal(h.node(id).disabled, false, id);
  assert.equal(h.node('btnStop').disabled, true);
  assert.equal(h.node('statusBadge').textContent, 'STOPPED');
  h.node('btnDesktop').handlers.click();
  assert.equal(h.messages.at(-1).action, 'START_DESKTOP');
});

test('failed STOP does not optimistically enable another run', async () => {
  const h = await popup({ initialState: { phase: 'quests', isRunning: true }, command: () => { throw new Error('Worker unavailable'); } });
  await h.node('btnStop').handlers.click();
  assert.equal(h.node('btnQuest').disabled, true);
  assert.match(h.node('statusText').textContent, /Extension unavailable/);
});

test('skipped activities notice survives reopen and localizes without requesting manual tasks', async () => {
  const state = { phase: 'complete', isRunning: false, current: 2, total: 3, manualQuestCount: 0, skippedQuestCount: 2 };
  const h = await popup({ saved: { lang: 'vi' }, initialState: state });
  assert.equal(h.node('manualQuestNotice').classList.contains('hidden'), false);
  assert.match(h.node('manualQuestNotice').textContent, /Đã bỏ qua 2/);
  assert.match(h.node('manualQuestNotice').textContent, /chưa xác nhận điểm/);
  assert.equal(h.document.documentElement.lang, 'vi');
  h.node('selLanguage').handlers.change({ target: { value: 'en' } });
  assert.match(h.node('manualQuestNotice').textContent, /2 activities skipped/);
  h.status({ phase: 'idle', isRunning: false, manualQuestCount: 0 });
  assert.equal(h.node('manualQuestNotice').classList.contains('hidden'), true);
});

test('skipped notice leaves active/stopped status and command errors visible', async () => {
  const state = { phase: 'complete', isRunning: false, skippedQuestCount: 1 };
  const h = await popup({ initialState: state, command: () => { throw new Error('Worker unavailable'); } });
  assert.equal(h.node('statusTextRow').classList.contains('hidden'), true);
  assert.equal(h.node('manualQuestNotice').classList.contains('hidden'), false);
  h.node('btnQuest').handlers.click();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.node('statusTextRow').classList.contains('hidden'), false);
  assert.match(h.node('statusText').textContent, /Extension unavailable/);
  for (const next of [
    { phase: 'search_desktop', isRunning: true, manualQuestCount: 1 },
    { phase: 'stopped', isRunning: false, manualQuestCount: 1 },
    { phase: 'needs_action', isRunning: false, manualQuestCount: 0 }
  ]) {
    h.status(next);
    assert.equal(h.node('statusTextRow').classList.contains('hidden'), false, next.phase);
  }
});

test('command rejection is visible even when its response returns the handoff state', async () => {
  const state = { phase: 'needs_action', isRunning: false, manualQuestCount: 1 };
  const h = await popup({ initialState: state, command: () => ({ ok: false, state, error: 'START_REJECTED' }) });
  h.node('btnQuest').handlers.click();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.node('statusTextRow').classList.contains('hidden'), false);
  assert.equal(h.node('statusText').textContent, 'START_REJECTED');
});

test('legacy manual counts never display a manual task notice', async () => {
  const h = await popup({initialState:{phase:'needs_action',isRunning:false,manualQuestCount:3}});
  assert.equal(h.node('manualQuestNotice').classList.contains('hidden'), true);
});

test('pause/resume controls, settings accessibility and persisted theme remain functional', async () => {
  const h = await popup({ saved: { theme: 'dark' }, initialState: { phase: 'search_desktop', isRunning: true, isPaused: true } });
  assert.equal(h.node('body').classList.contains('light-theme'), false);
  assert.equal(h.node('pauseText').textContent, 'Resume');
  h.node('btnPause').handlers.click();
  assert.equal(h.messages.at(-1).action, 'RESUME');
  h.status({ phase: 'search_desktop', isRunning: true, isPaused: false });
  h.node('btnPause').handlers.click();
  assert.equal(h.messages.at(-1).action, 'PAUSE');
  h.node('btnSettings').handlers.click();
  assert.equal(h.node('btnSettings').attributes['aria-expanded'], 'true');
  h.node('btnCloseSettings').handlers.click();
  assert.equal(h.node('btnSettings').attributes['aria-expanded'], 'false');
  h.node('selTheme').handlers.change({ target: { value: 'light' } });
  assert.equal(h.node('body').classList.contains('light-theme'), true);
  assert.equal(h.writes.at(-1).theme, 'light');
});

test('GitHub credit uses requested profile and no remote fonts; progress remains bounded', async () => {
  const html = fs.readFileSync('popup.html', 'utf8');
  assert.match(html, /id="githubCredit" href="https:\/\/github.com\/CKhanh1602" target="_blank" rel="noopener noreferrer"/);
  assert.doesNotMatch(html, /fonts\.googleapis\.com/);
  const h = await popup({ initialState: { phase: 'complete', current: 8, total: 5, isRunning: false } });
  assert.equal(h.node('progressBar').style.width, '100%');
  assert.equal(h.node('progressTrack').attributes['aria-valuenow'], '100');
  assert.equal(h.node('body').classList.contains('light-theme'), true);
});
