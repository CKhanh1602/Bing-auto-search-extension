// ============================================================
// Bing Search Automator - Background Service Worker (v2.1)
// - Fast Async Batch Questing (scan & click next quest immediately while previous loads in background)
// - Background tab handling (auto re-focus dashboard / keep new tabs in background)
// - Batch close all quest tabs after all quests are clicked
// - Search result 10% click closes target tab after 3s
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
  chrome.runtime.sendMessage({ action: 'STATUS_UPDATE', state }).catch(() => {});
}

async function checkPause() {
  while (isPaused && !shouldStop) {
    await new Promise(resolve => { pauseResolver = resolve; });
  }
}

// ============================================================
// CDP Helpers
// ============================================================
function enableDebugger(tabId) {
  return new Promise((resolve, reject) => {
    chrome.debugger.attach({ tabId }, '1.2', () => {
      if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
      else resolve(true);
    });
  });
}

function disableDebugger(tabId) {
  return new Promise((resolve) => {
    chrome.debugger.detach({ tabId }, () => { resolve(true); });
  });
}

function sendCDP(tabId, method, params) {
  return new Promise((resolve, reject) => {
    chrome.debugger.sendCommand({ tabId }, method, params, (res) => {
      if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
      else resolve(res);
    });
  });
}

// ============================================================
// CDP Click
// ============================================================
async function cdpClick(tabId, x, y) {
  let weAttached = false;
  try {
    await enableDebugger(tabId);
    weAttached = true;
  } catch { /* already attached */ }

  try {
    await sendCDP(tabId, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x: Math.round(x), y: Math.round(y) });
    await delay(randomInt(60, 150));
    await sendCDP(tabId, 'Input.dispatchMouseEvent', { type: 'mousePressed', x: Math.round(x), y: Math.round(y), button: 'left', clickCount: 1 });
    await delay(randomInt(40, 100));
    await sendCDP(tabId, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x: Math.round(x), y: Math.round(y), button: 'left', clickCount: 1 });
  } finally {
    if (weAttached) try { await disableDebugger(tabId); } catch {}
  }
}

// ============================================================
// Tab Helpers
// ============================================================
function waitTabReady(tabId) {
  return new Promise(resolve => {
    let timeout = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    }, 12000);
    function listener(tid, info) {
      if (tid === tabId && info.status === 'complete') {
        clearTimeout(timeout);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    }
    chrome.tabs.onUpdated.addListener(listener);
    chrome.tabs.get(tabId, t => {
      if (t && t.status === 'complete') {
        clearTimeout(timeout);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
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
// ============================================================
const queryTemplates = {
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
  if (usedQueryIndices.size >= allQueries.length) {
    usedQueryIndices.clear();
  }
  let idx;
  do {
    idx = randomInt(0, allQueries.length - 1);
  } while (usedQueryIndices.has(idx));
  usedQueryIndices.add(idx);
  return allQueries[idx];
}

// ============================================================
// Desktop Search Engine
// Runs in background tab (active: false)
// 10% search result click opens in background and closes after 3s
// ============================================================
async function doDesktopSearches(cfg) {
  const baseCount = cfg.desktopSearches;
  const jitterRange = Math.max(1, Math.round(baseCount * 0.1));
  const count = baseCount + randomInt(-jitterRange, jitterRange);
  if (count <= 0) return;

  update({ phase: 'search_desktop', statusText: 'Desktop Search...', total: count, current: 0 });

  // Create background tab for searching (active: false)
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

      await delay(randomInt(800, 1800));

      // Scroll behavior
      try {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: () => {
            const scrollAmount = Math.floor(Math.random() * 500) + 150;
            window.scrollBy({ top: scrollAmount, behavior: 'smooth' });
          }
        });
      } catch (e) {}

      // STAR Bonus optimization: 10% chance to click a search result
      // Opens result, waits 3s, then closes it / returns to search
      if (Math.random() < 0.10) {
        try {
          await delay(randomInt(500, 1200));

          // Set up new tab listener before clicking link
          let newTabPromise = waitNewTab(3000);

          await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: () => {
              const results = document.querySelectorAll('#b_results .b_algo h2 a');
              if (results.length > 0) {
                const pick = results[Math.floor(Math.random() * Math.min(results.length, 3))];
                if (pick) pick.click();
              }
            }
          });

          let resultTab = await newTabPromise;
          if (resultTab) {
            // New tab opened - wait 3s in background then close it!
            await delay(3000);
            try { await chrome.tabs.remove(resultTab.id); } catch(e) {}
          } else {
            // Opened in same tab - wait 3s then navigate back
            await delay(3000);
            await chrome.tabs.update(tab.id, { url: "https://www.bing.com" });
            await waitTabReady(tab.id);
          }
        } catch (e) {}
      }

      // Random delay between searches (+/- 30% jitter)
      if (i < count - 1) {
        const minMs = cfg.minDelay * 1000;
        const maxMs = cfg.maxDelay * 1000;
        const baseDelay = randomInt(minMs, maxMs);
        const jitter = Math.floor(baseDelay * (Math.random() * 0.3));
        await delay(baseDelay + (Math.random() > 0.5 ? jitter : -jitter / 2));
      }
    } catch (e) {}
  }

  // Close background search tab
  try { await chrome.tabs.remove(tab.id); } catch (e) {}
}

