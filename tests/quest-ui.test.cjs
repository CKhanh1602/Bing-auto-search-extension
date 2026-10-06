const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function fakeElement(options = {}) {
  const attributes = new Map(Object.entries(options.attributes || {}));
  return {
    hidden: Boolean(options.hidden),
    textContent: options.textContent || '',
    classList: { contains: name => (options.classes || []).includes(name) },
    getAttribute: name => attributes.has(name) ? attributes.get(name) : null,
    hasAttribute: name => attributes.has(name),
    getBoundingClientRect: () => options.rect || { width: 240, height: 80 },
    getClientRects: () => options.noClientRects ? [] : [{}],
    matches: selector => selector.includes(':disabled') && Boolean(options.disabled),
    closest: selector => {
      if (options.hiddenAncestor && selector.includes('[hidden]')) return {};
      if (options.disabledAncestor && selector.includes('[disabled]')) return {};
      return null;
    },
    styleState: options.styleState || { display: 'block', visibility: 'visible', opacity: '1' }
  };
}

function fakeCard(options = {}) {
  const clickState = { count: 0 };
  const anchor = Object.assign(fakeElement({
    disabled: options.disabled,
    hidden: options.anchorHidden,
    hiddenAncestor: options.hiddenAncestor,
    disabledAncestor: options.disabledAncestor,
    attributes: {
      href: options.href || '',
      ...(options.ariaDisabled ? { 'aria-disabled': 'true' } : {})
    }
  }), {
    href: options.href || '',
    click: () => { clickState.count++; }
  });
  const title = fakeElement({ textContent: options.title || '' });
  const point = options.points === undefined ? null : fakeElement({ textContent: String(options.points) });
  const card = Object.assign(fakeElement({
    hidden: options.hidden,
    disabled: options.cardDisabled,
    noClientRects: options.noClientRects,
    rect: options.rect,
    styleState: options.styleState,
    attributes: options.cardAriaDisabled ? { 'aria-disabled': 'true' } : {}
  }), {
    querySelector(selector) {
      if (selector === 'a.block[href]') return anchor;
      if (selector === '.promo-title') return title;
      if (selector === '.locked_overlay') return options.lockedOverlay ? fakeElement() : null;
      if (selector === '.pc.complete') return options.complete ? fakeElement() : null;
      if (selector === '.pc.complete .point') return options.complete ? point : null;
      if (selector === '.pc.inprogress') return options.inprogress ? fakeElement() : null;
      if (selector === '.pc.locked_point') return options.lockedPoint ? fakeElement() : null;
      if (selector === '.pc:not(.complete):not(.inprogress):not(.locked_point) .point') {
        return options.complete || options.inprogress || options.lockedPoint ? null : point;
      }
      return null;
    }
  });
  return { card, anchor, clickState };
}

function loadProbe(cards, locationOverrides = {}, contextOverrides = {}) {
  const location = {
    protocol: 'https:', hostname: 'www.bing.com', port: '',
    pathname: '/rewards/panelflyout', ...locationOverrides
  };
  const context = vm.createContext({
    URL,
    location,
    document: { querySelectorAll: selector => selector === '.promo_cont' ? cards.map(item => item.card) : [] },
    getComputedStyle: element => element.styleState,
    ...contextOverrides
  });
  vm.runInContext(fs.readFileSync('quest-ui.js', 'utf8'), context);
  return context;
}

test('scan resolves the site-adjusted FORM link and activate clicks exactly once', () => {
  const card = fakeCard({
    href: 'https://www.bing.com/search?q=quiz&OCID=reward&FORM=flyout-form',
    title: 'Daily quiz', points: '10'
  });
  const context = loadProbe([card]);
  const activity = {
    url: 'https://www.bing.com/search?q=quiz&form=ML2BF1&OCID=reward',
    title: 'Daily quiz', points: 10
  };

  const scan = context.probeQuestUi(activity, 'scan');
  assert.equal(scan.status, 'QUEST_CARD_READY');
  assert.equal(typeof scan.signature, 'string');
  assert.doesNotThrow(() => JSON.stringify(scan));
  assert.equal(card.clickState.count, 0);

  const activated = context.probeQuestUi(activity, 'activate', scan.signature);
  assert.equal(activated.status, 'QUEST_CARD_ACTIVATED');
  assert.equal(activated.signature, scan.signature);
  assert.equal(card.clickState.count, 1);
});

