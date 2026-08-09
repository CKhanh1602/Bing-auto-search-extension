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
// Quest Engine v4 - 2-Page Parallel Pipeline
// Page 1: /dashboard → "Quests" section
// Page 2: /earn      → "Keep earning" section
// ============================================================// Helper: Process all quest cards on the CURRENT page in tab
async function processQuestsOnPage(tab, pageName) {
  let rounds = 0;
  const MAX_ROUNDS = 3;

  while (rounds < MAX_ROUNDS) {
    if (shouldStop) break;
    await checkPause();
    if (shouldStop) break;
    rounds++;

    // Step-by-step scroll down and up to force React lazy rendering
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: async () => {
          const totalHeight = document.body.scrollHeight;
          let currentPos = 0;
          while (currentPos < totalHeight) {
            window.scrollBy(0, 400);
            currentPos += 400;
            await new Promise(r => setTimeout(r, 100));
          }
          await new Promise(r => setTimeout(r, 500));
          window.scrollTo({ top: 0, behavior: 'instant' });
        }
      });
      await delay(800);
    } catch (e) {}

    // ── Scan uncompleted cards ──
    let scanResult;
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        args: [pageName],
        func: (isEarnPage) => {
          let cardPool = [];

          if (isEarnPage === 'Earn') {
            // ── EARN PAGE: STRICTLY target ONLY the "Keep Earning" section ──
            const headings = Array.from(document.querySelectorAll('h2, h3, [role="heading"], div'));
            const keepEarningHeading = headings.find(h => {
              const txt = (h.textContent || '').toLowerCase().trim();
              return txt === 'keep earning' || txt.includes('keep earning');
            });

            if (keepEarningHeading) {
              let container = keepEarningHeading.parentElement;
              for (let level = 0; level < 5 && container; level++) {
                const links = container.querySelectorAll('a[data-react-aria-pressable="true"], a[href], [role="button"]');
                if (links.length >= 2) {
                  cardPool = Array.from(links);
                  break;
                }
                container = container.parentElement;
              }
            }

            if (cardPool.length === 0) {
              cardPool = Array.from(document.querySelectorAll('a[data-react-aria-pressable="true"]'));
            }
          } else {
            // ── DASHBOARD PAGE: Comprehensive card discovery ──
            const selectors = [
              '#dailyset a',
              '#moreactivities a',
              '#more-activities a',
              '[id*="daily"] a',
              '[id*="more"] a',
              'a[data-react-aria-pressable="true"]',
              'div[data-react-aria-pressable="true"]',
              '[class*="card"] a[href]',
              '[class*="Card"] a[href]'
            ];
            const set = new Set();
            for (const sel of selectors) {
              document.querySelectorAll(sel).forEach(el => set.add(el));
            }
            cardPool = Array.from(set);
          }

          const checkValid = (card) => {
            const t = (card.textContent || '').toLowerCase();
            const h = (card.getAttribute('href') || '').toLowerCase();
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

          const uncompleted = [];
          for (const card of cardPool) {
            if (!checkValid(card)) continue;

            card.scrollIntoView({ behavior: 'instant', block: 'center' });
            const newRect = card.getBoundingClientRect();
            const titleEl = card.querySelector('.text-globalBody2Strong, [class*="title"], [class*="Title"], h3, h4, strong');
            uncompleted.push({
              x: newRect.left + newRect.width / 2,
              y: newRect.top + newRect.height / 2,
              title: titleEl ? titleEl.textContent.trim() : ''
            });
          }
          return { cards: uncompleted, totalScanned: cardPool.length };
        }
      });
      scanResult = results && results[0] ? results[0].result : null;
    } catch (e) { break; }

    if (!scanResult || !scanResult.cards || scanResult.cards.length === 0) {
      break;
    }

    const cards = scanResult.cards;
    update({ statusText: `${pageName}: Found ${cards.length} tasks`, total: cards.length, current: 0 });

    // ── Click all cards rapidly ──
    const openedTabs = [];
    const beforeTabs = new Set((await chrome.tabs.query({})).map(t => t.id));

    for (let i = 0; i < cards.length; i++) {
      if (shouldStop) break;
      update({ current: i + 1, statusText: `${pageName}: ${cards[i].title || `Card ${i + 1}/${cards.length}`}` });

      // Re-scroll to first uncompleted card
      try {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          args: [pageName],
          func: (isEarnPage) => {
            let cardPool = [];
            if (isEarnPage === 'Earn') {
              const headings = Array.from(document.querySelectorAll('h2, h3, [role="heading"], div'));
              const keepEarningHeading = headings.find(h => (h.textContent || '').toLowerCase().trim().includes('keep earning'));
              if (keepEarningHeading) {
                let container = keepEarningHeading.parentElement;
                for (let level = 0; level < 5 && container; level++) {
                  const links = container.querySelectorAll('a[data-react-aria-pressable="true"], a[href], [role="button"]');
                  if (links.length >= 2) { cardPool = Array.from(links); break; }
                  container = container.parentElement;
                }
              }
              if (cardPool.length === 0) cardPool = Array.from(document.querySelectorAll('a[data-react-aria-pressable="true"]'));
            } else {
              const selectors = ['#dailyset a', '#moreactivities a', '#more-activities a', '[id*="daily"] a', '[id*="more"] a', 'a[data-react-aria-pressable="true"]', 'div[data-react-aria-pressable="true"]'];
              const set = new Set();
              for (const sel of selectors) document.querySelectorAll(sel).forEach(el => set.add(el));
              cardPool = Array.from(set);
            }

            const checkValid = (card) => {
              const t = (card.textContent || '').toLowerCase();
              const h = (card.getAttribute('href') || '').toLowerCase();
              const r = card.getBoundingClientRect();
              if (r.width < 50 || r.height < 30) return false;
              if (card.getAttribute('role') === 'tab' || card.closest('[role="tablist"], [role="tab"]')) return false;
              if (card.closest('header, nav, footer, [role="navigation"], [class*="Header"], [class*="header"], [class*="navigation"], [class*="navBar"], [class*="navbar"], [class*="nav_"], [class*="Nav_"]')) return false;
              if (h.includes('/about') || h.includes('/refer') || h.includes('/redeem') || h.includes('/status') || h.includes('/welcome') || h.includes('/shop') || h.includes('/dashboard') || h.includes('/earn') || h.includes('/dash')) return false;
              const cleanTxt = t.trim();
              if (cleanTxt === 'dashboard' || cleanTxt === 'earn' || cleanTxt === 'redeem' || cleanTxt === 'about' || cleanTxt === 'refer and earn' || t.includes('trạng thái') || t.includes('người chiến thắng')) return false;
              if (t.includes('completed') || t.includes('hoàn thành')) return false;
              if (card.querySelector('[aria-label*="Completed"]') || card.querySelector('[aria-label*="completed"]')) return false;
              if (card.getAttribute('data-is-completed') === 'true') return false;
              if (t.includes('referral') || t.includes('refer a friend') || t.includes('invite') || t.includes('giới thiệu') || t.includes('mời bạn')) return false;
              if (t.includes('score') && t.includes('searches')) return false;
              if (t.includes('points for') && t.includes('search')) return false;
              if (t.includes('search and earn')) return false;
              if (t.includes('in progress') || t.includes('streak') || t.includes('in a row')) return false;
              if (t.includes('for 7 days') || t.includes('for 14 days') || t.includes('chuỗi ngày')) return false;
              if (t.includes('bing app') || (t.includes('search engine') && t.includes('default'))) return false;
              if (t.includes('game pass') || (t.includes('xbox') && !t.includes('quiz'))) return false;
              if (!h || h === '#' || h === 'javascript:void(0)') return false;
              if (t.trim().length < 5) return false;
              if (t.includes('tasks') || t.includes('expires in') || t.includes('taskbar')) return false;
              if (card.closest('[id*="quest"], [class*="quest"], [class*="Quest"]')) return false;
              return true;
            };

            for (const card of cardPool) {
              if (!checkValid(card)) continue;
              card.scrollIntoView({ behavior: 'instant', block: 'center' });
              return true;
            }
            return false;
          }
        });
      } catch (e) {}

      await delay(randomInt(300, 600));

      let pos;
      try {
        const posResult = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          args: [pageName],
          func: (isEarnPage) => {
            let cardPool = [];
            if (isEarnPage === 'Earn') {
              const headings = Array.from(document.querySelectorAll('h2, h3, [role="heading"], div'));
              const keepEarningHeading = headings.find(h => (h.textContent || '').toLowerCase().trim().includes('keep earning'));
              if (keepEarningHeading) {
                let container = keepEarningHeading.parentElement;
                for (let level = 0; level < 5 && container; level++) {
                  const links = container.querySelectorAll('a[data-react-aria-pressable="true"], a[href], [role="button"]');
                  if (links.length >= 2) { cardPool = Array.from(links); break; }
                  container = container.parentElement;
                }
              }
              if (cardPool.length === 0) cardPool = Array.from(document.querySelectorAll('a[data-react-aria-pressable="true"]'));
            } else {
              const selectors = ['#dailyset a', '#moreactivities a', '#more-activities a', '[id*="daily"] a', '[id*="more"] a', 'a[data-react-aria-pressable="true"]', 'div[data-react-aria-pressable="true"]'];
              const set = new Set();
              for (const sel of selectors) document.querySelectorAll(sel).forEach(el => set.add(el));
              cardPool = Array.from(set);
            }

            const checkValid = (card) => {
              const t = (card.textContent || '').toLowerCase();
              const h = (card.getAttribute('href') || '').toLowerCase();
              const r = card.getBoundingClientRect();
              if (r.width < 50 || r.height < 30) return false;
              if (card.getAttribute('role') === 'tab' || card.closest('[role="tablist"], [role="tab"]')) return false;
              if (card.closest('header, nav, footer, [role="navigation"], [class*="Header"], [class*="header"], [class*="navigation"], [class*="navBar"], [class*="navbar"], [class*="nav_"], [class*="Nav_"]')) return false;
              if (h.includes('/about') || h.includes('/refer') || h.includes('/redeem') || h.includes('/status') || h.includes('/welcome') || h.includes('/shop') || h.includes('/dashboard') || h.includes('/earn') || h.includes('/dash')) return false;
              const cleanTxt = t.trim();
              if (cleanTxt === 'dashboard' || cleanTxt === 'earn' || cleanTxt === 'redeem' || cleanTxt === 'about' || cleanTxt === 'refer and earn' || t.includes('trạng thái') || t.includes('người chiến thắng')) return false;
              if (t.includes('completed') || t.includes('hoàn thành')) return false;
              if (card.querySelector('[aria-label*="Completed"]') || card.querySelector('[aria-label*="completed"]')) return false;
              if (card.getAttribute('data-is-completed') === 'true') return false;
              if (t.includes('referral') || t.includes('refer a friend') || t.includes('invite') || t.includes('giới thiệu') || t.includes('mời bạn')) return false;
              if (t.includes('score') && t.includes('searches')) return false;
              if (t.includes('points for') && t.includes('search')) return false;
              if (t.includes('search and earn')) return false;
              if (t.includes('in progress') || t.includes('streak') || t.includes('in a row')) return false;
              if (t.includes('for 7 days') || t.includes('for 14 days') || t.includes('chuỗi ngày')) return false;
              if (t.includes('bing app') || (t.includes('search engine') && t.includes('default'))) return false;
              if (t.includes('game pass') || (t.includes('xbox') && !t.includes('quiz'))) return false;
              if (!h || h === '#' || h === 'javascript:void(0)') return false;
              if (t.trim().length < 5) return false;
              if (t.includes('tasks') || t.includes('expires in') || t.includes('taskbar')) return false;
              if (card.closest('[id*="quest"], [class*="quest"], [class*="Quest"]')) return false;
              return true;
            };

            for (const card of cardPool) {
              if (!checkValid(card)) continue;
              const rect = card.getBoundingClientRect();
              return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
            }
            return null;
          }
        });
        pos = posResult && posResult[0] ? posResult[0].result : null;
      } catch (e) {}

      if (!pos) break;

      await cdpClick(tab.id, pos.x, pos.y);
      await delay(randomInt(800, 1200));
      try { await chrome.tabs.update(tab.id, { active: true }); } catch (e) {}
    }

    // ── Collect & close quest tabs ──
    await delay(1000);
    const afterTabs = await chrome.tabs.query({});
    for (const t of afterTabs) {
      if (!beforeTabs.has(t.id) && t.id !== tab.id) openedTabs.push(t.id);
    }

    if (openedTabs.length > 0) {
      update({ statusText: `${pageName}: Waiting for ${openedTabs.length} tasks...` });
      await delay(randomInt(4000, 6000));
      for (const tid of openedTabs) {
        try { await chrome.tabs.remove(tid); } catch (e) {}
      }
    }

    if (shouldStop) break;

    // Reload and rescan
    update({ statusText: `${pageName}: Refreshing...` });
    try {
      await chrome.tabs.reload(tab.id);
      await waitTabReady(tab.id);
      await delay(2500);
    } catch (e) { break; }
  }
}