// ============================================================
// Quest Engine - FAST Async Batch Mode
// - Immediately switches back to Rewards dashboard tab after clicking
// - Keeps all opened quest tabs in background (active: false)
// - Scans & clicks next quest card immediately without waiting 3-5s for previous tab to finish loading!
// - Closes ALL background quest tabs in a single batch at the end!
// ============================================================
async function doQuests() {
  update({ phase: 'quests', statusText: 'Processing Quests...' });
  let tab = await getRewardsTab();
  if (shouldStop) return;
  try {
    await chrome.tabs.update(tab.id, { active: true });
    await waitTabReady(tab.id);
  } catch (e) { return; }

  await delay(2000);

  // Track all opened quest tabs so we can batch-close them at the end
  const openedQuestTabIds = [];

  let iterations = 0;
  let consecutiveNotFound = 0;
  // Track clicked cards in this run to avoid re-clicking same card
  const clickedCardTitles = new Set();

  while (iterations < 25 && consecutiveNotFound < 3) {
    if (shouldStop) break;
    await checkPause();
    if (shouldStop) break;
    iterations++;

    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        args: [Array.from(clickedCardTitles)],
        func: (alreadyClickedTitles) => {
          const clickedSet = new Set(alreadyClickedTitles);

          // Selectors for card containers
          const selectors = [
            '#dailyset a[data-react-aria-pressable="true"]',
            '#moreactivities a[data-react-aria-pressable="true"]',
            '#more-activities a[data-react-aria-pressable="true"]',
            'a[data-react-aria-pressable="true"][target="_blank"]',
            'a[data-react-aria-pressable="true"][href*="rewards"]',
            'a[data-react-aria-pressable="true"][href*="bing.com"]'
          ];

          const allCards = new Set();
          for (const sel of selectors) {
            try {
              document.querySelectorAll(sel).forEach(c => allCards.add(c));
            } catch (e) {}
          }

          // Also check by section headings
          const headingTexts = ['more activities', 'keep earning', 'earn more', 'daily set', 'hoạt động khác', 'kiếm thêm'];
          document.querySelectorAll('h2, h3, [role="heading"]').forEach(h => {
            const text = (h.textContent || '').toLowerCase().trim();
            if (headingTexts.some(t => text.includes(t))) {
              let container = h.parentElement;
              for (let level = 0; level < 4 && container; level++) {
                const links = container.querySelectorAll('a[data-react-aria-pressable="true"]');
                if (links.length > 0) {
                  links.forEach(c => allCards.add(c));
                  break;
                }
                container = container.parentElement;
              }
            }
          });

          for (const card of allCards) {
            const cardText = (card.textContent || '').toLowerCase();
            const href = (card.getAttribute('href') || '').toLowerCase();

            // Try to extract card title
            const titleEl = card.querySelector(
              '.text-globalBody2Strong, [class*="title"], [class*="Title"], h3, h4, strong'
            );
            const title = titleEl ? titleEl.textContent.trim() : cardText.slice(0, 30);

            // Skip if already clicked in this run
            if (clickedSet.has(title)) continue;

            // Skip completed cards
            const isCompleted =
              cardText.includes('completed') ||
              cardText.includes('hoàn thành') ||
              card.querySelector('[aria-label*="Completed"]') !== null ||
              card.querySelector('[aria-label*="completed"]') !== null ||
              card.getAttribute('data-is-completed') === 'true';
            if (isCompleted) continue;

            // Skip promo / referral cards
            const isPromo =
              cardText.includes('referral') || cardText.includes('refer') ||
              cardText.includes('invite') || cardText.includes('giới thiệu') ||
              cardText.includes('mời bạn') || href.includes('referral') || href.includes('invite');
            if (isPromo) continue;

            if (!href || href === '#' || href === 'javascript:void(0)') continue;

            // Found valid uncompleted card!
            card.scrollIntoView({ behavior: 'instant', block: 'center' });
            const rect = card.getBoundingClientRect();

            return {
              found: true,
              x: rect.left + rect.width / 2,
              y: rect.top + rect.height / 2,
              title: title
            };
          }

          return { found: false };
        }
      });

      const result = results && results[0] ? results[0].result : null;

      if (!result || !result.found) {
        consecutiveNotFound++;
        // Scroll to reveal hidden cards
        if (consecutiveNotFound === 1) {
          try {
            await chrome.scripting.executeScript({
              target: { tabId: tab.id },
              func: () => { window.scrollBy({ top: 400, behavior: 'smooth' }); }
            });
            await delay(1000);
          } catch (e) {}
        }
        if (consecutiveNotFound === 2) {
          try {
            await chrome.scripting.executeScript({
              target: { tabId: tab.id },
              func: () => { window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' }); }
            });
            await delay(1500);
          } catch (e) {}
        }
        continue;
      }

      consecutiveNotFound = 0;
      if (result.title) clickedCardTitles.add(result.title);

      update({ statusText: `Quest: ${result.title || 'Clicking...'}` });

      // Listen for new tab BEFORE clicking
      let newTabPromise = waitNewTab(3000);
      await cdpClick(tab.id, result.x, result.y);
      let newTab = await newTabPromise;

      if (newTab) {
        openedQuestTabIds.push(newTab.id);
        // FAST SWITCH: Immediately re-focus the Rewards dashboard tab!
        // The newly opened quest tab loads in the background (running ngầm).
        try {
          await chrome.tabs.update(tab.id, { active: true });
        } catch (e) {}
      }

      if (shouldStop) break;

      // FAST ITERATION: Brief delay (600ms - 1000ms) before clicking next quest card!
      // No longer waiting 3-5 seconds per card!
      await delay(randomInt(600, 1000));

    } catch (e) { break; }
  }

  // ============================================================
  // QUEST CLEANUP BATCH:
  // All quests clicked! Wait 3 seconds for background tabs to finish loading,
  // then close ALL opened quest tabs in one batch!
  // ============================================================
  if (openedQuestTabIds.length > 0) {
    update({ statusText: `Waiting for ${openedQuestTabIds.length} quest tabs...` });
    await delay(3000); // 3s wait for background tab registration

    for (const qTabId of openedQuestTabIds) {
      try { await chrome.tabs.remove(qTabId); } catch (e) {}
    }
  }

  // Refresh dashboard to show completed states
  try {
    await chrome.tabs.update(tab.id, { active: true, url: "https://rewards.bing.com/" });
    await waitTabReady(tab.id);
  } catch (e) {}
}