test('probe runs only on the exact secure Bing flyout page', () => {
  const activity = { url: 'https://www.bing.com/search?q=quiz', title: 'Quiz', points: 5 };
  for (const changedLocation of [
    { protocol: 'http:' },
    { hostname: 'bing.com' },
    { hostname: 'www.bing.com.example' },
    { port: '444' },
    { pathname: '/rewards/panelflyout/' },
    { pathname: '/search' }
  ]) {
    const card = fakeCard({ href: activity.url, title: activity.title, points: activity.points });
    const result = loadProbe([card], changedLocation).probeQuestUi(activity, 'scan');
    assert.equal(result.status, 'QUEST_PAGE_INVALID');
    assert.equal(card.clickState.count, 0);
  }
});

test('completed card evidence suppresses stale pending duplicate without any click', () => {
  const href = 'https://www.bing.com/search?q=shared&FORM=reward';
  const complete = fakeCard({ href, title: 'Shared offer', points: 10, complete: true });
  const pending = fakeCard({ href, title: 'Shared offer', points: 10 });
  const context = loadProbe([complete, pending]);
  const activity = { url: href, title: 'Shared offer', points: 10 };
  const scan = context.probeQuestUi(activity, 'scan');

  assert.equal(scan.status, 'QUEST_CARD_COMPLETE');
  assert.equal(context.probeQuestUi(activity, 'activate', scan.signature).status, 'QUEST_CARD_COMPLETE');
  assert.equal(complete.clickState.count, 0);
  assert.equal(pending.clickState.count, 0);
});

test('completed exact card returns immediately but unrelated completed cards do not imply credit', () => {
  const activity = { url: 'https://www.bing.com/search?q=done', title: 'Done', points: 10 };
  const card = fakeCard({ href: activity.url, title: activity.title, points: 10, complete: true });
  assert.equal(loadProbe([card]).probeQuestUi(activity, 'scan').status, 'QUEST_CARD_COMPLETE');
  assert.equal(card.clickState.count, 0);
  for (const changed of [{ ...activity, title: 'Other' }, { ...activity, points: 5 },
    { ...activity, url: 'https://www.bing.com/search?q=other' }]) {
    assert.equal(loadProbe([card]).probeQuestUi(changed, 'scan').status, 'QUEST_CARD_NOT_READY');
  }
});

test('zero or missing point controls and non-pending card states are ignored', () => {
  const href = 'https://www.bing.com/search?q=offer';
  const cards = [
    fakeCard({ href, title: 'Offer', points: 0 }),
    fakeCard({ href, title: 'Offer' }),
    fakeCard({ href, title: 'Offer', points: 10, inprogress: true }),
    fakeCard({ href, title: 'Offer', points: 10, lockedPoint: true }),
    fakeCard({ href, title: 'Offer', points: 10, lockedOverlay: true })
  ];
  const result = loadProbe(cards).probeQuestUi({ url: href, title: 'Offer', points: 10 }, 'scan');
  assert.equal(result.status, 'QUEST_CARD_NOT_READY');
  assert.equal(cards.reduce((sum, item) => sum + item.clickState.count, 0), 0);
});

