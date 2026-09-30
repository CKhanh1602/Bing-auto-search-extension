// ============================================================
// Bing Search Automator - Background Service Worker (v2.0)
// Removed Mobile Search, Improved Quest detection,
// Optimized for Bing STAR Bonus
// ============================================================

let state = {
  isRunning: false,
  isPaused: false,
  phase: 'idle',
  current: 0,
  total: 0,
  statusText: 'Ready'
};
let shouldStop = false;
let isPaused = false;
let pauseResolver = null;
const stopWaiters = new Set();
const STATE_STORAGE_KEY = 'engineState';
let persistenceQueue = Promise.resolve();

function persistState() {
  const snapshot = { ...state };
  persistenceQueue = persistenceQueue.then(() => chrome.storage.local.set({ [STATE_STORAGE_KEY]: snapshot }))
    .catch(() => addLog('State persistence unavailable'));
  return persistenceQueue;
}

// MV3 may terminate a worker at any await. Never replay an interrupted action:
// the remote page may already have processed it before the worker disappeared.
const stateReady = chrome.storage.local.get(STATE_STORAGE_KEY).then(async stored => {
  const saved = stored[STATE_STORAGE_KEY];
  if (!saved || typeof saved !== 'object') return;
  if (['idle', 'quests', 'search_desktop', 'complete', 'stopped'].includes(saved.phase)) state.phase = saved.phase;
  state.current = Number.isSafeInteger(saved.current) && saved.current >= 0 ? saved.current : 0;
  state.total = Number.isSafeInteger(saved.total) && saved.total >= 0 ? saved.total : 0;
  const interruptedStatus = 'Run interrupted by service worker restart. Start again to rescan.';
  const knownStoppedStatuses = [interruptedStatus, 'Stopped', 'Task tab was closed. Start again to rescan.',
    'Task page timed out. Check your connection and retry.', 'Task failed. Check the Rewards page and retry.'];
  state.statusText = saved.isRunning ? interruptedStatus
    : state.phase === 'complete' ? 'Previous run finished. Check Rewards for completion.'
    : state.phase === 'stopped' ? (knownStoppedStatuses.includes(saved.statusText) ? saved.statusText : 'Previous run stopped. Start again to rescan.') : 'Ready';
  if (saved.isRunning) state.phase = 'stopped';
  await persistState();
}).catch(() => addLog('Stored state unavailable'));

function requestStop() {
  shouldStop = true;
  isPaused = false;
  if (pauseResolver) { pauseResolver(); pauseResolver = null; }
  for (const cancel of [...stopWaiters]) cancel();
}

// ============================================================
// Utilities
// ============================================================
function delay(ms) { return new Promise(r => setTimeout(r, ms)); }
function randomInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }

function update(partial) {
  Object.assign(state, partial);
  broadcast();
}

function finish(msg, phase) {
  state.isRunning = false;
  state.isPaused = false;
  isPaused = false;
  state.phase = phase || 'complete';
  state.statusText = msg;
  broadcast();
}

function resetState() {
  state = {
    isRunning: true,
    isPaused: false,
    phase: 'idle',
    current: 0,
    total: 0,
    statusText: 'Starting...'
  };
  shouldStop = false;
  isPaused = false;
  pauseResolver = null;
  broadcast();
}

function broadcast() {
  persistState();
  chrome.runtime.sendMessage({ action: 'STATUS_UPDATE', state: { ...state } }).catch(() => {});
}

function addLog(text) {
  const now = new Date();
  const ts = `[${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}:${String(now.getSeconds()).padStart(2,'0')}]`;
  console.log(`${ts} ${text}`);
}

async function checkPause() {
  while (isPaused && !shouldStop) {
    await new Promise(resolve => { pauseResolver = resolve; });
  }
}

