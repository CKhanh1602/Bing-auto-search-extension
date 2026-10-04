const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function loadApi() {
  const context = vm.createContext({ URL });
  vm.runInContext(fs.readFileSync('quest-api.js', 'utf8'), context);
  return context;
}

test('dashboard API activities keep only current, incomplete, positive Bing rewards', () => {
  const api = loadApi();
  const shared = 'https://www.bing.com/search?q=sporting+events';
  const payload = { dashboard: {
    dailySetPromotions: {
      '10/01/2026': [{ offerId: 'old', complete: false, pointProgressMax: 10, destinationUrl: 'https://www.bing.com/search?q=old' }],
      '10/02/2026': [
        { offerId: 'done', complete: true, pointProgressMax: 10, destinationUrl: shared },
        { offerId: 'daily', title: 'Upcoming sporting events', complete: false, pointProgressMax: 10, pointProgress: 0, destinationUrl: shared },
        { offerId: 'zero', complete: false, pointProgressMax: 0, destinationUrl: 'https://www.bing.com/search?q=zero' },
        { offerId: 'external', complete: false, pointProgressMax: 10, destinationUrl: 'https://example.com/reward' }
      ]
    },
    morePromotions: [
      { offerId: 'keep', title: 'Learn something new', complete: false, pointProgressMax: 10, pointProgress: 0, destinationUrl: 'https://bing.com/search?q=learn' },
      { offerId: 'search', title: 'Search and earn', complete: false, pointProgressMax: 10, destinationUrl: 'https://www.bing.com/' },
      { offerId: 'progress', title: 'Partly credited', complete: false, pointProgressMax: 10, pointProgress: 10, destinationUrl: 'https://www.bing.com/search?q=credited' }
    ]
  } };
  const activities = api.extractQuestActivities(payload, new Date('2026-10-02T12:00:00Z'));
  assert.equal(JSON.stringify(activities), JSON.stringify([
    { key: 'daily', url: shared, points: 10, section: 'Dashboard' },
    { key: 'keep', url: 'https://bing.com/search?q=learn', points: 10, section: 'Earn' },
    { key: 'search', url: 'https://www.bing.com/', points: 10, section: 'Earn' }
  ]));
});

test('dashboard API parser rejects signed-out and malformed payloads without exposing account data', () => {
  const api = loadApi();
  assert.equal(api.classifyQuestDashboard({}), 'QUEST_SIGN_IN_REQUIRED');
  assert.equal(api.classifyQuestDashboard({ dashboard: { userStatus: { availablePoints: 1 } } }), 'QUEST_API_SCHEMA');
  assert.equal(api.classifyQuestDashboard({ dashboard: { dailySetPromotions: [], morePromotions: {} } }), 'QUEST_API_SCHEMA');
  assert.equal(api.classifyQuestDashboard({ dashboard: { dailySetPromotions: {}, morePromotions: [] } }), null);
});

test('Bing Rewards flyout parser keeps only incomplete positive activities with safe destinations', () => {
  const api = loadApi();
  const payload = {
    isRewardsUser: true,
    userInfo: {
      isRewardsUser: true,
      activities: {
        daily: [{ name: 'daily-new', attributes: {
          type: 'urlreward', title: 'Daily activity', complete: 'false', max: '10', progress: '0',
          daily_set_date: '10/02/2026', destination: 'https://www.bing.com/search?q=daily-new'
        } }],
        nested: { offers: [
          { name: 'done-new', attributes: { type: 'urlreward', title: 'Done', complete: 'true', max: '10', destination: 'https://www.bing.com/search?q=done' } },
          { name: 'zero-new', attributes: { type: 'urlreward', title: 'Info', complete: 'false', max: '0', destination: 'https://www.bing.com/search?q=info' } }
        ] }
      },
      promotions: [
        { name: 'tier-metadata', attributes: { levelTitleMobile: 'Member' } },
        { name: 'earn-new', attributes: { type: 'urlreward', title: 'Keep earning', complete: 'false', max: '5', progress: '0', destination: 'https://bing.com/search?q=earn-new' } },
        { name: 'search-new', attributes: { type: 'search', title: 'Search and earn', complete: 'false', max: '50', destination: 'https://www.bing.com/' } },
        { name: 'external-new', attributes: { type: 'urlreward', title: 'External', complete: 'false', max: '10', destination: 'https://example.com/' } }
      ],
      privateAccountValue: 'do-not-log'
    }
  };
  assert.equal(api.classifyQuestDashboard(payload), null);
  assert.equal(JSON.stringify(api.extractQuestActivities(payload, new Date('2026-10-02T12:00:00Z'))), JSON.stringify([
    { key: 'Dashboard|daily-new|https://www.bing.com/search?q=daily-new', url: 'https://www.bing.com/search?q=daily-new', points: 10, section: 'Dashboard' },
    { key: 'Earn|earn-new|https://bing.com/search?q=earn-new', url: 'https://bing.com/search?q=earn-new', points: 5, section: 'Earn' },
    { key: 'Earn|search-new|https://www.bing.com/', url: 'https://www.bing.com/', points: 50, section: 'Earn' }
  ]));
  assert.equal(api.classifyQuestDashboard({ isRewardsUser: false, userInfo: { activities: {}, promotions: [] } }), 'QUEST_SIGN_IN_REQUIRED');
});

test('signed-in flyout may expose promotions while activities is null', () => {
  const api = loadApi();
  const payload = { isRewardsUser: true, userInfo: {
    isRewardsUser: true,
    activities: null,
    promotions: [{ name: 'promotion-only', attributes: {
      type: 'urlreward', title: 'Promotion-only activity', complete: 'false',
      max: '10', progress: '0', destination: 'https://www.bing.com/search?q=promotion-only'
    } }]
  } };
  assert.equal(api.classifyQuestDashboard(payload), null);
  assert.equal(JSON.stringify(api.extractQuestActivities(payload, new Date('2026-10-02T12:00:00Z'))), JSON.stringify([
    { key: 'Earn|promotion-only|https://www.bing.com/search?q=promotion-only', url: 'https://www.bing.com/search?q=promotion-only', points: 10, section: 'Earn' }
  ]));
});