test('hidden and disabled cards cannot be selected', () => {
  const href = 'https://www.bing.com/search?q=offer';
  const cards = [
    fakeCard({ href, title: 'Offer', points: 10, hidden: true }),
    fakeCard({ href, title: 'Offer', points: 10, noClientRects: true }),
    fakeCard({ href, title: 'Offer', points: 10, rect: { width: 0, height: 80 } }),
    fakeCard({ href, title: 'Offer', points: 10, styleState: { display: 'none', visibility: 'visible', opacity: '1' } }),
    fakeCard({ href, title: 'Offer', points: 10, disabled: true }),
    fakeCard({ href, title: 'Offer', points: 10, ariaDisabled: true }),
    fakeCard({ href, title: 'Offer', points: 10, hiddenAncestor: true }),
    fakeCard({ href, title: 'Offer', points: 10, disabledAncestor: true }),
    fakeCard({ href, title: 'Offer', points: 10, cardAriaDisabled: true })
  ];
  const result = loadProbe(cards).probeQuestUi({ url: href, title: 'Offer', points: 10 }, 'scan');
  assert.equal(result.status, 'QUEST_CARD_NOT_READY');
});

test('multiple pending matches fail closed without a click', () => {
  const activity = { url: 'https://www.bing.com/search?q=shared', title: 'Shared', points: 5 };
  const first = fakeCard({ href: activity.url, title: activity.title, points: activity.points });
  const second = fakeCard({ href: activity.url, title: activity.title, points: activity.points });
  const context = loadProbe([first, second]);

  assert.equal(context.probeQuestUi(activity, 'scan').status, 'QUEST_CARD_AMBIGUOUS');
  assert.equal(context.probeQuestUi(activity, 'activate', 'anything').status, 'QUEST_CARD_AMBIGUOUS');
  assert.equal(first.clickState.count + second.clickState.count, 0);
});

test('activation rechecks the scan signature and current page before clicking', () => {
  const activity = { url: 'https://www.bing.com/search?q=offer', title: 'Offer', points: 5 };
  const card = fakeCard({ href: activity.url, title: activity.title, points: activity.points });
  const context = loadProbe([card]);
  const scan = context.probeQuestUi(activity, 'scan');

  assert.equal(context.probeQuestUi(activity, 'activate', scan.signature + '-changed').status, 'QUEST_CARD_CHANGED');
  assert.equal(card.clickState.count, 0);
  context.location.pathname = '/search';
  assert.equal(context.probeQuestUi(activity, 'activate', scan.signature).status, 'QUEST_PAGE_INVALID');
  assert.equal(card.clickState.count, 0);
});

test('URL, title and point matching fail closed except for FORM key normalization', () => {
  const expected = { url: 'https://www.bing.com/search?q=quiz&form=ONE', title: 'Exact title', points: 10 };
  const cards = [
    fakeCard({ href: 'https://evil.example/search?q=quiz&FORM=ONE', title: expected.title, points: 10 }),
    fakeCard({ href: 'https://www.bing.com/search?q=Quiz&FORM=ONE', title: expected.title, points: 10 }),
    fakeCard({ href: 'https://www.bing.com/search?q=quiz&FORM=ONE', title: 'Different title', points: 10 }),
    fakeCard({ href: 'https://www.bing.com/search?q=quiz&FORM=ONE', title: expected.title, points: 5 })
  ];
  assert.equal(loadProbe(cards).probeQuestUi(expected, 'scan').status, 'QUEST_CARD_NOT_READY');
});

test('FORM value is page-owned while every other query value remains exact', () => {
  const activity = {
    url: 'https://www.bing.com/search?q=quiz&form=reward&rnoreward=1',
    title: 'Exact title', points: 10
  };
  const transformed = fakeCard({
    href: 'https://www.bing.com/search?rnoreward=1&q=quiz&FORM=flyout',
    title: activity.title, points: activity.points
  });
  assert.equal(loadProbe([transformed]).probeQuestUi(activity, 'scan').status, 'QUEST_CARD_READY');

  const changedOtherParameter = fakeCard({
    href: 'https://www.bing.com/search?rnoreward=0&q=quiz&FORM=flyout',
    title: activity.title, points: activity.points
  });
  assert.equal(loadProbe([changedOtherParameter]).probeQuestUi(activity, 'scan').status,
    'QUEST_CARD_NOT_READY');
});