// ============================================================
// ============================================================
// Tab Helpers
// ============================================================
function waitTabReady(tabId, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finishWait = error => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      chrome.tabs.onRemoved.removeListener(onRemoved);
      stopWaiters.delete(onStop);
      if (error) reject(new Error(error)); else resolve();
    };
    const onUpdated = (id, info) => { if (id === tabId && info.status === 'complete') finishWait(); };
    const onRemoved = id => { if (id === tabId) finishWait('TAB_CLOSED'); };
    const onStop = () => finishWait('STOPPED');
    const timeout = setTimeout(() => finishWait('TAB_TIMEOUT'), timeoutMs);
    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.tabs.onRemoved.addListener(onRemoved);
    stopWaiters.add(onStop);
    if (shouldStop) { onStop(); return; }
    chrome.tabs.get(tabId, tab => {
      if (chrome.runtime.lastError || !tab) finishWait('TAB_CLOSED');
      else if (tab.status === 'complete') finishWait();
    });
  });
}

function waitNewTab(timeoutMs) {
  return new Promise(resolve => {
    let timeout = setTimeout(() => {
      chrome.tabs.onCreated.removeListener(listener);
      resolve(null);
    }, timeoutMs);
    function listener(tab) {
      clearTimeout(timeout);
      chrome.tabs.onCreated.removeListener(listener);
      resolve(tab);
    }
    chrome.tabs.onCreated.addListener(listener);
  });
}

async function getRewardsTab() {
  const tabs = await chrome.tabs.query({ url: "*://rewards.bing.com/*" });
  if (tabs.length > 0) return tabs[0];
  return await chrome.tabs.create({ url: "https://rewards.bing.com/" });
}

// ============================================================
// STAR Bonus Optimized Query Generator
// Natural, varied, realistic search queries that mimic
// genuine human search behavior across multiple categories.
// Bing STAR Bonus rewards "good faith" organic search behavior.
// ============================================================
const queryTemplates = {
  // Category-based natural queries - mix of informational, navigational, transactional
  weather: [
    "weather today", "weather this week", "weather forecast weekend",
    "will it rain tomorrow", "temperature right now", "weather next 3 days"
  ],
  howTo: [
    "how to fix slow computer", "how to remove background from photo",
    "how to convert pdf to word", "how to screenshot on windows",
    "how to clear cache chrome", "how to fix wifi not connecting",
    "how to reduce file size", "how to reset password windows",
    "how to update drivers windows 10", "how to zip a folder"
  ],
  shopping: [
    "best wireless earbuds 2026", "best budget laptop for students",
    "best mechanical keyboard under 100", "best monitor for work from home",
    "best phone case for samsung", "best portable charger 2026",
    "cheap desk setup ideas", "best ergonomic office chair"
  ],
  news: [
    "latest tech news today", "stock market today", "sports scores today",
    "world news headlines", "new movie releases this week",
    "trending topics today", "latest science discoveries"
  ],
  food: [
    "easy dinner recipes", "best restaurants near me", "healthy lunch ideas",
    "how to make pasta from scratch", "quick breakfast ideas",
    "best coffee shops nearby", "meal prep ideas for the week"
  ],
  tech: [
    "best free antivirus 2026", "windows 11 tips and tricks",
    "is my computer fast enough for gaming", "how much ram do i need",
    "best browser for privacy", "how to speed up old laptop",
    "best vpn for streaming", "cloud storage comparison"
  ],
  travel: [
    "best places to visit in summer", "cheap flights deals",
    "things to do in tokyo", "best travel backpack",
    "hotel deals near me", "travel tips for first time flyers"
  ],
  health: [
    "exercises for back pain", "how many calories should i eat",
    "benefits of drinking water", "how to sleep better at night",
    "best stretches for desk workers", "healthy snack ideas"
  ],
  learning: [
    "free online courses", "learn python for beginners",
    "best youtube channels for learning", "how to improve writing skills",
    "best podcasts 2026", "history of artificial intelligence"
  ],
  general: [
    "time in new york", "currency converter usd to eur",
    "translate hello to spanish", "distance from earth to moon",
    "how tall is mount everest", "population of united states",
    "what day is it today", "when is the next full moon",
    "define serendipity", "who invented the internet"
  ]
};

// Build flat list and track usage to avoid repeats in same session
let allQueries = [];
let usedQueryIndices = new Set();

function buildQueryPool() {
  allQueries = [];
  for (const category of Object.keys(queryTemplates)) {
    for (const q of queryTemplates[category]) {
      allQueries.push(q);
    }
  }
  usedQueryIndices.clear();
}
buildQueryPool();

