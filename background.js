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
    await delay(randomInt(80, 200));
    await sendCDP(tabId, 'Input.dispatchMouseEvent', { type: 'mousePressed', x: Math.round(x), y: Math.round(y), button: 'left', clickCount: 1 });
    await delay(randomInt(40, 120));
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
    }, 15000);
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
      // This signals "genuine" search engagement to Microsoft
      if (Math.random() < 0.10) {
        try {
          await delay(randomInt(500, 1500));
          await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: () => {
              // Find organic results (not ads)
              const results = document.querySelectorAll('#b_results .b_algo h2 a');
              if (results.length > 0) {
                const pick = results[Math.floor(Math.random() * Math.min(results.length, 3))];
                if (pick) pick.click();
              }
            }
          });
          // Wait on the result page briefly
          await delay(randomInt(2000, 4000));
          // Go back to bing
          await chrome.tabs.update(tab.id, { url: "https://www.bing.com" });
          await waitTabReady(tab.id);
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
// Quest Engine - Improved "More Activities" detection
// Now uses multiple selector strategies for robustness
// ============================================================
async function doQuests() {
  update({ phase: 'quests', statusText: 'Processing Quests...' });
  let tab = await getRewardsTab();
  if (shouldStop) return;
  try {
    await chrome.tabs.update(tab.id, { active: true });
    await waitTabReady(tab.id);
  } catch (e) { return; }

  // Wait longer for React rendering
  await delay(2500);

  let iterations = 0;
  let consecutiveNotFound = 0;

  while (iterations < 25 && consecutiveNotFound < 3) {
    if (shouldStop) break;
    await checkPause();
    if (shouldStop) break;
    iterations++;

    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
          // ================================================================
          // Multi-strategy card detection for both Daily Set & More Activities
          // Uses multiple selector approaches for robustness
          // ================================================================

          // Strategy 1: Direct ID selectors (classic)
          const selectors = [
            '#dailyset a[data-react-aria-pressable="true"]',
            '#moreactivities a[data-react-aria-pressable="true"]',
            '#more-activities a[data-react-aria-pressable="true"]'
          ];

          // Strategy 2: Find all clickable reward cards on the page
          // by looking for links with target="_blank" inside card containers
          const additionalSelectors = [
            'a[data-react-aria-pressable="true"][target="_blank"]',
            'a[data-react-aria-pressable="true"][href*="rewards"]',
            'a[data-react-aria-pressable="true"][href*="bing.com"]'
          ];

          // Combine all found cards, deduplicate
          const allCards = new Set();

          for (const sel of selectors.concat(additionalSelectors)) {
            try {
              const found = document.querySelectorAll(sel);
              found.forEach(c => allCards.add(c));
            } catch (e) {}
          }

          // Strategy 3: Find by section headings containing known text
          // Look for headings like "More activities", "Keep earning", "Daily Set"
          const headingTexts = ['more activities', 'keep earning', 'earn more', 'daily set', 'hoạt động khác', 'kiếm thêm'];
          const allHeadings = document.querySelectorAll('h2, h3, [role="heading"]');
          for (const h of allHeadings) {
            const text = (h.textContent || '').toLowerCase().trim();
            if (headingTexts.some(t => text.includes(t))) {
              // Found a relevant section heading - look for cards in its parent container
              let container = h.parentElement;
              // Walk up a few levels to find the section container
              for (let level = 0; level < 4 && container; level++) {
                const links = container.querySelectorAll('a[data-react-aria-pressable="true"]');
                if (links.length > 0) {
                  links.forEach(c => allCards.add(c));
                  break;
                }
                container = container.parentElement;
              }
            }
          }

          // Now check each card for completion status
          // REVERSED LOGIC: Instead of requiring a specific badge,
          // we skip cards that are CONFIRMED completed or known promo/referral cards.
          for (const card of allCards) {
            const cardText = (card.textContent || '').toLowerCase();
            const href = (card.getAttribute('href') || '').toLowerCase();

            // === SKIP CONDITIONS ===

            // 1. Skip cards that are already completed
            const isCompleted =
              cardText.includes('completed') ||
              cardText.includes('hoàn thành') ||
              card.querySelector('[aria-label*="Completed"]') !== null ||
              card.querySelector('[aria-label*="completed"]') !== null ||
              card.getAttribute('data-is-completed') === 'true';
            if (isCompleted) continue;

            // 2. Skip known promo/referral cards (they are not quests)
            const isPromo =
              cardText.includes('referral') ||
              cardText.includes('refer') ||
              cardText.includes('invite') ||
              cardText.includes('giới thiệu') ||
              cardText.includes('mời bạn') ||
              href.includes('referral') ||
              href.includes('invite');
            if (isPromo) continue;

            // 3. Skip cards without any meaningful link (no href or empty)
            if (!href || href === '#' || href === 'javascript:void(0)') continue;

            // === This card is NOT completed and NOT promo → it's a valid quest ===
            card.scrollIntoView({ behavior: 'instant', block: 'center' });
            const rect = card.getBoundingClientRect();

            // Try to find the title of this card
            const titleEl = card.querySelector(
              '.text-globalBody2Strong, [class*="title"], [class*="Title"], h3, h4, strong'
            );
            const title = titleEl ? titleEl.textContent.trim() : '';

            return {
              found: true,
              x: rect.left + rect.width / 2,
              y: rect.top + rect.height / 2,
              title: title
            };
          }

          // Also report total card count for debugging
          return { found: false, totalCards: allCards.size };
        }
      });

      const result = results && results[0] ? results[0].result : null;

      if (!result || !result.found) {
        consecutiveNotFound++;
        // If we haven't found anything for 2 rounds, try scrolling down
        // to reveal hidden "More Activities" cards
        if (consecutiveNotFound === 1) {
          try {
            await chrome.scripting.executeScript({
              target: { tabId: tab.id },
              func: () => { window.scrollBy({ top: 500, behavior: 'smooth' }); }
            });
            await delay(1500);
          } catch (e) {}
        }
        // On 2nd miss, scroll to bottom
        if (consecutiveNotFound === 2) {
          try {
            await chrome.scripting.executeScript({
              target: { tabId: tab.id },
              func: () => { window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' }); }
            });
            await delay(2000);
            // Also try reloading to refresh card states
            await chrome.tabs.update(tab.id, { url: "https://rewards.bing.com/" });
            await waitTabReady(tab.id);
            await delay(2500);
          } catch (e) {}
        }
        continue;
      }

      // Reset consecutive miss counter since we found a card
      consecutiveNotFound = 0;

      update({ statusText: `Quest: ${result.title || 'Clicking...'}` });
      await delay(randomInt(800, 1500));
      if (shouldStop) break;

      // Set up listener for new tab BEFORE clicking
      let newTabPromise = waitNewTab(8000);
      await cdpClick(tab.id, result.x, result.y);
      let newTab = await newTabPromise;

      if (newTab) {
        await waitTabReady(newTab.id);
        // Wait on the quest page for it to register
        await delay(randomInt(3000, 5000));
        if (shouldStop) break;
        try { await chrome.tabs.remove(newTab.id); } catch (e) {}
      } else {
        // Card might have opened in same tab or via JS navigation
        await delay(randomInt(2000, 3000));
      }

      if (shouldStop) break;

      // Return to rewards dashboard and wait for fresh render
      await chrome.tabs.update(tab.id, { active: true, url: "https://rewards.bing.com/" });
      await waitTabReady(tab.id);
      await delay(2000);
    } catch (e) { break; }
  }
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
      // 1. Quests first
      await doQuests();
      if (shouldStop) { finish('Stopped', 'stopped'); return; }

      // 2. Desktop Search
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
