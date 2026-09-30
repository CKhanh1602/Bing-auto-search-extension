const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
function event() {
  const listeners = new Set();
  return { addListener: f => listeners.add(f), removeListener: f => listeners.delete(f), emit: (...args) => [...listeners].forEach(f => f(...args)), listeners };
}
function worker(saved = {}, getState = { status: 'loading' }) {
  const storage = structuredClone(saved);
  const onMessage = event(), onUpdated = event(), onRemoved = event();
  const chrome = {
    runtime: { id: 'test', getURL: p => 'chrome-extension://test/' + p, onMessage, sendMessage: async () => {} },
    storage: { local: { get: async () => storage, set: async data => Object.assign(storage, structuredClone(data)) } },
    tabs: { onUpdated, onRemoved, get: (id, cb) => cb(getState) }
  };
  const context = vm.createContext({ chrome, console: { log() {}, warn() {} }, setTimeout, clearTimeout, URL });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../background.js'), 'utf8'), context);
  return { context, storage, chrome, onUpdated, onRemoved,
    run: code => vm.runInContext(code, context),
    message: (action, extra = {}, sender = { id: 'test', url: 'chrome-extension://test/popup.html' }) => new Promise(resolve => {
      const listener = [...onMessage.listeners][0];
      const accepted = listener({ action, ...extra }, sender, resolve);
      if (accepted !== true) resolve(undefined);
    }) };
}
test('loading timeout rejects instead of claiming ready and removes listeners', async () => {
  const w = worker();
  await assert.rejects(w.run('waitTabReady(1, 5)'), /TAB_TIMEOUT/);
  assert.equal(w.onUpdated.listeners.size, 0);
  assert.equal(w.onRemoved.listeners.size, 0);
});
test('tab close rejects and stop interrupts tab wait', async () => {
  const w = worker();
  const closed = w.run('waitTabReady(1, 50)');
  w.onRemoved.emit(1);
  await assert.rejects(closed, /TAB_CLOSED/);
  const stopped = w.run('waitTabReady(2, 50)');
  w.run('requestStop()');
  await assert.rejects(stopped, /STOPPED/);
});
test('already loaded tab resolves and releases listeners', async () => {
  const w = worker({}, { status: 'complete' });
  await w.run('waitTabReady(1, 50)');
  assert.equal(w.onUpdated.listeners.size, 0);
  assert.equal(w.onRemoved.listeners.size, 0);
});
test('missing tab and asynchronous complete events settle correctly', async () => {
  const missing = worker({}, null);
  await assert.rejects(missing.run('waitTabReady(1, 50)'), /TAB_CLOSED/);
  const loading = worker();
  const ready = loading.run('waitTabReady(2, 50)');
  loading.onUpdated.emit(9, { status: 'complete' });
  assert.equal(loading.onUpdated.listeners.size, 1);
  loading.onUpdated.emit(2, { status: 'complete' });
  await ready;
  assert.equal(loading.onRemoved.listeners.size, 0);
});
test('GET_STATUS waits for hydration and interrupted worker never replays', async () => {
  const w = worker({ engineState: { isRunning: true, isPaused: true, phase: 'quests', current: 2, total: 5 } });
  const state = await w.message('GET_STATUS');
  assert.equal(state.isRunning, false);
  assert.equal(state.isPaused, false);
  assert.equal(state.phase, 'stopped');
  assert.match(state.statusText, /interrupted/i);
  assert.equal(w.storage.engineState.isRunning, false);
  const restarted = worker(w.storage);
  assert.match((await restarted.message('GET_STATUS')).statusText, /interrupted/i);
});
test('messages reject content-script senders and invalid configuration', async () => {
  const w = worker();
  const denied = await w.message('START_QUEST', {}, { id: 'test', url: 'https://www.bing.com/', tab: { id: 1 } });
  assert.equal(denied.ok, false);
  const invalid = await w.message('START_ALL', { config: { desktopSearches: -1 } });
  assert.equal(invalid.ok, false);
});
test('start, pause, resume and stop acknowledge persisted state; no overlapping runs', async () => {
  const w = worker();
  w.run('doQuests = async () => { while (!shouldStop) { await checkPause(); await delay(1); } }');
  assert.equal((await w.message('START_QUEST')).ok, true);
  assert.equal((await w.message('START_QUEST')).ok, false);
  assert.equal((await w.message('PAUSE')).state.isPaused, true);
  assert.equal(w.storage.engineState.isPaused, true);
  assert.equal((await w.message('RESUME')).state.isPaused, false);
  assert.equal((await w.message('STOP')).ok, true);
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal((await w.message('GET_STATUS')).phase, 'stopped');
});
test('engine errors do not leak arbitrary API error text', async () => {
  const w = worker();
  w.run('doQuests = async () => { throw new Error("secret-url?token=private"); }');
  await w.message('START_QUEST');
  await new Promise(resolve => setTimeout(resolve, 5));
  const state = await w.message('GET_STATUS');
  assert.equal(state.phase, 'stopped');
  assert.doesNotMatch(state.statusText, /secret|private/);
});
test('completed quest scan persists without asserting rewards were completed', async () => {
  const w = worker();
  w.run('doQuests = async () => {}');
  await w.message('START_QUEST');
  await new Promise(resolve => setTimeout(resolve, 5));
  const state = await w.message('GET_STATUS');
  assert.equal(state.phase, 'complete');
  assert.match(state.statusText, /manual completion/);
  const restarted = worker(w.storage);
  assert.equal((await restarted.message('GET_STATUS')).phase, 'complete');
});
test('stopping START_ALL during quests suppresses subsequent desktop searches', async () => {
  const w = worker();
  w.run('globalThis.desktopStarted = false; doDesktopSearches = async () => { desktopStarted = true; }; doQuests = async () => { while (!shouldStop) await delay(1); }');
  await w.message('START_ALL', { config: { desktopSearches: 1, minDelay: 1, maxDelay: 1 } });
  await w.message('STOP');
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(w.run('desktopStarted'), false);
  assert.equal((await w.message('GET_STATUS')).phase, 'stopped');
});