test('flyout parser rejects stale, hidden and malformed nested activities', () => {
  const api = loadApi();
  const activity = (name, extra = {}) => ({ name, attributes: {
    type: 'urlreward', title: name, complete: 'false', max: '10', progress: '0',
    destination: `https://www.bing.com/search?q=${name}`, ...extra
  } });
  const payload = { isRewardsUser: true, userInfo: { isRewardsUser: true,
    activities: {
      parent: { destination: 'https://www.bing.com/', children: [activity('nested-current', { daily_set_date: '10/02/2026' })] },
      stale: activity('stale', { daily_set_date: '01/01/2020' }),
      hidden: { ...activity('hidden'), isHidden: true },
      test: { ...activity('test'), isTestOnly: true },
      blankDestination: activity('blank-destination', { destination: '   ' })
    }, promotions: [] } };
  assert.equal(JSON.stringify(api.extractQuestActivities(payload, new Date('2026-10-02T12:00:00Z'))), JSON.stringify([
    { key: 'Dashboard|nested-current|https://www.bing.com/search?q=nested-current', url: 'https://www.bing.com/search?q=nested-current', points: 10, section: 'Dashboard' }
  ]));
  assert.equal(api.classifyQuestDashboard({ isRewardsUser: true, userInfo: { isRewardsUser: true, foo: [] } }), 'QUEST_API_SCHEMA');

  const legacyMissingDestination = { dashboard: { dailySetPromotions: { '10/02/2026': [
    { offerId: 'missing-url', complete: false, pointProgressMax: 10 }
  ] }, morePromotions: [] } };
  assert.deepEqual(Array.from(api.extractQuestActivities(legacyMissingDestination, new Date('2026-10-02T12:00:00Z'))), []);
});