test('invalid modes and activity metadata never inspect or activate cards', () => {
  const card = fakeCard({ href: 'https://www.bing.com/search?q=offer', title: 'Offer', points: 5 });
  const context = loadProbe([card]);
  for (const [mode, activity] of [
    ['other', { url: card.anchor.href, points: 5 }],
    ['scan', null],
    ['scan', { url: 'javascript:alert(1)', points: 5 }],
    ['scan', { url: 'https://user:secret@www.bing.com/search?q=offer', points: 5 }],
    ['scan', { url: card.anchor.href, points: 0 }],
    ['scan', { url: card.anchor.href, points: 5, title: 123 }]
  ]) {
    assert.equal(context.probeQuestUi(activity, mode).status, 'QUEST_ACTIVITY_INVALID');
  }
  assert.equal(card.clickState.count, 0);
});

test('expired activation fails synchronously before invoking the page handler', () => {
  const activity = { url: 'https://www.bing.com/search?q=offer', title: 'Offer', points: 5 };
  const card = fakeCard({ href: activity.url, title: activity.title, points: activity.points });
  const context = loadProbe([card]);
  const scan = context.probeQuestUi(activity, 'scan');

  assert.equal(scan.status, 'QUEST_CARD_READY');
  assert.equal(context.probeQuestUi(activity, 'activate', scan.signature, Date.now() - 1).status,
    'QUEST_SCRIPT_TIMEOUT');
  assert.equal(card.clickState.count, 0);
});

test('deadline is checked again immediately before the synchronous click', () => {
  const activity = { url: 'https://www.bing.com/search?q=offer', title: 'Offer', points: 5 };
  const card = fakeCard({ href: activity.url, title: activity.title, points: activity.points });
  let nowCalls = 0;
  const context = loadProbe([card], {}, { Date: { now: () => ++nowCalls === 1 ? 50 : 101 } });
  const scan = context.probeQuestUi(activity, 'scan');

  assert.equal(scan.status, 'QUEST_CARD_READY');
  assert.equal(context.probeQuestUi(activity, 'activate', scan.signature, 100).status,
    'QUEST_SCRIPT_TIMEOUT');
  assert.equal(card.clickState.count, 0);
});

test('activation nonce obtains one short permit before the single click', async () => {
  const activity = { url: 'https://www.bing.com/search?q=offer', title: 'Offer', points: 5 };
  const card = fakeCard({ href: activity.url, title: activity.title, points: activity.points });
  const messages = [];
  const context = loadProbe([card], {}, { chrome: { runtime: { sendMessage: async message => {
    messages.push(message);
    return { ok: true, expiresAt: Date.now() + 250 };
  } } } });
  const scan = context.probeQuestUi(activity, 'scan');
  const activated = await context.probeQuestUi(activity, 'activate', scan.signature,
    Date.now() + 1000, 'one-use-nonce');

  assert.equal(activated.status, 'QUEST_CARD_ACTIVATED');
  assert.equal(card.clickState.count, 1);
  assert.equal(JSON.stringify(messages), JSON.stringify([
    { action: 'QUEST_UI_PERMIT', nonce: 'one-use-nonce' }
  ]));
});

test('Stop and Pause permit denials prevent a queued activation', async () => {
  for (const error of ['STOPPED', 'PAUSED']) {
    const activity = { url: 'https://www.bing.com/search?q=offer', title: 'Offer', points: 5 };
    const card = fakeCard({ href: activity.url, title: activity.title, points: activity.points });
    const context = loadProbe([card], {}, { chrome: { runtime: {
      sendMessage: async () => ({ ok: false, error })
    } } });
    const scan = context.probeQuestUi(activity, 'scan');
    const denied = await context.probeQuestUi(activity, 'activate', scan.signature,
      Date.now() + 1000, 'one-use-nonce');

    assert.equal(denied.status, error);
    assert.equal(card.clickState.count, 0);
  }
});