// Also load external word list if available
let externalWords = [];
async function loadWords() {
  try {
    const res = await fetch(chrome.runtime.getURL('data/words.json'));
    externalWords = await res.json();
    if (Array.isArray(externalWords) && externalWords.length > 0) {
      allQueries = allQueries.concat(externalWords);
    }
  } catch (e) {}
}
loadWords();

function generateQuery() {
  // Reset pool if all queries used
  if (usedQueryIndices.size >= allQueries.length) {
    usedQueryIndices.clear();
  }
  // Pick a random unused query
  let idx;
  do {
    idx = randomInt(0, allQueries.length - 1);
  } while (usedQueryIndices.has(idx));
  usedQueryIndices.add(idx);
  return allQueries[idx];
}

// ============================================================
// Desktop Search Engine
// Optimized for Bing STAR Bonus:
// - Natural varied queries (no repeats)
// - Random delays with wider range
// - Occasional result clicking for engagement
// - Scroll behavior to simulate reading
// ============================================================
async function doDesktopSearches(cfg) {
  // Add ±10% random jitter to search count so each day is different
  const baseCount = cfg.desktopSearches;
  const jitterRange = Math.max(1, Math.round(baseCount * 0.1));
  const count = baseCount + randomInt(-jitterRange, jitterRange);
  if (count <= 0) return;

  update({ phase: 'search_desktop', statusText: 'Desktop Search...', total: count, current: 0 });

  // Create a background tab for searching
  let tab;
  try {
    tab = await chrome.tabs.create({ url: "https://www.bing.com", active: false });
    await waitTabReady(tab.id);
  } catch (e) { return; }

  for (let i = 0; i < count; i++) {
    if (shouldStop) break;
    await checkPause();
    if (shouldStop) break;
    update({ current: i + 1 });

    try {
      const q = generateQuery();
      const searchUrl = `https://www.bing.com/search?q=${encodeURIComponent(q)}&form=QBRE`;
      await chrome.tabs.update(tab.id, { url: searchUrl });
      await waitTabReady(tab.id);

      // Simulate natural reading behavior
      await delay(randomInt(800, 2000));

      // Scroll down like reading results
      try {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: () => {
            // Random scroll amount - sometimes scroll a lot, sometimes a little
            const scrollAmount = Math.floor(Math.random() * 600) + 100;
            window.scrollBy({ top: scrollAmount, behavior: 'smooth' });
          }
        });
      } catch (e) {}

      // STAR Bonus optimization: Occasionally click a search result (10% chance)
      // Opens result in a background tab, waits 3s, closes it
      if (Math.random() < 0.10) {
        try {
          await delay(randomInt(500, 1500));
          // Get a result URL from the page
          const urlResult = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: () => {
              const results = document.querySelectorAll('#b_results .b_algo h2 a');
              if (results.length > 0) {
                const pick = results[Math.floor(Math.random() * Math.min(results.length, 3))];
                return pick ? pick.href : null;
              }
              return null;
            }
          });
          const resultUrl = urlResult && urlResult[0] ? urlResult[0].result : null;
          if (resultUrl) {
            // Open in background tab (active: false = won't steal focus)
            const bgTab = await chrome.tabs.create({ url: resultUrl, active: false });
            await delay(3000);
            try { await chrome.tabs.remove(bgTab.id); } catch (e) {}
          }
        } catch (e) {}
      }

      // Delay between searches - wider random range for natural feel
      if (i < count - 1) {
        const minMs = cfg.minDelay * 1000;
        const maxMs = cfg.maxDelay * 1000;
        // Add extra random variation (+/- 30%) to avoid fixed patterns
        const baseDelay = randomInt(minMs, maxMs);
        const jitter = Math.floor(baseDelay * (Math.random() * 0.3));
        await delay(baseDelay + (Math.random() > 0.5 ? jitter : -jitter / 2));
      }
    } catch (e) {}
  }

  // Close search tab
  try { await chrome.tabs.remove(tab.id); } catch (e) {}
}

