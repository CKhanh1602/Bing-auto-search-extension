// Optional browser integration test. Requires Playwright and installed Edge.
// Uses a fresh profile, intercepted web pages, and synthetic Rewards data only.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

(async () => {
  const root = path.resolve(__dirname, '..');
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'bing-quest-qa-'));
  const output = path.join(root, '.qa');
  fs.mkdirSync(output, { recursive: true });
  const context = await chromium.launchPersistentContext(profile, {
    executablePath: process.env.EDGE_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    headless: true,
    ignoreDefaultArgs: ['--disable-extensions'],
    args: ['--headless=new', `--disable-extensions-except=${root}`, `--load-extension=${root}`],
    viewport: { width: 420, height: 740 }
  });
  const errors = [];
  const webErrors = [];
  const requestFailures = [];
  const consoleMessages = [];
  context.on('requestfailed', request => requestFailures.push({ url: request.url(), error: request.failure()?.errorText }));
  context.on('console', message => consoleMessages.push(message.text()));
  context.on('page', page => page.on('pageerror', error => {
    if (page.url().startsWith('chrome-extension://')) errors.push(error.message);
    else webErrors.push(error.message);
  }));
  let fixtureMode = 'single';
  const clickCounts = new Map();
  const clickVariants = new Map();
  const countClick = (id, variant) => {
    clickCounts.set(id, (clickCounts.get(id) || 0) + 1);
    const variants = clickVariants.get(id) || [];
    variants.push(variant);
    clickVariants.set(id, variants);
  };
  const renderCard = ({ id, title, query, points = 10, complete = false, variant = 'base' }) => `
    <div class="promo_cont">
      <a class="block" target="_blank" data-offer-id="${id}" data-variant="${variant}"
         href="https://www.bing.com/search?q=${query}&FORM=flyout">
        <p class="promo-title">${title}</p>
        <div class="pc${complete ? ' complete' : ''}"><div class="point">${points}</div></div>
      </a>
    </div>`;
  await context.route('https://**/*', async route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/qa-activate') {
      const id = url.searchParams.get('id') || 'qa-offer';
      const variant = url.searchParams.get('variant') || 'base';
      countClick(id, variant);
      await context.serviceWorkers()[0].evaluate(clickedId => {
        globalThis.qaCardClicked = true;
        globalThis.qaAnyCardClicked = true;
        globalThis.qaClickedOffers[clickedId] = (globalThis.qaClickedOffers[clickedId] || 0) + 1;
      }, id);
      return route.fulfill({status:200,contentType:'application/json',body:'{}'});
    }
    if (url.pathname === '/rewards/panelflyout') {
      let cards;
      if (fixtureMode === 'mixed') {
        const offer5Changed = [...clickCounts.values()].some(count => count > 0);
        cards = [
          renderCard({ id: 'qa-offer-1', title: 'QA offer 1', query: 'local-qa-offer-1', complete: clickCounts.has('qa-offer-1') }),
          renderCard({ id: 'qa-offer-2', title: 'QA offer 2', query: 'local-qa-offer-2', complete: clickCounts.has('qa-offer-2') }),
          renderCard({ id: 'qa-offer-3', title: 'QA offer 3', query: 'local-qa-offer-3' }),
          // Offer 4 intentionally remains in the API only, reproducing stale eligibility.
          renderCard({ id: 'qa-offer-5', title: offer5Changed ? 'QA offer 5 refreshed' : 'QA offer 5',
            query: offer5Changed ? 'local-qa-offer-5-new' : 'local-qa-offer-5-old',
            complete: clickCounts.has('qa-offer-5'), variant: offer5Changed ? 'new' : 'old' }),
          renderCard({ id: 'qa-dashboard-quiz', title: 'Dashboard-only daily quiz', query: 'local-qa-quiz', complete: clickCounts.has('qa-dashboard-quiz') }),
          renderCard({ id: 'qa-earn', title: 'Keep earning tasks', query: 'local-qa-earn', complete: clickCounts.has('qa-earn') }),
          renderCard({ id: 'qa-zero', title: 'No points', query: 'local-qa-zero', points: 0 })
        ].join('');
      } else {
        cards = [
          renderCard({ id: 'qa-offer-complete', title: 'QA offer', query: 'local-qa-fixture', complete: true }),
          renderCard({ id: 'qa-offer', title: 'QA offer', query: 'local-qa-fixture' })
        ].join('');
      }
      return route.fulfill({status:200,contentType:'text/html',body:`<!doctype html>
        <title>Official-card flow fixture only</title><main id="cards"></main>
        <script>setTimeout(() => {
          document.querySelector('#cards').innerHTML = ${JSON.stringify(cards)};
          for (const anchor of document.querySelectorAll('.pc:not(.complete)')) {
            const card = anchor.closest('a');
            card.addEventListener('click', async event => {
              event.preventDefault(); const href=event.currentTarget.href;
              const id=event.currentTarget.dataset.offerId; const variant=event.currentTarget.dataset.variant;
              await fetch('/qa-activate?id=' + encodeURIComponent(id) + '&variant=' + encodeURIComponent(variant));
              window.open(href, '_blank');
            });
          }
        }, 250);</script>`});
    }
    return route.fulfill({status:200,contentType:url.hostname.includes('fonts.googleapis')?'text/css':'text/html',
      body:'<!doctype html><title>Local QA destination</title><h1>Fixture only</h1>'});
  });
  try {
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker', { timeout: 15000 });
    const extensionId = new URL(worker.url()).host;
    const clearFixtureTabs = () => worker.evaluate(async () => {
      const tabs = await chrome.tabs.query({ url: 'https://www.bing.com/*' });
      await Promise.all(tabs.map(tab => chrome.tabs.remove(tab.id)));
    });
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    await popup.waitForFunction(() => document.querySelector('#statusText').textContent === 'Ready when you are.');
    assert.equal(await popup.locator('#questTimeoutSeconds').inputValue(), '10');
    assert.equal(await popup.locator('#btnKeepOpen').count(), 0);
    assert.equal(await popup.locator('#githubCredit').getAttribute('href'), 'https://github.com/CKhanh1602');
    await popup.screenshot({ path: path.join(output, 'edge-popup-light.png'), animations: 'disabled' });
    // Keyboard behavior in the extension page; native popup sizing is tested
    // separately because headless popup targets do not route CDP key input.
    await popup.locator('#btnSettings').press('Enter');
    assert.equal(await popup.locator('#btnSettings').getAttribute('aria-expanded'), 'true');
    await popup.locator('#selLanguage').selectOption('vi');
    await popup.screenshot({ path: path.join(output, 'edge-popup-light-vi.png'), animations: 'disabled', fullPage: true });
    assert.equal(await popup.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await popup.locator('#selTheme').selectOption('dark');
    await popup.waitForFunction(() => !document.body.classList.contains('light-theme'));
    await popup.screenshot({ path: path.join(output, 'edge-popup-dark-vi.png'), animations: 'disabled', fullPage: true });
    await popup.locator('#selTheme').selectOption('light');
    await popup.locator('#selLanguage').selectOption('en');
    await popup.locator('#btnCloseSettings').click();
    await popup.locator('#btnSettings').focus();
    await popup.keyboard.press('Tab');
    assert.equal(await popup.evaluate(() => document.activeElement.id), 'desktopSearches');

    // The installed worker runs its real parser, fetch validation, load events,
    // verification loop, storage and messages. Only remote data is replaced.
    await worker.evaluate(() => {
      const originalInjection = chrome.scripting.executeScript.bind(chrome.scripting);
      chrome.scripting.executeScript = async options => {
        try { return await originalInjection(options); }
        catch (error) { globalThis.qaScriptError = error.message; throw error; }
      };
      globalThis.qaProbes = 0;
      globalThis.qaCardClicked = false;
      globalThis.qaAnyCardClicked = false;
      globalThis.qaClickedOffers = {};
      globalThis.qaHold = false;
      globalThis.qaMode = 'complete';
      globalThis.qaFetchStarted = false;
      globalThis.qaResolve = null;
      globalThis.qaIgnoreAbort = false;
      globalThis.fetch = async (_url, options) => {
        qaProbes++;
        qaFetchStarted = true;
        if (qaHold && qaCardClicked) {
          await new Promise((resolve, reject) => {
            qaResolve = resolve;
            options.signal.addEventListener('abort', () => {
              if (qaIgnoreAbort) return;
              const error = new Error('aborted'); error.name = 'AbortError'; reject(error);
            }, { once: true });
          });
        }
        if (qaMode === 'mixed') {
          const today = new Date().toLocaleDateString('en-US');
          const offer = (id, title, destination, complete) => ({ name: id, attributes: {
            offerid: id, type: 'urlreward', title, complete: String(complete), max: '10',
            progress: complete ? '10' : '0', destination, daily_set_date: today
          } });
          const refreshed = qaAnyCardClicked;
          const completed = id => id !== 'qa-offer-3' && id !== 'qa-offer-4' && !!qaClickedOffers[id];
          return { ok: true, status: 200, url: 'https://www.bing.com/rewards/panelflyout/getuserinfo',
            json: async () => ({ isRewardsUser: true, userInfo: { activities: null, promotions: [
              offer('qa-offer-1', 'QA offer 1', 'https://www.bing.com/search?q=local-qa-offer-1&form=reward', completed('qa-offer-1')),
              offer('qa-offer-3', 'QA offer 3', 'https://www.bing.com/search?q=local-qa-offer-3&form=reward', false),
              offer('qa-offer-4', 'QA offer 4', 'https://www.bing.com/search?q=local-qa-offer-4&form=reward', false),
              offer('qa-offer-5', refreshed ? 'QA offer 5 refreshed' : 'QA offer 5',
                refreshed ? 'https://www.bing.com/search?q=local-qa-offer-5-new&form=reward'
                  : 'https://www.bing.com/search?q=local-qa-offer-5-old&form=reward', completed('qa-offer-5'))
            ] }, flyoutResult: { dailySetPromotions: { [today]: [
              { name: 'qa-offer-2', title: 'QA offer 2', destinationUrl: 'https://www.bing.com/search?q=local-qa-offer-2&form=reward',
                pointProgressMax: 10, pointProgress: completed('qa-offer-2') ? 10 : 0,
                complete: completed('qa-offer-2'), attributes: { offerid: 'qa-offer-2', type: 'urlreward' } },
              { name: 'qa-dashboard-quiz',
              title: 'Dashboard-only daily quiz', destinationUrl: 'https://www.bing.com/search?q=local-qa-quiz',
              pointProgressMax: 10, pointProgress: completed('qa-dashboard-quiz') ? 10 : 0, complete: completed('qa-dashboard-quiz'),
              attributes: { offerid: 'qa-dashboard-quiz', type: 'quiz' } }] }, morePromotions: [
              { name: 'qa-earn', title: 'Keep earning tasks', description: 'Offer expires in 1 day', destinationUrl: 'https://www.bing.com/search?q=local-qa-earn',
                pointProgressMax: 10, pointProgress: completed('qa-earn') ? 10 : 0, complete: completed('qa-earn'),
                attributes: { offerid:'qa-earn',type:'quiz' } },
              { name:'qa-zero',title:'No points',destinationUrl:'https://www.bing.com/search?q=local-qa-zero',pointProgressMax:0,complete:false }
            ] } }) };
        }
        const complete = qaCardClicked && !qaHold && qaMode === 'complete';
        return { ok: true, status: 200, url: 'https://www.bing.com/rewards/panelflyout/getuserinfo',
          json: async () => ({ isRewardsUser: true, userInfo: { activities: null, promotions: [
            { name: 'qa-offer', attributes: { offerid: 'qa-offer', type: 'urlreward',
              title: 'QA offer', complete: String(complete), max: '10', progress: complete ? '10' : '0',
              daily_set_date: new Date().toLocaleDateString('en-US'),
              destination: 'https://www.bing.com/search?q=local-qa-fixture&form=reward' } }
          ] } }) };
      };
    });
    await popup.locator('#btnQuest').click();
    await popup.waitForFunction(() => document.querySelector('#statusText').textContent === 'Quest activities confirmed by Rewards.')
      .catch(async error => {
        console.error('Fixture status: ' + await popup.locator('#statusText').textContent());
        console.error('Fixture injection failure: ' + await worker.evaluate(() => globalThis.qaScriptError || 'none'));
        console.error('Fixture request failures: ' + JSON.stringify(requestFailures));
        console.error('Fixture page states: ' + JSON.stringify(await Promise.all(context.pages().filter(page => !page.url().startsWith('chrome-extension://')).map(async page => ({url:page.url(),title:await page.title(),text:(await page.locator('body').innerText()).slice(0,250)})))));
        throw error;
      });
    assert.equal(await popup.locator('#progressText').textContent(), '1 / 1');
    assert.equal(clickCounts.get('qa-offer'), 1);
    assert.equal(context.pages().filter(page => page.url().startsWith('https://www.bing.com/rewards/panelflyout')).length, 1);
    console.log('PASS: unpacked MV3 load, popup, 10s default; async DOM readiness and pending-card handler required for credit');
    const completedTabs=await worker.evaluate(async()=> (await chrome.tabs.query({url:'https://www.bing.com/*'})).length);
    await popup.locator('#btnQuest').click();
    await popup.waitForFunction(()=>document.querySelector('#statusText').textContent==='No eligible Quest offers found; check Rewards for credit.');
    assert.equal(clickCounts.get('qa-offer'),1,'A new Start must not replay a server-completed card');
    assert.equal(await worker.evaluate(async()=> (await chrome.tabs.query({url:'https://www.bing.com/*'})).length),completedTabs,'Completed-only run must not create a task tab');
    console.log('PASS: starting again after verified completion creates no task tab and does not reactivate the completed card');
    await clearFixtureTabs();

    await worker.evaluate(() => { qaProbes = 0; qaCardClicked = false; qaHold = true; qaFetchStarted = false; qaResolve = null; });
    await popup.locator('#btnQuest').click();
    await popup.waitForFunction(() => document.querySelector('#statusText').textContent.startsWith('Verifying Quest activity'));
    await popup.locator('#btnPause').click();
    await popup.waitForFunction(() => document.querySelector('#statusBadge').textContent === 'PAUSED');
    await worker.evaluate(() => { qaHold = false; qaResolve?.(); });
    assert.equal(await popup.locator('#progressText').textContent(), '0 / 1');
    await popup.locator('#btnPause').click();
    await popup.waitForFunction(() => document.querySelector('#statusText').textContent === 'Quest activities confirmed by Rewards.');
    console.log('PASS: Pause blocks verification effects; Resume completes without duplicate tabs');
    await clearFixtureTabs();

    await worker.evaluate(() => { qaProbes = 0; qaCardClicked = false; qaHold = true; qaResolve = null; qaIgnoreAbort = true; });
    await popup.locator('#btnQuest').click();
    await popup.waitForFunction(() => document.querySelector('#statusText').textContent.startsWith('Verifying Quest activity'));
    await popup.locator('#btnStop').click();
    await popup.waitForFunction(() => document.querySelector('#statusText').textContent === 'Automation stopped.');
    assert.equal(await popup.locator('#progressText').textContent(), '0 / 1');
    const keptTabs = await worker.evaluate(() => chrome.tabs.query({ url: 'https://www.bing.com/rewards/panelflyout*' }));
    assert.equal(keptTabs.length, 1);
    await popup.reload();
    await popup.waitForFunction(() => document.querySelector('#statusText').textContent === 'Automation stopped.');
    await worker.evaluate(() => { qaLateResolve = qaResolve; qaHold = false; qaCardClicked = false; qaIgnoreAbort = false; });
    assert.equal(await popup.locator('#btnQuest').isEnabled(), true);
    await popup.locator('#btnQuest').click();
    await popup.waitForFunction(() => document.querySelector('#statusText').textContent === 'Quest activities confirmed by Rewards.');
    await worker.evaluate(async () => { qaLateResolve?.(); await new Promise(resolve => setTimeout(resolve, 250)); });
    assert.equal(await popup.locator('#statusText').textContent(), 'Quest activities confirmed by Rewards.');
    assert.equal(await popup.locator('#progressText').textContent(), '1 / 1');
    console.log('PASS: Stop immediately permits a replacement run; late old fetch cannot change new state; popup reload hydrates Stop');

    // Close only the stopped run's fixture tab in this disposable profile.
    await clearFixtureTabs();
    await worker.evaluate(() => { qaProbes = 0; qaCardClicked = false; qaHold = false; qaMode = 'pending'; qaResolve = null; });
    await popup.locator('#btnQuest').click();
    await popup.waitForFunction(() => document.querySelector('#statusBadge').textContent === 'ACTION NEEDED');
    assert.equal(await popup.locator('#progressText').textContent(), '0 / 1');
    assert.equal((await worker.evaluate(() => chrome.tabs.query({ url: 'https://www.bing.com/rewards/panelflyout*' }))).length, 1);
    assert.match(await popup.locator('#manualQuestNotice').textContent(), /1 quest left for you/);
    console.log('PASS: primary flyout schema with activities=null; pending server state reaches Action needed, never false completion');

    await clearFixtureTabs();
    fixtureMode = 'mixed';
    clickCounts.clear();
    clickVariants.clear();
    await worker.evaluate(() => {
      qaProbes = 0; qaCardClicked = false; qaAnyCardClicked = false; qaClickedOffers = {};
      qaHold = false; qaMode = 'mixed'; qaResolve = null;
    });
    await popup.locator('#btnQuest').click();
    await popup.waitForFunction(() => document.querySelector('#statusBadge').textContent === 'ACTION NEEDED', null,
      { timeout: 60000 });
    assert.equal(await popup.locator('#progressText').textContent(), '5 / 7');
    assert.deepEqual(Object.fromEntries([...clickCounts.entries()].sort()), {
      'qa-dashboard-quiz': 1, 'qa-earn': 1, 'qa-offer-1': 1, 'qa-offer-2': 1, 'qa-offer-3': 1, 'qa-offer-5': 1
    });
    assert.equal(clickCounts.has('qa-offer-4'), false);
    assert.deepEqual(clickVariants.get('qa-offer-5'), ['new']);
    assert.equal(clickCounts.has('qa-zero'), false);
    const manualState = await worker.evaluate(async () => ({ state: (await chrome.storage.local.get('engineState')).engineState,
      tabs: await chrome.tabs.query({ url: 'https://www.bing.com/search?q=local-qa-quiz*' }) }));
    assert.equal(manualState.state.manualQuestCount, 2);
    assert.equal(manualState.tabs.length, 1);
    assert.match(await popup.locator('#manualQuestNotice').textContent(), /2 quests left for you/);
    await popup.screenshot({ path: path.join(output, 'edge-popup-daily-handoff.png'), animations: 'disabled' });
    assert.equal(await popup.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    assert.doesNotMatch(consoleMessages.join('\n'), /Run failed; state saved for inspection/);
    console.log('PASS: seven-offer run continues past unconfirmed and missing cards, reports 5/7, and clicks each available card once');
    console.log('PASS: stable offer 5 uses refreshed title and destination before its strict official-card activation');
    console.log('PASS: dashboard-only Daily Set quiz and undated Earn card are activated once through official handler and verified; zero-point card is skipped');
    console.log('PASS: dashboard-only daily URL card (absent raw promotions) is discovered, activated once and verified complete');

    await clearFixtureTabs();
    fixtureMode = 'single';
    clickCounts.clear();
    clickVariants.clear();
    await worker.evaluate(() => { qaProbes = 0; qaCardClicked = false; qaHold = true; qaMode = 'complete'; qaResolve = null; });
    await popup.locator('#btnQuest').click();
    await popup.waitForFunction(() => document.querySelector('#statusText').textContent.startsWith('Verifying Quest activity'));
    await popup.locator('#btnPause').click();
    await popup.waitForFunction(() => document.querySelector('#statusBadge').textContent === 'PAUSED');
    const beforeReload = await worker.evaluate(async () => {
      const stored = await chrome.storage.local.get('engineState');
      if (!stored.engineState.isRunning || !stored.engineState.isPaused) throw new Error('Active state was not persisted');
      return (await chrome.tabs.query({ url: 'https://www.bing.com/*' })).length;
    });
    const restartedEvent = context.waitForEvent('serviceworker', { timeout: 15000 });
    try { await worker.evaluate(() => chrome.runtime.reload()); }
    catch (error) {
      if (!/closed|destroyed/i.test(error.message)) throw error;
    }
    const restartedWorker = await restartedEvent;
    const reopened = await context.newPage();
    await reopened.goto(`chrome-extension://${extensionId}/popup.html`);
    await reopened.waitForFunction(() => document.querySelector('#statusText').textContent ===
      'Run interrupted by service worker restart. Start again to rescan.');
    const afterReload = await restartedWorker.evaluate(async () => ({
      saved: (await chrome.storage.local.get('engineState')).engineState,
      taskTabs: (await chrome.tabs.query({ url: 'https://www.bing.com/*' })).length
    }));
    assert.equal(afterReload.saved.isRunning, false);
    assert.equal(afterReload.saved.isPaused, false);
    assert.equal(afterReload.taskTabs, beforeReload);
    console.log('PASS: extension reload restarts the real MV3 worker, recovers interruption, and never replays destinations');
    assert.deepEqual(errors, []);
    console.log('Fixture web-page errors (excluded from popup checks): ' + webErrors.length);
    console.log('Fixture web-page error messages: ' + JSON.stringify([...new Set(webErrors)]));
    console.log('PASS: no popup JavaScript errors. Synthetic data only; live credit and idle worker suspension remain unverified.');
  } finally {
    await context.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