// ============================================================
// Engine Orchestrator
// ============================================================
async function runEngine(action, cfg) {
  if (state.isRunning) return;
  resetState();

  try {
    if (action === 'START_QUEST') {
      await doQuests();
    }
    else if (action === 'START_DESKTOP') {
      await doDesktopSearches(cfg);
    }
    else if (action === 'START_ALL') {
      // 1. Quests first (fast batch)
      await doQuests();
      if (shouldStop) { finish('Stopped', 'stopped'); return; }

      // 2. Desktop Search (background tab)
      await doDesktopSearches(cfg);
    }

    if (shouldStop) {
      finish('Stopped', 'stopped');
    } else {
      finish('Completed!', 'complete');
    }
  } catch (e) {
    finish('Error: ' + e.message, 'stopped');
  }
}

// ============================================================
// Message Listeners
// ============================================================
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === 'GET_STATUS') {
    sendResponse(state);
    return true;
  }
  if (msg.action === 'STOP') {
    if (state.isRunning) {
      shouldStop = true;
      isPaused = false;
      if (pauseResolver) { pauseResolver(); pauseResolver = null; }
      update({ statusText: 'Stopping...', isPaused: false });
    }
    return true;
  }
  if (msg.action === 'PAUSE') {
    if (state.isRunning && !isPaused) {
      isPaused = true;
      update({ isPaused: true, statusText: 'Paused' });
    }
    return true;
  }
  if (msg.action === 'RESUME') {
    if (state.isRunning && isPaused) {
      isPaused = false;
      if (pauseResolver) { pauseResolver(); pauseResolver = null; }
      update({ isPaused: false, statusText: 'Resuming...' });
    }
    return true;
  }
  if (['START_QUEST', 'START_DESKTOP', 'START_ALL'].includes(msg.action)) {
    runEngine(msg.action, msg.config);
    return true;
  }
});
