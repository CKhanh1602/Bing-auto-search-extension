const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function harness(activities) {
  const event = () => ({ addListener() {}, removeListener() {} });
  const created = [], clicked = [], storage = {};
  const chrome = {
    runtime: { id: 'test', getURL: p => `chrome-extension://test/${p}`, onMessage: event(), sendMessage: async () => {} },
    storage: { local: { get: async () => storage, set: async data => Object.assign(storage, data) } },
    tabs: { onCreated: event(), onUpdated: event(), onRemoved: event(),
      create: async options => { created.push(options); return { id: created.length + 10, ...options }; },
      update: async (id, options) => ({ id, ...options }), get: (id, cb) => cb ? cb({ id, status: 'complete' }) : Promise.resolve({ id, status: 'complete' }) }
  };
  const context = vm.createContext({ chrome, URL, AbortController, setTimeout, clearTimeout, console: { log() {} }, activities, clicked });
  vm.runInContext(fs.readFileSync('quest-api.js', 'utf8'), context);
  vm.runInContext(fs.readFileSync('background.js', 'utf8'), context);
  vm.runInContext(`loadQuestActivities = async () => activities;
    refreshQuestActivity = async item => ({serverState:'pending',activity:item});
    waitForQuestCredit = async () => true;
    activateQuestCard = async (_tab,item) => clicked.push(item.key);`, context);
  return { context, created, clicked, run: code => vm.runInContext(code, context) };
}
const offer = (key, extra = {}) => ({ key, title: key, points: 10,
  url: `https://www.bing.com/search?q=${key}`, daily: true, autoEligible: true, ...extra });

test('explicit unavailable and unclassified offers hand off; an eligible task is verified', async () => {
  const w = harness([offer('daily'), offer('disabled', {autoEligible:false}), offer('unclassified', {daily:false})]);
  await w.run('stateReady');
  await w.run('runEngine("START_QUEST")');
  assert.deepEqual(w.clicked, ['daily']);
  assert.equal(w.run('state.current'), 1);
  assert.equal(w.run('state.total'), 1);
  assert.equal(w.run('state.manualQuestCount'), 2);
  assert.equal(w.run('state.isRunning'), false);
  assert.deepEqual(w.created.filter(x => x.url.includes('/search?')).map(x => x.url), [offer('disabled').url, offer('unclassified').url]);
});

test('Earn and quiz cards each activate once and count only after completion verification', async () => {
  const w = harness([offer('quiz'), offer('earn', {daily:false,section:'Earn'})]);
  await w.run('stateReady');
  await w.run('runEngine("START_QUEST")');
  assert.deepEqual(w.clicked,['quiz','earn']);
  assert.equal(w.run('state.current'),2);
  assert.equal(w.run('state.total'),2);
  assert.equal(w.run('state.manualQuestCount'),0);
});

test('a quiz click that the server has not confirmed never counts as completed and is not replayed', async () => {
  const w = harness([offer('quiz')]);
  w.run('waitForQuestCredit = async () => false');
  await w.run('stateReady');
  await w.run('runEngine("START_QUEST")');
  assert.deepEqual(w.clicked,['quiz']);
  assert.equal(w.run('state.current'),0);
  assert.equal(w.run('state.total'),1);
  assert.equal(w.run('state.manualQuestCount'),1);
});

test('duplicate source identities cannot activate the same pending physical card twice in one run', async () => {
  const first=offer('raw-key',{title:'Same card'});
  const alias=offer('rendered-key',{title:' Same   card ',url:first.url+'&FORM=flyout',daily:false,section:'Earn'});
  const w=harness([first,alias]);
  w.run('waitForQuestCredit = async () => false');
  await w.run('stateReady');
  await w.run('runEngine("START_QUEST")');
  assert.deepEqual(w.clicked,['raw-key']);
  assert.equal(w.run('state.current'),0);
  await w.run('runEngine("START_QUEST")');
  assert.deepEqual(w.clicked,['raw-key','raw-key'],'a user-started new run gets its own activation guard');
});

test('different card titles with the same destination are not merged by the activation guard', async () => {
  const first=offer('one',{title:'First card'});
  const second=offer('two',{title:'Second card',url:first.url});
  const w=harness([first,second]);
  await w.run('stateReady');
  await w.run('runEngine("START_QUEST")');
  assert.deepEqual(w.clicked,['one','two']);
  assert.equal(w.run('state.current'),2);
});

test('missing daily card opens manual destination and still attempts next daily task', async () => {
  const w = harness([offer('missing'), offer('next')]);
  w.run(`activateQuestCard = async (_tab,item) => { if(item.key==='missing') throw new Error('QUEST_CARD_NOT_READY'); clicked.push(item.key); }`);
  await w.run('stateReady');
  await w.run('runEngine("START_QUEST")');
  assert.deepEqual(w.clicked, ['next']);
  assert.equal(w.run('state.current'), 1);
  assert.equal(w.run('state.manualQuestCount'), 1);
  assert.equal(w.created.filter(x => x.url === offer('missing').url).length, 1);
});

test('manual-only run opens safe tasks, never activates a card, and deduplicates destinations', async () => {
  const w = harness([offer('quiz', {autoEligible:false}), offer('quiz-copy', {autoEligible:false,url:offer('quiz').url})]);
  await w.run('stateReady');
  await w.run('runEngine("START_QUEST")');
  assert.deepEqual(w.clicked, []);
  assert.equal(w.run('state.manualQuestCount'), 2);
  assert.equal(w.created.length, 1);
  assert.equal(w.created[0].url, offer('quiz').url);
});

test('completed fallback offer never opens a manual destination or an official task tab', async () => {
  const w=harness([]);
  w.context.payload={isRewardsUser:true,flyoutResult:{dailySetPromotions:{},morePromotions:[
    {offerId:'completed-disabled',complete:'true',pointProgressMax:10,pointProgress:0,isEnabled:false,
      destinationUrl:'https://www.bing.com/search?q=completed-disabled'}
  ]}};
  w.run('loadQuestActivities=async()=>extractQuestActivities(payload,new Date(),true)');
  await w.run('stateReady');
  await w.run('runEngine("START_QUEST")');
  assert.deepEqual(w.created,[]);
  assert.deepEqual(w.clicked,[]);
  assert.equal(w.run('state.manualQuestCount'),0);
});