// Navigate tab to a page, wait for load, scroll to load all content
async function navigateAndPrepare(tab, url) {
  await chrome.tabs.update(tab.id, { url, active: true });
  await waitTabReady(tab.id);
  await delay(2500);
}

// Main Quest function: scans BOTH pages sequentially (/dashboard then /earn)
async function doQuests() {
  update({ phase: 'quests', statusText: 'Processing Quests...' });

  let tab;
  try {
    tab = await chrome.tabs.create({ url: "https://rewards.bing.com/dashboard", active: true });
    await waitTabReady(tab.id);
  } catch (e) { return; }
  if (shouldStop) return;

  // ── PAGE 1: /dashboard → "Quests" section ──
  addLog('📋 Scanning /dashboard (Quests)...');
  update({ statusText: 'Quests: Scanning /dashboard...' });
  await processQuestsOnPage(tab, 'Dashboard');
  if (shouldStop) { try { await chrome.tabs.remove(tab.id); } catch(e){} return; }

  // ── PAGE 2: /earn → "Keep earning" section ONLY ──
  addLog('📋 Scanning /earn (Keep Earning section only)...');
  update({ statusText: 'Quests: Switching to /earn...' });
  await navigateAndPrepare(tab, "https://rewards.bing.com/earn");
  await processQuestsOnPage(tab, 'Earn');

  // Close the quest tab when done
  try { await chrome.tabs.remove(tab.id); } catch (e) {}
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
      // Run Search in background WHILE doing Quests (parallel)
      const searchPromise = doDesktopSearches(cfg);

      // Run Quests on foreground
      await doQuests();
      if (shouldStop) { finish('Stopped', 'stopped'); return; }

      // Wait for search to finish (it may already be done)
      update({ statusText: 'Waiting for search to finish...' });
      await searchPromise;
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