// ============================================================
// Quest Engine: one discovery function for scanning and activation.
// A card is visited once per run; visiting is not proof of credited points.
function questCards(isEarnPage, targetKey = null) {
  const page = new URL(location.href);
  if (!['rewards.bing.com', 'rewards.microsoft.com'].includes(page.hostname) ||
      !['/dashboard', '/earn', '/'].includes(page.pathname)) {
    throw new Error('Quest page unavailable; check sign-in');
  }
  const sectionSelectors = isEarnPage === 'Earn'
    ? '#moreactivities, #more-activities, #keep-earning'
    : '#dailyset, #daily-set, #moreactivities, #more-activities';
  const sections = new Set(document.querySelectorAll(sectionSelectors));
  const labels = isEarnPage === 'Earn' ? ['keep earning', 'tiếp tục kiếm điểm']
    : ['daily set', 'more activities', 'bộ hàng ngày', 'hoạt động khác'];
  for (const heading of document.querySelectorAll('h2, h3, [role="heading"]')) {
    if (!labels.includes((heading.textContent || '').trim().toLowerCase())) continue;
    let container = heading.parentElement;
    for (let level = 0; level < 3 && container; level++, container = container.parentElement) {
      if (['BODY', 'HTML', 'MAIN'].includes(container.tagName)) break;
      if (container.querySelectorAll('h2, h3, [role="heading"]').length > 1) break;
      if (container.querySelectorAll('a[href]').length > 0) { sections.add(container); break; }
    }
  }
  const cardPool = [...new Set([...sections].flatMap(section => [...section.querySelectorAll('a[href]')]))];

          const checkValid = (card) => {
            const t = (card.textContent || '').toLowerCase();
            const h = (card.getAttribute('href') || '').toLowerCase();
            let url;
            try { url = new URL(card.getAttribute('href'), location.href); } catch { return false; }
            if (url.protocol !== 'https:' || !['www.bing.com', 'bing.com', 'rewards.bing.com', 'rewards.microsoft.com'].includes(url.hostname)) return false;
            const r = card.getBoundingClientRect();

            // 1. Skip invisible or tiny elements
            if (r.width < 50 || r.height < 30) return false;

            // 2. CRITICAL: Skip Header, Navbar, Footer, and Tab Navigation elements
            if (card.getAttribute('role') === 'tab' || card.closest('[role="tablist"], [role="tab"]')) return false;
            if (card.closest('header, nav, footer, [role="navigation"], [class*="Header"], [class*="header"], [class*="navigation"], [class*="navBar"], [class*="navbar"], [class*="nav_"], [class*="Nav_"]')) return false;

            // 3. CRITICAL: Skip top-level navigation pages and URLs
            if (h.includes('/about') || h.includes('/refer') || h.includes('/redeem') || h.includes('/status') || h.includes('/welcome') || h.includes('/shop') || h.includes('/dashboard') || h.includes('/earn') || h.includes('/dash')) return false;

            // 4. CRITICAL: Skip navigation tab titles
            const cleanTxt = t.trim();
            if (cleanTxt === 'dashboard' || cleanTxt === 'earn' || cleanTxt === 'redeem' || cleanTxt === 'about' || cleanTxt === 'refer and earn' || t.includes('trạng thái') || t.includes('người chiến thắng')) return false;

            // 5. Skip Completed cards
            if (t.includes('completed') || t.includes('hoàn thành')) return false;
            if (card.querySelector('[aria-label*="Completed"]') || card.querySelector('[aria-label*="completed"]')) return false;
            if (card.getAttribute('data-is-completed') === 'true') return false;

            // 6. Skip Promo / Referral
            if (t.includes('referral') || t.includes('refer a friend') || t.includes('invite') || t.includes('giới thiệu') || t.includes('mời bạn')) return false;

            // 7. Skip Search-requirement cards (need actual Bing searches)
            if (t.includes('score') && t.includes('searches')) return false;
            if (t.includes('points for') && t.includes('search')) return false;
            if (t.includes('search and earn')) return false;

            // 8. Skip Streak / In-progress / Long-term cards
            if (t.includes('in progress') || t.includes('streak') || t.includes('in a row')) return false;
            if (t.includes('for 7 days') || t.includes('for 14 days') || t.includes('chuỗi ngày')) return false;

            // 9. Skip Non-quest items (app install, settings, xbox etc.)
            if (t.includes('bing app') || (t.includes('search engine') && t.includes('default'))) return false;
            if (t.includes('game pass') || (t.includes('xbox') && !t.includes('quiz'))) return false;

            // 10. Skip invalid links & short text
            if (!h || h === '#' || h === 'javascript:void(0)') return false;
            if (t.trim().length < 5) return false;

            // 11. CRITICAL: Skip the "Quests" section entirely (user requested)
            if (t.includes('tasks') || t.includes('expires in') || t.includes('taskbar')) return false;
            if (card.closest('[id*="quest"], [class*="quest"], [class*="Quest"]')) return false;

            return true;
          };


  const cards = [];
  const seen = new Set();
  for (const card of cardPool) {
    if (!checkValid(card)) continue;
    const key = new URL(card.getAttribute('href'), location.href).href;
    if (seen.has(key)) continue;
    seen.add(key);
    if (targetKey === key) {
      card.click(); // Ordinary DOM activation; never synthesize trusted mouse input.
      return { activated: true };
    }
    cards.push({ key });
  }
  return { cards, totalScanned: cardPool.length, supported: sections.size > 0, activated: false };
}