test('Auto Quest uses the scriptable Bing flyout read endpoint and never reports activity', () => {
  const background = fs.readFileSync('background.js', 'utf8');
  const start = background.indexOf('async function fetchQuestDashboard');
  const end = background.indexOf('// Engine Orchestrator');
  const apiPath = background.slice(start, end);
  assert.ok(start >= 0, 'missing API fetch implementation');
  assert.match(apiPath, /\/rewards\/panelflyout\/getuserinfo\?channel=BingFlyout&partnerId=BingRewards&timestamp=/);
  assert.match(apiPath, /credentials:\s*['"]include['"]/);
  assert.doesNotMatch(apiPath, /prod\.rewardsplatform\.microsoft\.com|\/api\/getuserinfo\?type=1/);
  assert.doesNotMatch(apiPath, /reportactivity/i);
  assert.doesNotMatch(apiPath, /tabs\.sendMessage/);
});

test('quest execution opens official UI and activates a card instead of opening its destination', async () => {
  const worker = questWorker();
  worker.context.activities = [{ key: 'offer', url: 'https://www.bing.com/search?q=offer', points: 10 }];
  vm.runInContext(`loadQuestActivities = async () => activities.map(item => ({daily:true,autoEligible:true,...item}));
    globalThis.cardClicked = false;
    activateQuestCard = async () => { cardClicked = true; };
    waitForQuestCredit = async () => cardClicked;`, worker.context);
  assert.equal(await vm.runInContext('doQuests()', worker.context), false);
  assert.equal(new URL(worker.opened[0].url).pathname, '/rewards/panelflyout');
  assert.equal(worker.context.cardClicked, true);
});

test('temporary Edge frame readiness retries only reads; activation is pinned and occurs once', async () => {
  const worker = questWorker({ realUi: true });
  worker.context.probeQuestUi = () => {};
  const calls = [];
  worker.context.chrome.scripting = { executeScript: async request => {
    calls.push(request);
    if (calls.length === 1) throw new Error('Frame with ID 0 is showing error page');
    return [{ documentId: 'official-document', result: request.args[1] === 'scan'
        ? { status: 'QUEST_CARD_READY', signature: 'selected-card' } : { status: 'QUEST_CARD_ACTIVATED' } }];
  } };
  await vm.runInContext('activateQuestCard(7, {url:"https://www.bing.com/search?q=offer", points:10})', worker.context);
  assert.equal(calls.length, 3);
  assert.deepEqual(Array.from(calls[2].target.documentIds), ['official-document']);
  assert.equal(calls[2].args[2], 'selected-card');
  assert.equal(calls.filter(call => call.args[1] === 'activate').length, 1);
  assert.equal(worker.context.stopWaiters.size, 0);
});

test('actual DOM signature prevents replay when raw title is missing and rendered alias has a title', async () => {
  const worker=questWorker({realUi:true});
  worker.context.probeQuestUi=()=>{};
  const modes=[];
  worker.context.chrome.scripting={executeScript:async request=>{
    modes.push(request.args[1]);
    return [{documentId:'doc',result:request.args[1]==='scan'
      ? {status:'QUEST_CARD_READY',signature:JSON.stringify(['https://www.bing.com/search?q=same&FORM=flyout','Actual title',10])}
      : {status:'QUEST_CARD_ACTIVATED'}}];
  }};
  await vm.runInContext(`globalThis.physicalCards=new Set();
    activateQuestCard(7,{url:'https://www.bing.com/search?q=same',title:'',points:10},undefined,activeRun,physicalCards)`,worker.context);
  const second=await vm.runInContext(`activateQuestCard(7,{url:'https://www.bing.com/search?q=same&FORM=other',title:'Actual title',points:10},undefined,activeRun,physicalCards)`,worker.context);
  assert.deepEqual(modes,['scan','activate','scan']);
  assert.equal(second,false,'read-only duplicate must not obtain another click permit');
});

test('a frame failure during activation stops without retrying a possibly dispatched click', async () => {
  const worker = questWorker({realUi:true});
  worker.context.probeQuestUi = () => {};
  let calls = 0;
  worker.context.chrome.scripting = {executeScript: async request => {
    calls++;
    if (request.args[1] === 'scan') return [{documentId:'doc',result:{status:'QUEST_CARD_READY',signature:'card'}}];
    throw new Error('Frame with ID 0 is showing error page');
  }};
  await assert.rejects(vm.runInContext('activateQuestCard(7, {})', worker.context), /QUEST_SCRIPT_FAILED/);
  assert.equal(calls, 2);
});

test('a scan-only injection timeout is card readiness failure rather than an uncertain click', async () => {
  const worker = questWorker({realUi:true});
  worker.context.questTimeoutMs = 5;
  worker.context.probeQuestUi = () => {};
  const modes = [];
  worker.context.chrome.scripting = {executeScript: request => { modes.push(request.args[1]); return new Promise(() => {}); }};
  await assert.rejects(vm.runInContext('activateQuestCard(7, {})', worker.context), /QUEST_CARD_NOT_READY/);
  assert.deepEqual(modes, ['scan']);
  assert.equal(worker.context.stopWaiters.size, 0);
});

test('ambiguous UI and an expired injection fail without an automatic activation retry', async () => {
  const worker = questWorker({ realUi: true });
  worker.context.probeQuestUi = () => {};
  let calls = 0;
  worker.context.chrome.scripting = { executeScript: async () => {
    calls++;
    return [{ documentId: 'doc', result: { status: 'QUEST_CARD_AMBIGUOUS' } }];
  } };
  await assert.rejects(vm.runInContext('activateQuestCard(7, {})', worker.context), /QUEST_CARD_AMBIGUOUS/);
  assert.equal(calls, 1);
  calls = 0;
  worker.context.questTimeoutMs = 5;
  worker.context.chrome.scripting.executeScript = request => {
    calls++;
    return request.args[1] === 'scan'
      ? Promise.resolve([{ documentId: 'doc', result: { status: 'QUEST_CARD_READY', signature: 'card' } }])
      : new Promise(() => {});
  };
  await assert.rejects(vm.runInContext('activateQuestCard(7, {})', worker.context), /QUEST_SCRIPT_TIMEOUT/);
  assert.equal(calls, 2);
  assert.equal(worker.context.stopWaiters.size, 0);
});

test('protected origin errors stop activation immediately', async () => {
  const worker = questWorker({ realUi: true });
  worker.context.probeQuestUi = () => {};
  worker.context.chrome.scripting = { executeScript: async () => { throw new Error('The extensions gallery cannot be scripted.'); } };
  await assert.rejects(vm.runInContext('activateQuestCard(7, {})', worker.context), /QUEST_BROWSER_RESTRICTED/);
});

test('Stop revokes a queued activation permit before a delayed injection can request it', async () => {
  const worker = questWorker({ realUi: true });
  worker.context.probeQuestUi = () => {};
  let queued;
  worker.context.chrome.scripting = { executeScript: request => {
    if (request.args[1] === 'scan') return Promise.resolve([{documentId:'doc',result:{status:'QUEST_CARD_READY',signature:'card'}}]);
    queued = request;
    return new Promise(() => {});
  } };
  const run = vm.runInContext('activateQuestCard(7, {})', worker.context);
  while (!queued) await new Promise(resolve => setImmediate(resolve));
  worker.context.shouldStop = true;
  [...worker.context.stopWaiters].forEach(cancel => cancel());
  await assert.rejects(run, /STOPPED/);
  worker.context.lateNonce = queued.args[4];
  worker.context.chrome.runtime = {id:'test'};
  const permit = vm.runInContext(`grantQuestUiPermit({nonce:lateNonce}, {id:'test',tab:{id:7},documentId:'doc',url:'https://www.bing.com/rewards/panelflyout'})`, worker.context);
  assert.equal(permit.ok, false);
  assert.equal(worker.context.stopWaiters.size, 0);
});

test('result-tab close cancels verification but unrelated child tabs are left alone', async () => {
  const worker = questWorker();
  worker.context.activities = [{key:'offer',url:'https://www.bing.com/search?q=offer',points:10}];
  vm.runInContext('loadQuestActivities = async () => activities.map(item => ({daily:true,autoEligible:true,...item}))', worker.context);
  worker.context.activateQuestCard = async () => {
    worker.createChild({id:8,openerTabId:7,pendingUrl:'https://www.bing.com/search?q=offer&FORM=flyout'});
    worker.createChild({id:9,openerTabId:7,url:'https://www.bing.com/search?q=unrelated'});
  };
  let fetched = false;
  worker.context.fetch = (_url, options) => new Promise((_resolve, reject) => {
    fetched = true;
    options.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), {name:'AbortError'})));
  });
  const run = vm.runInContext('doQuests()', worker.context);
  while (!fetched) await new Promise(resolve => setImmediate(resolve));
  worker.closeTab(9);
  assert.equal(worker.context.stopWaiters.size, 1);
  worker.closeTab(8);
  await assert.rejects(run, /TAB_CLOSED/);
  assert.deepEqual(worker.removed, []);
  assert.equal(worker.tabCreatedListeners.size, 0);
  assert.equal(worker.tabUpdatedListeners.size, 0);
});

test('manifest does not inject scripts into Edge-protected Rewards pages', () => {
  const manifest = JSON.parse(fs.readFileSync('manifest.json', 'utf8'));
  const matches = (manifest.content_scripts || []).flatMap(entry => entry.matches || []);
  assert.equal(matches.some(match => /rewards\.(bing|microsoft)\.com/.test(match)), false);
  assert.equal((manifest.host_permissions || []).some(match => /rewards\.(bing|microsoft)\.com/.test(match)), false);
  for (const permission of ['debugger', 'webRequest', 'cookies', 'identity']) {
    assert.equal((manifest.permissions || []).includes(permission), false);
  }
});

