const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function harness(options = {}) {
  const source = fs.readFileSync('background.js', 'utf8');
  const start = source.indexOf('// Quest Engine');
  const end = source.indexOf('// Engine Orchestrator');
  const removed = [], clicked = [], listeners = new Set();
  let scans = 0;
  const card = {
    textContent: options.completed ? 'Completed' : 'Learn about mountains +10', href: 'https://www.bing.com/search?q=mountains',
    getAttribute: name => name === 'href' ? (options.url || 'https://www.bing.com/search?q=mountains') : null,
    getBoundingClientRect: () => ({ width: 200, height: 100, left: 0, top: 0 }),
    closest: () => null, querySelector: () => null, scrollIntoView() {},
    click() { clicked.push('mountains'); },
  };
  const secondCard = { ...card,
    getAttribute: name => name === 'href' ? 'https://www.bing.com/search?q=oceans' : null,
    click() { clicked.push('oceans'); }
  };
  const fixtureCards = () => options.shrinking
    ? (clicked.includes('mountains') ? [secondCard] : [card, secondCard]) : [card];
  const document = {
    body: { scrollHeight: 0 },
    querySelectorAll(selector) {
      if (options.missing) return [];
      if (selector.startsWith('#dailyset,') && !options.unscoped) return [{ querySelectorAll: fixtureCards }];
      // Card intentionally exposed ONLY via the class selector used by the old scan,
      // but omitted by the old click lookup.
      if (selector.includes('[class*="card"]') || selector === 'a[href]') return [card];
      return [];
    }
  };
  const state = { current: 0, total: 0 };
  const context = vm.createContext({
    URL, console, document, location: { href: options.page || 'https://rewards.bing.com/dashboard' },
    window: { scrollTo() {}, scrollBy() {} }, setTimeout: f => { f(); },
    state, shouldStop: false, update: p => Object.assign(state, p),
    checkPause: async () => { if (options.stop) context.shouldStop = true; }, delay: async () => {}, randomInt: a => a, addLog() {},
    waitTabReady: async () => { if (options.loadError) throw new Error('TAB_TIMEOUT'); }, cdpClick: async () => clicked.push('cdp'),
    chrome: {
      scripting: { executeScript: async ({func, args = []}) => {
        if (options.scriptError) throw new Error('injection failed');
        scans++;
        return [{ result: await func(...args) }];
      } },
      tabs: {
        create: async () => ({ id: 1 }),
        onCreated: { addListener: f => listeners.add(f), removeListener: f => listeners.delete(f) },
        query: async () => scans > 2 ? [{ id: 1 }, { id: 99 }] : [{ id: 1 }],
        get: async () => ({ id: 1, url: 'https://rewards.bing.com/dashboard' }),
        update: async () => {}, reload: async () => {},
        remove: async id => removed.push(id),
      }
    }
  });
  vm.runInContext(source.slice(start, end), context);
  return { context, removed, clicked, listeners, state };
}

test('a card discovered by class selector is activated once by identity', async () => {
  const h = harness();
  await vm.runInContext("processQuestsOnPage({id:1}, 'Dashboard')", h.context);
  assert.deepEqual(h.clicked, ['mountains']);
});
test('completion of first card does not skip next card in shrinking list', async () => {
  const h = harness({ shrinking: true });
  await vm.runInContext("processQuestsOnPage({id:1}, 'Dashboard')", h.context);
  assert.deepEqual(h.clicked, ['mountains', 'oceans']);
});
test('source tab is cleaned up even when loading times out or scanning fails', async () => {
  for (const options of [{ loadError: true }, { scriptError: true }]) {
    const h = harness(options);
    await assert.rejects(vm.runInContext('doQuests()', h.context));
    assert.deepEqual(h.removed, [1]);
  }
});
test('completed and off-origin cards are not activated', async () => {
  for (const options of [{ completed: true }, { url: 'https://example.org/activity' }, { url: 'javascript:alert(1)' }]) {
    const h = harness(options);
    await vm.runInContext("processQuestsOnPage({id:1}, 'Dashboard')", h.context);
    assert.deepEqual(h.clicked, []);
  }
});
test('signed-out redirect is an explicit error', async () => {
  const h = harness({ page: 'https://rewards.bing.com/about' });
  await assert.rejects(vm.runInContext("processQuestsOnPage({id:1}, 'Dashboard')", h.context), /sign-in/);
});
test('unscoped card links do not trigger a broad fallback click', async () => {
  const h = harness({ unscoped: true });
  await assert.rejects(vm.runInContext("processQuestsOnPage({id:1}, 'Dashboard')", h.context), /layout|section/);
  assert.deepEqual(h.clicked, []);
});
test('stop at the pause gate prevents activation', async () => {
  const h = harness({ stop: true });
  await vm.runInContext("processQuestsOnPage({id:1}, 'Dashboard')", h.context);
  assert.deepEqual(h.clicked, []);
});
test('a tab opened independently by the user is never closed', async () => {
  const h = harness();
  await vm.runInContext("processQuestsOnPage({id:1}, 'Dashboard')", h.context);
  assert.ok(!h.removed.includes(99));
});
test('missing selectors are reported instead of claiming successful completion', async () => {
  const h = harness({ missing: true });
  await assert.rejects(vm.runInContext("processQuestsOnPage({id:1}, 'Dashboard')", h.context), /layout|cards|section/i);
});
test('script injection failure propagates to the engine', async () => {
  const h = harness({ scriptError: true });
  await assert.rejects(vm.runInContext("processQuestsOnPage({id:1}, 'Dashboard')", h.context));
});
