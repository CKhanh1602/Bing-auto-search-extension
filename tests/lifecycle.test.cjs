const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
function event() {
  const listeners = new Set();
  return { addListener: f => listeners.add(f), removeListener: f => listeners.delete(f), emit: (...args) => [...listeners].forEach(f => f(...args)), listeners };
}
function worker(saved = {}, getState = { status: 'complete', url: 'https://rewards.bing.com/dashboard' }) {
  const logs = [];
  const storage = structuredClone(saved);
  const onMessage = event(), onUpdated = event(), onRemoved = event();
  const chrome = {
    runtime: { id: 'test', getURL: p => 'chrome-extension://test/' + p, onMessage, sendMessage: async () => {} },
    storage: { local: { get: async () => storage, set: async data => Object.assign(storage, structuredClone(data)) } },
    tabs: { onUpdated, onRemoved, get: (id, cb) => cb ? cb(getState) : Promise.resolve(getState),
      sendMessage: async () => ({ supported: true, cards: [], totalScanned: 0 }) }
  };
  const context = vm.createContext({ chrome, console: { log: line => logs.push(line), warn() {} }, setTimeout, clearTimeout, URL });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../background.js'), 'utf8'), context);
  return { context, storage, chrome, onUpdated, onRemoved, logs,
    run: code => vm.runInContext(code, context),
    message: (action, extra = {}, sender = { id: 'test', url: 'chrome-extension://test/popup.html' }) => new Promise(resolve => {
      const listener = [...onMessage.listeners][0];
      const accepted = listener({ action, ...extra }, sender, resolve);
      if (accepted !== true) resolve(undefined);
    }) };
}

test('UI activation authorization is bound to one tab/document and consumed once', async () => {
  const w = worker();
  await w.run('stateReady');
  w.run(`resetState(); questUiPermits.set('one-use', {tabId:7,documentId:'doc',expiresAt:Date.now()+10000})`);
  const sender = {id:'test',tab:{id:7},documentId:'doc',url:'https://www.bing.com/rewards/panelflyout?channel=bingflyout'};
  assert.equal((await w.message('QUEST_UI_PERMIT', {nonce:'one-use'}, {...sender,documentId:'other'})).ok, false);
  assert.equal((await w.message('QUEST_UI_PERMIT', {nonce:'one-use'}, {...sender,tab:{id:8}})).ok, false);
  assert.equal((await w.message('QUEST_UI_PERMIT', {nonce:'one-use'}, {...sender,url:'https://www.bing.com/search?q=other'})).ok, false);
  const permit = await w.message('QUEST_UI_PERMIT', {nonce:'one-use'}, sender);
  assert.equal(permit.ok, true);
  assert.ok(permit.expiresAt <= Date.now()+250);
  assert.equal((await w.message('QUEST_UI_PERMIT', {nonce:'one-use'}, sender)).ok, false);
});