function questWorker(options = {}) {
  const source = fs.readFileSync('background.js', 'utf8');
  const start = source.indexOf('async function fetchQuestDashboard');
  const end = source.indexOf('// Engine Orchestrator');
  const opened = [], updated = [], removed = [], logs = [];
  const tabRemovedListeners = new Set();
  const tabCreatedListeners = new Set(), tabUpdatedListeners = new Set();
  let nextTabId = 7;
  const state = { current: 0, total: 0 };
  let context;
  context = vm.createContext({
    URL, Date, AbortController, setTimeout, clearTimeout, crypto: require('node:crypto').webcrypto,
    totalPausedMs: 0, isPaused: false, pauseStartedAt: 0,
    navigator: { onLine: true }, stopWaiters: new Set(), shouldStop: false, activeRun: null,
    questTimeoutMs: 10000, state, addLog: text => logs.push(text), update: patch => Object.assign(state, patch),
    checkPause: options.checkPause || (async () => {}),
    questDelay: async () => { if (options.stopAfterOpen) context.shouldStop = true; },
    waitTabReady: async () => { if (options.tabFailure) throw new Error('TAB_CLOSED'); },
    chrome: { tabs: {
      onCreated: { addListener: f => tabCreatedListeners.add(f), removeListener: f => tabCreatedListeners.delete(f) },
      onUpdated: { addListener: f => tabUpdatedListeners.add(f), removeListener: f => tabUpdatedListeners.delete(f) },
      onRemoved: { addListener: listener => tabRemovedListeners.add(listener),
        removeListener: listener => tabRemovedListeners.delete(listener) },
      create: async props => { opened.push(props); return { id: nextTabId++ }; },
      get: async id => ({id, url: opened[id - 7]?.url}),
      update: async (_id, props) => { updated.push(props); },
      remove: async id => { removed.push(id); }
    } },
    fetch: async () => { throw new Error('unused'); }
  });
  const guardStart = source.indexOf('function assertRun(');
  const guardEnd = source.indexOf('// ============================================================', guardStart);
  vm.runInContext(source.slice(guardStart, guardEnd), context);
  const clockStart = source.indexOf('function activeClock()');
  const clockEnd = source.indexOf('function update(', clockStart);
  assert.ok(clockStart >= 0 && clockEnd > clockStart, 'missing worker clock helpers');
  vm.runInContext(source.slice(clockStart, clockEnd), context);
  const pauseStart = source.indexOf('async function checkQuestPause');
  const pauseEnd = source.indexOf('async function questDelay', pauseStart);
  assert.ok(pauseStart >= 0 && pauseEnd > pauseStart, 'missing cancellable pause helper');
  vm.runInContext(source.slice(pauseStart, pauseEnd), context);
  vm.runInContext(fs.readFileSync('quest-api.js', 'utf8'), context);
  vm.runInContext(source.slice(start, end), context);
  if (!options.realUi) vm.runInContext('activateQuestCard = async () => {}', context);
  if (!options.realRefresh) vm.runInContext('refreshQuestActivity = async activity => ({serverState:"pending",activity})', context);
  return { context, state, opened, updated, removed, logs, tabRemovedListeners, tabCreatedListeners, tabUpdatedListeners,
    createChild: tab => [...tabCreatedListeners].forEach(listener => listener(tab)),
    closeTab: id => [...tabRemovedListeners].forEach(listener => listener(id)) };
}

test('quest API logging preserves actionable safe error codes', async () => {
  for (const code of ['QUEST_SIGN_IN_REQUIRED', 'QUEST_API_SCHEMA']) {
    const worker = questWorker();
    worker.context.errorCode = code;
    vm.runInContext('fetchQuestDashboard = async () => { throw new Error(errorCode); }', worker.context);
    await assert.rejects(vm.runInContext('loadQuestActivities()', worker.context), new RegExp(code));
    assert.equal(worker.logs[0], `Quest API probe: ${code}`);
    assert.doesNotMatch(worker.logs.join('\n'), /QUEST_API_UNAVAILABLE/);
  }
});

test('dashboard fetch distinguishes non-JSON from a changed JSON schema without logging payload data', async () => {
  const nonJson = questWorker();
  nonJson.context.fetch = async () => ({
    ok: true, status: 200, redirected: false,
    url: 'https://www.bing.com/rewards/panelflyout/getuserinfo?timestamp=1',
    headers: { get: name => name.toLowerCase() === 'content-type' ? 'text/html; charset=utf-8' : null },
    json: async () => { throw new SyntaxError('secret html body'); }
  });
  await assert.rejects(vm.runInContext('fetchQuestDashboard(50)', nonJson.context), /QUEST_API_NON_JSON/);
  await assert.rejects(vm.runInContext('loadQuestActivities()', nonJson.context), /QUEST_API_NON_JSON/);
  assert.match(nonJson.logs.join('\n'), /Quest API response: status=200,type=text\/html,redirected=no/);
  assert.doesNotMatch(nonJson.logs.join('\n'), /secret html body/);

  const changed = questWorker();
  changed.context.fetch = async () => ({
    ok: true, status: 200, redirected: false,
    url: 'https://www.bing.com/rewards/panelflyout/getuserinfo?timestamp=1',
    headers: { get: () => 'application/json' },
    json: async () => ({ dashboard: { userStatus: { privateAccountValue: 'do-not-log' } } })
  });
  await assert.rejects(vm.runInContext('loadQuestActivities()', changed.context), /QUEST_API_SCHEMA/);
  assert.match(changed.logs.join('\n'), /Quest API schema: wrapped=yes,user=yes,daily=missing,more=missing/);
  assert.doesNotMatch(changed.logs.join('\n'), /do-not-log|privateAccountValue/);
});

test('Quest reuses official flyout and counts only server-confirmed credit', async () => {
  const worker = questWorker();
  worker.context.activities = [
    { key: 'one', url: 'https://www.bing.com/search?q=one&form=reward', section: 'Dashboard' },
    { key: 'two', url: 'https://bing.com/search?q=two&form=reward', section: 'Earn' }
  ];
  vm.runInContext('loadQuestActivities = async () => activities.map(item => ({daily:true,autoEligible:true,...item}))', worker.context);
  vm.runInContext('waitForQuestCredit = async key => key === "one"', worker.context);
  const needsAction = await vm.runInContext('doQuests()', worker.context);
  assert.equal(needsAction, true);
  assert.equal(JSON.stringify(worker.opened), JSON.stringify([
    { url: 'https://www.bing.com/rewards/panelflyout?channel=BingFlyout&partnerId=BingRewards', active: true },
    { url: 'https://bing.com/search?q=two&form=reward', active: false }
  ]));
  assert.equal(worker.updated.length, 1);
  assert.deepEqual(worker.removed, []);
  assert.equal(worker.state.current, 1);
  assert.equal(worker.state.total, 2);
  assert.match(worker.state.statusText, /1.*2|unverified/i);
});