async function questDelay(ms) {
  for (let elapsed = 0; elapsed < ms && !shouldStop; elapsed += 100) {
    await checkPause();
    if (!shouldStop) await delay(Math.min(100, ms - elapsed));
  }
}

async function processQuestsOnPage(tab, pageName, visited = new Set()) {
  const execute = async (key = null) => {
    const result = await chrome.scripting.executeScript({
      target: { tabId: tab.id }, func: questCards, args: [pageName, key]
    });
    if (!result?.[0]?.result) throw new Error('Quest scan failed');
    return result[0].result;
  };
  let scan;
  for (let attempt = 0; attempt < 3 && !shouldStop; attempt++) {
    await checkPause();
    if (shouldStop) return;
    scan = await execute();
    if (scan.supported && scan.totalScanned > 0) break;
    addLog('Quest: no supported cards; retry ' + (attempt + 1));
    await questDelay(1000);
  }
  if (shouldStop) return;
  if (!scan || scan.totalScanned === 0) throw new Error('Quest layout/section unavailable; check sign-in or selectors');
  const cards = scan.cards.filter(card => !visited.has(card.key));
  update({ total: state.total + cards.length, statusText: pageName + ': ' + cards.length + ' eligible cards' });
  for (const card of cards) {
    await checkPause();
    if (shouldStop) return;
    // Re-resolve by URL after each DOM update. Never index a shrinking list.
    const result = await execute(card.key);
    if (shouldStop) return;
    visited.add(card.key);
    if (!result.activated) addLog('Quest: card changed or disappeared; skipped');
    update({ current: state.current + 1, statusText: pageName + ': card processed; reward not verified' });
    await questDelay(1000);
    if (shouldStop) return;
    // A card may navigate this same tab. Restore the source page before scanning.
    const currentTab = await chrome.tabs.get(tab.id);
    const expectedPath = pageName === 'Earn' ? '/earn' : '/dashboard';
    const currentUrl = new URL(currentTab.url);
    if (!['rewards.bing.com', 'rewards.microsoft.com'].includes(currentUrl.hostname) || currentUrl.pathname !== expectedPath) {
      await waitTabReady(tab.id);
      await questDelay(1000);
      await navigateAndPrepare(tab, 'https://rewards.bing.com' + expectedPath);
    }
  }
}

async function navigateAndPrepare(tab, url) {
  await checkPause();
  if (shouldStop) return;
  await chrome.tabs.update(tab.id, { url });
  await waitTabReady(tab.id);
  await questDelay(1000);
}

async function doQuests() {
  update({ phase: 'quests', statusText: 'Processing Quests...', current: 0, total: 0 });
  let tab;
  try {
    await checkPause();
    if (shouldStop) return;
    tab = await chrome.tabs.create({ url: 'https://rewards.bing.com/dashboard', active: true });
    await waitTabReady(tab.id);
    const visited = new Set();
    await processQuestsOnPage(tab, 'Dashboard', visited);
    if (shouldStop) return;
    await navigateAndPrepare(tab, 'https://rewards.bing.com/earn');
    if (shouldStop) return;
    await processQuestsOnPage(tab, 'Earn', visited);
  } finally {
    // Only the tab created by this run is owned. Leave destination/user tabs open.
    if (tab) try { await chrome.tabs.remove(tab.id); } catch { /* Already closed. */ }
  }
}