test('missing or failed permit endpoint denies activation without clicking', async () => {
  const activity = { url: 'https://www.bing.com/search?q=offer', title: 'Offer', points: 5 };
  for (const chromeValue of [undefined, { runtime: { sendMessage: async () => { throw new Error('closed'); } } }]) {
    const card = fakeCard({ href: activity.url, title: activity.title, points: activity.points });
    const context = loadProbe([card], {}, { chrome: chromeValue });
    const scan = context.probeQuestUi(activity, 'scan');
    const denied = await context.probeQuestUi(activity, 'activate', scan.signature,
      Date.now() + 1000, 'one-use-nonce');

    assert.equal(denied.status, 'QUEST_ACTIVATION_DENIED');
    assert.equal(card.clickState.count, 0);
  }
});

test('missing scan diagnostics distinguish URL, title and completed-state drift without content', () => {
  const activity = { url: 'https://www.bing.com/search?q=expected', title: 'Expected title', points: 10 };

  const wrongUrl = loadProbe([fakeCard({
    href: 'https://www.bing.com/search?q=changed', title: activity.title, points: activity.points
  })]).probeQuestUi(activity, 'scan');
  assert.deepEqual(JSON.parse(JSON.stringify(wrongUrl)), {
    status: 'QUEST_CARD_NOT_READY',
    diagnostic: { cards: 1, visible: 1, pending: 1, urlMatches: 0, titleMatches: 0,
      pointMatches: 0, completed: 0, inprogress: 0, locked: 0 }
  });

  const changedTitle = loadProbe([fakeCard({
    href: activity.url, title: 'Changed title', points: activity.points
  })]).probeQuestUi(activity, 'scan');
  assert.deepEqual(JSON.parse(JSON.stringify(changedTitle)), {
    status: 'QUEST_CARD_NOT_READY',
    diagnostic: { cards: 1, visible: 1, pending: 1, urlMatches: 1, titleMatches: 0,
      pointMatches: 0, completed: 0, inprogress: 0, locked: 0 }
  });

  const completed = loadProbe([fakeCard({
    href: activity.url, title: activity.title, points: activity.points, complete: true
  })]).probeQuestUi(activity, 'scan');
  assert.deepEqual(JSON.parse(JSON.stringify(completed)), {
    status: 'QUEST_CARD_COMPLETE'
  });

  for (const probe of [wrongUrl, changedTitle, completed]) {
    assert.doesNotMatch(JSON.stringify(probe), /Expected title|Changed title|https:\/\/|q=expected|q=changed/);
  }
});

test('scan diagnostics count state exclusions and cap every field at 500', () => {
  const activity = { url: 'https://www.bing.com/search?q=expected', title: 'Expected', points: 10 };
  const cards = [
    fakeCard({ href: activity.url, title: activity.title, points: 10, inprogress: true }),
    fakeCard({ href: activity.url, title: activity.title, points: 10, lockedPoint: true }),
    fakeCard({ href: activity.url, title: activity.title, points: 10, lockedOverlay: true }),
    ...Array.from({ length: 510 }, (_, index) => fakeCard({
      href: `https://www.bing.com/search?q=wrong-${index}`, title: activity.title, points: 10
    }))
  ];
  const probe = loadProbe(cards).probeQuestUi(activity, 'scan');

  assert.equal(probe.status, 'QUEST_CARD_NOT_READY');
  assert.equal(probe.diagnostic.cards, 500);
  assert.equal(probe.diagnostic.inprogress, 1);
  assert.equal(probe.diagnostic.locked, 2);
  for (const value of Object.values(probe.diagnostic)) {
    assert.equal(Number.isFinite(value), true);
    assert.ok(value >= 0 && value <= 500);
  }
});

test('activation misses stay side-effect free and do not return scan diagnostics', () => {
  const activity = { url: 'https://www.bing.com/search?q=expected', title: 'Expected', points: 10 };
  const card = fakeCard({ href: 'https://www.bing.com/search?q=changed', title: activity.title, points: 10 });
  const result = loadProbe([card]).probeQuestUi(activity, 'activate', 'stale-signature', Date.now() + 1000);

  assert.deepEqual(JSON.parse(JSON.stringify(result)), { status: 'QUEST_CARD_NOT_READY' });
  assert.equal(card.clickState.count, 0);
});