test('a missing fourth card does not abort the fifth or discard two confirmed activities', async () => {
  const worker = questWorker();
  worker.context.activities = ['one','two','three','four','five'].map(key => ({key,url:`https://www.bing.com/search?q=${key}`,points:10}));
  const attempts = [];
  worker.context.activateQuestCard = async (_id, activity) => {
    attempts.push(activity.key);
    if (activity.key === 'four') throw new Error('QUEST_CARD_NOT_READY');
  };
  vm.runInContext(`loadQuestActivities = async () => activities.map(item => ({daily:true,autoEligible:true,...item}));
    waitForQuestCredit = async key => ['one','two','five'].includes(key);`, worker.context);
  assert.equal(await vm.runInContext('doQuests()', worker.context), true);
  assert.deepEqual(attempts, ['one','two','three','four','five']);
  assert.equal(worker.state.current, 3);
  assert.equal(worker.state.total, 5);
  assert.match(worker.logs.join('\n'), /confirmed=3,manual=2/);
  assert.equal(worker.tabRemovedListeners.size, 0);
});

test('stable offer identity refreshes changed URL, title and points before card activation', async () => {
  const worker = questWorker({realRefresh:true});
  worker.context.activities = [{key:'offer',title:'Old title',points:10,url:'https://www.bing.com/search?q=old'}];
  worker.context.payload = {isRewardsUser:true,userInfo:{activities:null,promotions:[
    {attributes:{offerid:'offer',type:'urlreward',daily_set_date:[...worker.context.questDateKeys(new Date())][0],title:'Current title',max:'5',progress:'0',complete:'false',destination:'https://www.bing.com/search?q=current'}}
  ]}};
  let activated;
  worker.context.activateQuestCard = async (_id, activity) => { activated = activity; };
  vm.runInContext(`loadQuestActivities = async () => activities.map(item => ({daily:true,autoEligible:true,...item}));
    fetchQuestDashboard = async () => payload;
    waitForQuestCredit = async () => true;`, worker.context);
  assert.equal(await vm.runInContext('doQuests()', worker.context), false);
  assert.equal(activated.url, 'https://www.bing.com/search?q=current');
  assert.equal(activated.title, 'Current title');
  assert.equal(activated.points, 5);
});

test('freshly completed or missing offers are never clicked or replaced by another identity', async () => {
  for (const complete of [true, false]) {
    const worker = questWorker({realRefresh:true});
    worker.context.activities = [{key:'offer',points:10,url:'https://www.bing.com/search?q=offer'}];
    worker.context.payload = {isRewardsUser:true,userInfo:{activities:null,promotions:[
      {attributes:{offerid:complete?'offer':'replacement',type:'urlreward',title:'Offer',max:'10',progress:complete?'10':'0',complete:String(complete),destination:'https://www.bing.com/search?q=offer'}}
    ]}};
    let clicks = 0, confirmations = 0;
    worker.context.activateQuestCard = async () => { clicks++; };
    worker.context.waitForQuestCredit = async () => { confirmations++; return true; };
    vm.runInContext('loadQuestActivities = async () => activities.map(item => ({daily:true,autoEligible:true,...item})); fetchQuestDashboard = async () => payload', worker.context);
    assert.equal(await vm.runInContext('doQuests()', worker.context), !complete);
    assert.equal(clicks, 0);
    assert.equal(confirmations, complete?1:0);
    assert.equal(worker.state.current, complete?1:0);
  }
});

test('a changed card that completed during readiness wait is verified rather than clicked again', async () => {
  const worker = questWorker();
  worker.context.activities = [{key:'offer',points:10,url:'https://www.bing.com/search?q=offer'}];
  let reads = 0, attempts = 0;
  worker.context.refreshQuestActivity = async activity => ++reads === 1
    ? {serverState:'pending',activity} : {serverState:'complete',activity:null};
  worker.context.activateQuestCard = async () => { attempts++; throw new Error('QUEST_CARD_NOT_READY'); };
  vm.runInContext('loadQuestActivities = async () => activities.map(item => ({daily:true,autoEligible:true,...item})); waitForQuestCredit = async () => true', worker.context);
  assert.equal(await vm.runInContext('doQuests()', worker.context), false);
  assert.equal(reads, 2);
  assert.equal(attempts, 1);
  assert.equal(worker.state.current, 1);
});

test('uncertain activation and terminal errors are not skipped or retried as missing cards', async () => {
  for (const code of ['QUEST_SCRIPT_TIMEOUT','QUEST_CARD_ACTIVATION_FAILED','QUEST_BROWSER_RESTRICTED','TAB_CLOSED','QUEST_RATE_LIMITED','QUEST_SIGN_IN_REQUIRED','STOPPED']) {
    const worker = questWorker();
    worker.context.activities = ['one','two'].map(key=>({key,points:10,url:`https://www.bing.com/search?q=${key}`}));
    const attempts = [];
    worker.context.activateQuestCard = async (_id, activity) => { attempts.push(activity.key); throw new Error(code); };
    vm.runInContext('loadQuestActivities = async () => activities.map(item => ({daily:true,autoEligible:true,...item}))', worker.context);
    await assert.rejects(vm.runInContext('doQuests()', worker.context), new RegExp(code));
    assert.deepEqual(attempts, ['one']);
    assert.equal(worker.state.current, 0);
    assert.equal(worker.tabRemovedListeners.size, 0);
  }
});

test('conflicting current metadata for a stable identity cannot choose the first URL to click', () => {
  const api = loadApi();
  const offer = destination => ({attributes:{offerid:'same-id',type:'urlreward',title:'Offer',max:'10',complete:'false',destination}});
  const payload = {isRewardsUser:true,userInfo:{activities:null,promotions:[offer('https://www.bing.com/search?q=first'),offer('https://www.bing.com/search?q=second')]}};
  assert.equal(api.extractQuestActivities(payload, new Date(), true).length, 0);
});

test('unverified destination stays open and is never reported as completed', async () => {
  const worker = questWorker();
  worker.context.activities = [
    { key: 'pending', url: 'https://www.bing.com/search?q=pending&form=reward', section: 'Dashboard' }
  ];
  vm.runInContext('loadQuestActivities = async () => activities.map(item => ({daily:true,autoEligible:true,...item})); waitForQuestCredit = async () => false', worker.context);
  const needsAction = await vm.runInContext('doQuests()', worker.context);
  assert.equal(needsAction, true);
  assert.equal(worker.state.current, 0);
  assert.equal(worker.state.total, 1);
  assert.deepEqual(worker.removed, []);
  assert.match(worker.logs.join('\n'), /not confirmed/i);
});