// ============================================================
// Engine Orchestrator
// ============================================================
async function runEngine(action, cfg) {
  if (state.isRunning) return;
  resetState();

  try {
    await persistenceQueue;
    if (shouldStop) { finish('Stopped', 'stopped'); return; }
    if (action === 'START_QUEST') {
      await doQuests();
    }
    else if (action === 'START_DESKTOP') {
      await doDesktopSearches(cfg);
    }
    else if (action === 'START_ALL') {
      // 1. Run Quests first (shows Quest progress bar)
      await doQuests();
      if (shouldStop) { finish('Stopped', 'stopped'); return; }

      // 2. Then run Search (shows Search progress bar 1/30 ... 30/30)
      await doDesktopSearches(cfg);
    }

    if (shouldStop) {
      finish('Stopped', 'stopped');
    } else {
      finish(action === 'START_DESKTOP' ? 'Completed!' : 'Quest scan finished; rewards may require manual completion.', 'complete');
    }
  } catch (e) {
    const reasons = {
      TAB_CLOSED: 'Task tab was closed. Start again to rescan.',
      TAB_TIMEOUT: 'Task page timed out. Check your connection and retry.',
      'Quest page unavailable; check sign-in': 'Quest page unavailable; check sign-in.',
      'Quest layout/section unavailable; check sign-in or selectors': 'Quest layout/section unavailable; check sign-in or selectors.',
      'Quest scan failed': 'Quest scan failed. Check the Rewards page and retry.',
      STOPPED: 'Stopped'
    };
    finish(shouldStop ? 'Stopped' : reasons[e.message] || 'Task failed. Check the Rewards page and retry.', 'stopped');
    addLog(shouldStop ? 'Run stopped' : 'Run failed; state saved for inspection');
  }
}

// ============================================================
// Message Listeners
// ============================================================
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || !['GET_STATUS', 'STOP', 'PAUSE', 'RESUME', 'START_QUEST', 'START_DESKTOP', 'START_ALL'].includes(msg.action)) return false;
  if (sender.id !== chrome.runtime.id || sender.tab || sender.url !== chrome.runtime.getURL('popup.html')) {
    sendResponse({ ok: false, error: 'Unauthorized sender' });
    return false;
  }
  stateReady.then(async () => {
    if (msg.action === 'GET_STATUS') { sendResponse({ ...state }); return; }
    if (msg.action.startsWith('START_')) {
      if (state.isRunning) { sendResponse({ ok: false, error: 'A run is already active', state: { ...state } }); return; }
      const cfg = msg.config;
      if (msg.action !== 'START_QUEST' && (!cfg || !Number.isInteger(cfg.desktopSearches) || cfg.desktopSearches < 1 || cfg.desktopSearches > 1000 ||
        !Number.isFinite(cfg.minDelay) || !Number.isFinite(cfg.maxDelay) || cfg.minDelay < 1 || cfg.maxDelay < cfg.minDelay || cfg.maxDelay > 3600)) {
        sendResponse({ ok: false, error: 'Invalid search configuration', state: { ...state } }); return;
      }
      void runEngine(msg.action, cfg);
    } else if (msg.action === 'STOP' && state.isRunning) {
      requestStop();
      update({ statusText: 'Stopping...', isPaused: false });
    } else if (msg.action === 'PAUSE' && state.isRunning && !shouldStop) {
      isPaused = true;
      update({ isPaused: true, statusText: 'Paused' });
    } else if (msg.action === 'RESUME' && state.isRunning && !shouldStop) {
      isPaused = false;
      if (pauseResolver) { pauseResolver(); pauseResolver = null; }
      update({ isPaused: false, statusText: 'Resuming...' });
    }
    await persistenceQueue;
    sendResponse({ ok: true, state: { ...state } });
  }).catch(() => sendResponse({ ok: false, error: 'Command failed' }));
  return true;
});