test('late UI authorization after Pause or Stop is denied without granting a click lease', async () => {
  const w = worker();
  await w.run('stateReady');
  const sender = {id:'test',tab:{id:7},documentId:'doc',url:'https://www.bing.com/rewards/panelflyout'};
  w.run(`resetState(); isPaused=true; questUiPermits.set('paused', {tabId:7,documentId:'doc',expiresAt:Date.now()+10000})`);
  assert.equal((await w.message('QUEST_UI_PERMIT', {nonce:'paused'}, sender)).error, 'QUEST_UI_PAUSED');
  w.run(`requestStop(); questUiPermits.set('stopped', {tabId:7,documentId:'doc',expiresAt:Date.now()+10000})`);
  assert.equal((await w.message('QUEST_UI_PERMIT', {nonce:'stopped'}, sender)).error, 'STOPPED');
});
test('loading timeout rejects instead of claiming ready and removes listeners', async () => {
  const w = worker({}, { status: 'loading' });
  await assert.rejects(w.run('waitTabReady(1, 5)'), /TAB_TIMEOUT/);
  assert.equal(w.onUpdated.listeners.size, 0);
  assert.equal(w.onRemoved.listeners.size, 0);
});
test('pause freezes the tab readiness timeout until the run resumes', async () => {
  const w = worker({}, { status: 'loading' });
  const ready = w.run('waitTabReady(1, 8)');
  w.run('isPaused = true; pauseStartedAt = Date.now()');
  let settled = false;
  ready.finally(() => { settled = true; });
  await new Promise(resolve => setTimeout(resolve, 25));
  assert.equal(settled, false);
  w.run('totalPausedMs += Date.now() - pauseStartedAt; pauseStartedAt = 0; isPaused = false');
  w.onUpdated.emit(1, { status: 'complete' });
  await ready;
  assert.equal(w.onUpdated.listeners.size, 0);
  assert.equal(w.onRemoved.listeners.size, 0);
});
test('tab close rejects and stop interrupts tab wait', async () => {
  const w = worker({}, { status: 'loading' });
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
  const loading = worker({}, { status: 'loading' });
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
test('browser restriction remains actionable after worker restart without replay', async () => {
  const w = worker();
  w.run('doQuests = async () => { throw new Error("QUEST_BROWSER_RESTRICTED"); }');
  await w.run("runEngine('START_QUEST')");
  const before = await w.message('GET_STATUS');
  assert.match(before.statusText, /^QUEST_BROWSER_RESTRICTED:/);
  const restarted = worker(w.storage);
  const after = await restarted.message('GET_STATUS');
  assert.equal(after.statusText, before.statusText);
  assert.equal(after.isRunning, false);
  assert.equal(after.phase, 'stopped');
});

test('dashboard API failure remains actionable after worker restart without replay', async () => {
  const w = worker();
  w.run('doQuests = async () => { throw new Error("QUEST_API_TIMEOUT"); }');
  await w.run("runEngine('START_QUEST')");
  const before = await w.message('GET_STATUS');
  assert.match(before.statusText, /^QUEST_API_TIMEOUT:/);
  const restarted = worker(w.storage);
  const after = await restarted.message('GET_STATUS');
  assert.equal(after.statusText, before.statusText);
  assert.equal(after.isRunning, false);
});

test('restart does not restore arbitrary text disguised as a known quest error', async () => {
  const w = worker({ engineState: { phase: 'stopped', isRunning: false,
    statusText: 'QUEST_BROWSER_RESTRICTED: private-token-user-data' } });
  const state = await w.message('GET_STATUS');
  assert.doesNotMatch(state.statusText, /private-token-user-data/);
});

test('unverified Quest activities persist as needing user action without asserting credit', async () => {
  const w = worker();
  w.run('doQuests = async () => true');
  await w.message('START_QUEST');
  await new Promise(resolve => setTimeout(resolve, 5));
  const state = await w.message('GET_STATUS');
  assert.equal(state.phase, 'needs_action');
  assert.match(state.statusText, /need action/);
  const restarted = worker(w.storage);
  assert.equal((await restarted.message('GET_STATUS')).phase, 'needs_action');
});

test('Quest reports completion only when Rewards-confirmed progress reaches total', async () => {
  const w = worker();
  w.run('doQuests = async () => { update({ current: 2, total: 2 }); return false; }');
  await w.run("runEngine('START_QUEST')");
  const state = await w.message('GET_STATUS');
  assert.equal(state.phase, 'complete');
  assert.equal(state.current, 2);
  assert.equal(state.total, 2);
  assert.equal(state.statusText, 'Quest activities confirmed by Rewards.');
});

test('Quest with no eligible offers does not claim activity credit', async () => {
  const w = worker();
  w.run('doQuests = async () => { update({ current: 0, total: 0 }); return false; }');
  await w.run("runEngine('START_QUEST')");
  const state = await w.message('GET_STATUS');
  assert.equal(state.phase, 'complete');
  assert.equal(state.statusText, 'No eligible Quest offers found; check Rewards for credit.');
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

test('START_ALL continues searches after handing manual Rewards offers to the user', async () => {
  const w = worker();
  w.run('globalThis.desktopStarted = false; doDesktopSearches = async () => { desktopStarted = true; }; doQuests = async () => true');
  await w.run("runEngine('START_ALL', { desktopSearches: 1, minDelay: 1, maxDelay: 1 })");
  assert.equal(w.run('desktopStarted'), true);
  assert.equal((await w.message('GET_STATUS')).phase, 'needs_action');
});

test('extension dashboard in a tab may control the worker; web tabs remain denied', async () => {
  const w = worker();
  const state = await w.message('GET_STATUS', {}, { id: 'test', url: 'chrome-extension://test/popup.html', tab: { id: 7 } });
  assert.equal(state.phase, 'idle');
  const denied = await w.message('STOP', {}, { id: 'test', url: 'https://www.bing.com/popup.html', tab: { id: 7 } });
  assert.equal(denied.ok, false);
});

test('quest timeout configuration is bounded before starting', async () => {
  const w = worker();
  w.run('doQuests = async () => {}');
  for (const value of [0, 9, 301, '120', NaN]) {
    assert.equal((await w.message('START_QUEST', { config: { questTimeoutSeconds: value } })).ok, false);
  }
});

test('quest default and accepted minimum are ten seconds', async () => {
  const w = worker();
  assert.equal(w.run('questTimeoutMs'), 10000);
  w.run('doQuests = async () => {}');
  await w.run("runEngine('START_QUEST')");
  assert.equal(w.run('questTimeoutMs'), 10000);
  assert.equal((await w.message('START_QUEST', { config: { questTimeoutSeconds: 10 } })).ok, true);
});