test('credit verification requires two consecutive affirmative completion observations', async () => {
  const worker = questWorker();
  worker.context.pendingPayload = { dashboard: { dailySetPromotions: {}, morePromotions: [
    { offerId: 'offer', title: 'Still pending', complete: false, pointProgressMax: 10,
      pointProgress: 0, destinationUrl: 'https://www.bing.com/search?q=offer' }
  ] } };
  worker.context.completePayload = { dashboard: { dailySetPromotions: {}, morePromotions: [
    { offerId: 'offer', title: 'Complete', complete: true, pointProgressMax: 10,
      pointProgress: 10, destinationUrl: 'https://www.bing.com/search?q=offer' }
  ] } };
  vm.runInContext(`
    globalThis.verifyProbes = 0;
    fetchQuestDashboard = async () => {
      verifyProbes++;
      return verifyProbes === 2 ? pendingPayload : completePayload;
    };
    questDelay = async () => {};
  `, worker.context);
  assert.equal(await vm.runInContext('waitForQuestCredit("offer", 1000)', worker.context), true);
  assert.equal(worker.context.verifyProbes, 4);
});

test('transient verification network errors retry without claiming credit', async () => {
  const worker = questWorker();
  worker.context.completePayload = { dashboard: { dailySetPromotions: {}, morePromotions: [
    { offerId: 'offer', complete: true, pointProgressMax: 10, pointProgress: 10,
      destinationUrl: 'https://www.bing.com/search?q=offer' }
  ] } };
  vm.runInContext(`
    globalThis.verifyProbes = 0;
    fetchQuestDashboard = async () => {
      verifyProbes++;
      if (verifyProbes === 1) throw new Error('QUEST_API_NETWORK');
      return completePayload;
    };
    questDelay = async () => {};
  `, worker.context);
  assert.equal(await vm.runInContext('waitForQuestCredit("offer", 1000)', worker.context), true);
  assert.equal(worker.context.verifyProbes, 3);
  assert.match(worker.logs.join('\n'), /verification retry: QUEST_API_NETWORK/);
});

test('missing or filtered offer evidence remains inconclusive and never credits', async () => {
  const api = loadApi();
  const missing = { dashboard: { dailySetPromotions: {}, morePromotions: [] } };
  const changed = { dashboard: { dailySetPromotions: {}, morePromotions: [
    { offerId: 'offer', complete: false, pointProgressMax: 10, pointProgress: 0 }
  ] } };
  assert.equal(api.questActivityServerState(missing, 'offer'), 'unknown');
  assert.equal(api.questActivityServerState(changed, 'offer'), 'pending');

  const worker = questWorker();
  worker.context.missingPayload = missing;
  vm.runInContext(`
    fetchQuestDashboard = async () => missingPayload;
    questDelay = async () => {};
  `, worker.context);
  assert.equal(await vm.runInContext('waitForQuestCredit("offer", 5)', worker.context), false);
});

test('distinct offer IDs sharing one destination remain distinct activities', () => {
  const api = loadApi();
  const destination = 'https://www.bing.com/search?q=shared';
  const payload = { dashboard: { dailySetPromotions: {}, morePromotions: [
    { offerId: 'first', title: 'First', complete: false, pointProgressMax: 5,
      pointProgress: 0, destinationUrl: destination },
    { offerId: 'second', title: 'Second', complete: false, pointProgressMax: 10,
      pointProgress: 0, destinationUrl: destination }
  ] } };
  const activities = api.extractQuestActivities(payload, new Date('2026-10-02T12:00:00Z'));
  assert.equal(activities.length, 2);
  assert.deepEqual(Array.from(activities, item => item.key), ['first', 'second']);
});

test('archived completion and contradictory duplicate records cannot confirm a current offer', () => {
  const api = loadApi();
  const now = new Date('2026-10-02T12:00:00Z');
  const destinationUrl = 'https://www.bing.com/search?q=shared';
  const pending = { offerId: 'daily', complete: false, pointProgressMax: 10,
    pointProgress: 0, destinationUrl };
  const complete = { ...pending, complete: true, pointProgress: 10 };
  const payload = { dashboard: { dailySetPromotions: {
    '10/01/2026': [complete], '10/02/2026': [pending]
  }, morePromotions: [] } };
  assert.equal(api.questActivityServerState(payload, 'daily', now), 'pending');
  payload.dashboard.dailySetPromotions['10/02/2026'] = [complete, pending];
  assert.equal(api.questActivityServerState(payload, 'daily', now), 'pending');
  payload.dashboard.dailySetPromotions['10/02/2026'] = [complete];
  assert.equal(api.questActivityServerState(payload, 'daily', now), 'complete');
});

test('flyout verification uses the same dated section identity as discovery', () => {
  const api = loadApi();
  const now = new Date('2026-10-02T12:00:00Z');
  const item = { name: 'daily-offer', attributes: { type: 'urlreward', complete: 'false',
    max: '10', progress: '0', daily_set_date: '10/02/2026',
    destination: 'https://www.bing.com/search?q=offer' } };
  const payload = { isRewardsUser: true, userInfo: { activities: null, promotions: [item] } };
  const activity = api.extractQuestActivities(payload, now)[0];
  assert.equal(api.questActivityServerState(payload, activity.key, now), 'pending');
  item.attributes.complete = 'true';
  assert.equal(api.questActivityServerState(payload, activity.key, now), 'complete');
  item.attributes.daily_set_date = '10/01/2026';
  assert.equal(api.questActivityServerState(payload, activity.key, now), 'unknown');
});

test('affirmative stable-ID completion remains observable without its destination', () => {
  const api = loadApi();
  const dashboard = { dashboard: { dailySetPromotions: {}, morePromotions: [
    { offerId: 'offer', complete: true, pointProgressMax: 10, pointProgress: 10 }
  ] } };
  const flyout = { isRewardsUser: true, userInfo: { activities: null, promotions: [
    { name: 'offer', attributes: { offerid: 'offer', complete: 'true', max: '10', progress: '10' } }
  ] } };
  assert.equal(api.questActivityServerState(dashboard, 'offer'), 'complete');
  assert.equal(api.questActivityServerState(flyout, 'offer'), 'complete');
});

