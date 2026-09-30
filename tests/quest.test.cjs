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
    textContent: 'Learn about mountains +10', href: 'https://www.bing.com/search?q=mountains',
    getAttribute: name => name === 'href' ? 'https://www.bing.com/search?q=mountains' : null,
    getBoundingClientRect: () => ({ width: 200, height: 100, left: 0, top: 0 }),
    closest: () => null, querySelector: () => null, scrollIntoView() {},
    click() { clicked.push('mountains'); },
  };
  const document = {
    body: { scrollHeight: 0 },
    querySelectorAll(selector) {
      if (options.missing) return [];
      // Card intentionally exposed ONLY via the class selector used by the old scan,
      // but omitted by the old click lookup.
      if (selector.includes('[class*="card"]') || selector === 'a[href]') return [card];
      return [];
    }
  };
  const state = { current: 0, total: 0 };
  const context = vm.createContext({
    URL, console, document, location: { href: 'https://rewards.bing.com/dashboard' },
    window: { scrollTo() {}, scrollBy() {} }, setTimeout: f => { f(); },
    state, shouldStop: false, update: p => Object.assign(state, p),
    checkPause: async () => {}, delay: async () => {}, randomInt: a => a, addLog() {},
    waitTabReady: async () => {}, cdpClick: async () => clicked.push('cdp'),
    chrome: {
      scripting: { executeScript: async ({func, args = []}) => {
        if (options.scriptError) throw new Error('injection failed');
        scans++;
        return [{ result: await func(...args) }];
      } },
      tabs: {
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