test('verification timeout keeps the activity unconfirmed', async () => {
  const worker = questWorker();
  vm.runInContext(`
    fetchQuestDashboard = async () => { throw new Error('QUEST_API_TIMEOUT'); };
  `, worker.context);
  assert.equal(await vm.runInContext('waitForQuestCredit("offer", 1000)', worker.context), false);
});

test('Stop interrupts credit verification without closing an unconfirmed tab', async () => {
  const worker = questWorker({ stopAfterOpen: true });
  worker.context.activities = [
    { key: 'pending', url: 'https://www.bing.com/search?q=pending', section: 'Dashboard' }
  ];
  worker.context.pendingPayload = { dashboard: { dailySetPromotions: {}, morePromotions: [
    { offerId: 'pending', title: 'Pending', complete: false, pointProgressMax: 10,
      destinationUrl: 'https://www.bing.com/search?q=pending' }
  ] } };
  vm.runInContext(`
    loadQuestActivities = async () => activities.map(item => ({daily:true,autoEligible:true,...item}));
    fetchQuestDashboard = async () => pendingPayload;
  `, worker.context);
  await assert.rejects(vm.runInContext('doQuests()', worker.context), /STOPPED/);
  assert.deepEqual(worker.removed, []);
  assert.equal(worker.state.current, 0);
});

test('invalid activity destinations fail before any tab is opened', async () => {
  const worker = questWorker();
  worker.context.activities = [
    { key: 'unsafe', url: 'javascript:alert(1)', section: 'Dashboard' }
  ];
  vm.runInContext('loadQuestActivities = async () => activities.map(item => ({daily:true,autoEligible:true,...item}))', worker.context);
  await assert.rejects(vm.runInContext('doQuests()', worker.context), /QUEST_DESTINATION_INVALID/);
  assert.deepEqual(worker.opened, []);
  assert.equal(worker.state.current, 0);
});

test('activity navigation failure keeps the page open for inspection', async () => {
  const failed = questWorker({ tabFailure: true });
  failed.context.activities = [{ key: 'one', url: 'https://www.bing.com/search?q=one', section: 'Dashboard' }];
  vm.runInContext('loadQuestActivities = async () => activities.map(item => ({daily:true,autoEligible:true,...item}))', failed.context);
  await assert.rejects(vm.runInContext('doQuests()', failed.context), /TAB_CLOSED/);
  assert.deepEqual(failed.removed, []);
  assert.equal(failed.state.current, 0);
});

test('closing an activity tab during verification aborts the request and fails promptly', async () => {
  const worker = questWorker();
  worker.context.activities = [{ key: 'offer', url: 'https://www.bing.com/search?q=offer', section: 'Earn' }];
  vm.runInContext('loadQuestActivities = async () => activities.map(item => ({daily:true,autoEligible:true,...item}))', worker.context);
  let fetched = false;
  worker.context.fetch = (_url, options) => new Promise((_resolve, reject) => {
    fetched = true;
    options.signal.addEventListener('abort', () => {
      const error = new Error('aborted'); error.name = 'AbortError'; reject(error);
    }, { once: true });
  });
  worker.context.questTimeoutMs = 200;
  const run = vm.runInContext('doQuests()', worker.context);
  while (!fetched) await new Promise(resolve => setImmediate(resolve));
  worker.closeTab(7);
  await assert.rejects(run, /TAB_CLOSED/);
  assert.equal(worker.state.current, 0);
  assert.deepEqual(worker.removed, []);
  assert.equal(worker.tabRemovedListeners.size, 0);
  assert.equal(worker.context.stopWaiters.size, 0);
});

test('closing a loaded activity while paused cancels the run without requiring Resume', async () => {
  let pauseCalls = 0;
  const worker = questWorker({ checkPause: async () => {
    pauseCalls++;
    if (pauseCalls === 2) await new Promise(() => {});
  } });
  worker.context.activities = [{ key: 'offer', url: 'https://www.bing.com/search?q=offer', section: 'Earn' }];
  vm.runInContext('loadQuestActivities = async () => activities.map(item => ({daily:true,autoEligible:true,...item}))', worker.context);
  const run = vm.runInContext('doQuests()', worker.context);
  while (pauseCalls < 2) await new Promise(resolve => setImmediate(resolve));
  worker.closeTab(7);
  await assert.rejects(run, /TAB_CLOSED/);
  assert.equal(worker.tabRemovedListeners.size, 0);
  assert.equal(worker.state.current, 0);
  assert.deepEqual(worker.removed, []);
});

test('Stop before the first activity opens no tab', async () => {
  const worker = questWorker({ checkPause: async () => { worker.context.shouldStop = true; } });
  worker.context.activities = [{ key: 'one', url: 'https://www.bing.com/search?q=one', section: 'Dashboard' }];
  vm.runInContext('loadQuestActivities = async () => activities.map(item => ({daily:true,autoEligible:true,...item}))', worker.context);
  await assert.rejects(vm.runInContext('doQuests()', worker.context), /STOPPED/);
  assert.deepEqual(worker.opened, []);
  assert.equal(worker.state.current, 0);
});

test('dashboard fetch distinguishes network, offline, HTTP, timeout and Stop', async () => {
  const worker = questWorker();
  worker.context.fetch = async () => { throw new TypeError('network failed'); };
  await assert.rejects(vm.runInContext('fetchQuestDashboard(50)', worker.context), /QUEST_API_NETWORK/);
  assert.equal(worker.context.stopWaiters.size, 0);

  worker.context.navigator.onLine = false;
  await assert.rejects(vm.runInContext('fetchQuestDashboard(50)', worker.context), /NETWORK_OFFLINE/);
  worker.context.navigator.onLine = true;

  worker.context.fetch = async () => ({ ok: false, status: 503,
    url: 'https://www.bing.com/rewards/panelflyout/getuserinfo?timestamp=1' });
  await assert.rejects(vm.runInContext('fetchQuestDashboard(50)', worker.context), /QUEST_API_HTTP/);

  worker.context.fetch = (_url, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener('abort', () => {
      const error = new Error('aborted');
      error.name = 'AbortError';
      reject(error);
    }, { once: true });
  });
  await assert.rejects(vm.runInContext('fetchQuestDashboard(5)', worker.context), /QUEST_API_TIMEOUT/);
  assert.equal(worker.context.stopWaiters.size, 0);

  worker.context.shouldStop = false;
  const pending = vm.runInContext('fetchQuestDashboard(1000)', worker.context);
  await new Promise(resolve => setImmediate(resolve));
  worker.context.shouldStop = true;
  vm.runInContext('[...stopWaiters][0]()', worker.context);
  await assert.rejects(pending, /STOPPED/);
  assert.equal(worker.context.stopWaiters.size, 0);
});

test('dashboard fetch rejects malformed or unexpected final response URLs', async () => {
  for (const [responseUrl, expected] of [
    ['', 'QUEST_API_HTTP'],
    ['http://www.bing.com/rewards/panelflyout/getuserinfo', 'QUEST_API_HTTP'],
    ['https://www.bing.com:444/rewards/panelflyout/getuserinfo', 'QUEST_API_HTTP'],
    ['https://www.bing.com/rewards/other', 'QUEST_API_HTTP'],
    ['https://login.live.com/rewards/panelflyout/getuserinfo', 'QUEST_SIGN_IN_REQUIRED']
  ]) {
    const worker = questWorker();
    worker.context.fetch = async () => ({ ok: true, status: 200, redirected: true,
      url: responseUrl, headers: { get: () => 'application/json' }, json: async () => ({}) });
    await assert.rejects(vm.runInContext('fetchQuestDashboard(50)', worker.context), new RegExp(expected));
  }
});

test('transient API failures retry within the configured budget', async () => {
  const worker = questWorker();
  worker.context.payload = { dashboard: { dailySetPromotions: {}, morePromotions: [
    { offerId: 'retry-ok', title: 'Retry reward', complete: false, pointProgressMax: 5,
      destinationUrl: 'https://www.bing.com/search?q=retry' }
  ] } };
  vm.runInContext(`
    globalThis.probes = 0;
    fetchQuestDashboard = async () => {
      probes++;
      if (probes < 3) throw new Error('QUEST_API_NETWORK');
      return payload;
    };
  `, worker.context);
  const activities = await vm.runInContext('loadQuestActivities()', worker.context);
  assert.equal(worker.context.probes, 3);
  assert.equal(activities.length, 1);
  assert.equal(activities[0].key, 'retry-ok');
});

test('HTTP 429 stops immediately without retrying the Rewards flyout', async () => {
  const worker = questWorker();
  let calls = 0;
  worker.context.fetch = async () => {
    calls++;
    return { ok: false, status: 429,
      url: 'https://www.bing.com/rewards/panelflyout/getuserinfo?timestamp=1' };
  };
  await assert.rejects(vm.runInContext('loadQuestActivities()', worker.context), /QUEST_RATE_LIMITED/);
  assert.equal(calls, 1);
  assert.deepEqual(worker.logs, ['Quest API probe: QUEST_RATE_LIMITED']);
});

test('Pause time does not consume the flyout retry budget', async () => {
  let pauseCalls = 0;
  const worker = questWorker({ checkPause: async () => {
    pauseCalls++;
    if (pauseCalls === 1) {
      const pausedAt = Date.now();
      await new Promise(resolve => setTimeout(resolve, 50));
      worker.context.totalPausedMs += Date.now() - pausedAt;
    }
  } });
  worker.context.questTimeoutMs = 20;
  worker.context.payload = { isRewardsUser: true, userInfo: { isRewardsUser: true,
    activities: {}, promotions: [] } };
  vm.runInContext(`
    globalThis.probes = 0;
    fetchQuestDashboard = async () => {
      probes++;
      if (probes === 1) throw new Error('QUEST_API_NETWORK');
      return payload;
    };
    questDelay = async () => { await checkPause(); };
  `, worker.context);
  const result = await vm.runInContext('loadQuestActivities()', worker.context);
  assert.equal(worker.context.probes, 2);
  assert.equal(result.length, 0);
});

test('Pause after verification blocks credit until Resume', async () => {
  let pauseCalls = 0;
  let resume;
  const worker = questWorker({ checkPause: async () => {
    pauseCalls++;
    if (pauseCalls === 4) await new Promise(resolve => { resume = resolve; });
  } });
  worker.context.activities = [
    { key: 'confirmed', url: 'https://www.bing.com/search?q=confirmed', section: 'Earn' }
  ];
  vm.runInContext('loadQuestActivities = async () => activities.map(item => ({daily:true,autoEligible:true,...item})); waitForQuestCredit = async () => true', worker.context);
  const run = vm.runInContext('doQuests()', worker.context);
  while (pauseCalls < 4) await new Promise(resolve => setImmediate(resolve));
  assert.equal(worker.state.current, 0);
  assert.deepEqual(worker.removed, []);
  resume();
  assert.equal(await run, false);
  assert.equal(worker.state.current, 1);
  assert.deepEqual(worker.removed, []);
});

test('Pause gate prevents activity navigation until Resume releases it', async () => {
  let calls = 0, resume;
  const worker = questWorker({
    checkPause: async () => {
      calls++;
      if (calls === 1) await new Promise(resolve => { resume = resolve; });
    }
  });
  worker.context.activities = [
    { key: 'one', url: 'https://www.bing.com/search?q=one', section: 'Dashboard' }
  ];
  vm.runInContext('loadQuestActivities = async () => activities.map(item => ({daily:true,autoEligible:true,...item})); waitForQuestCredit = async () => false', worker.context);
  const run = vm.runInContext('doQuests()', worker.context);
  while (calls < 1) await new Promise(resolve => setImmediate(resolve));
  assert.equal(worker.opened.length, 0);
  assert.equal(worker.updated.length, 0);
  assert.equal(worker.state.current, 0);
  resume();
  await run;
  assert.equal(worker.opened.length, 2);
  assert.equal(new URL(worker.opened[1].url).pathname, '/search');
  assert.equal(worker.state.current, 0);
});
