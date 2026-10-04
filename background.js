// ============================================================
// Bing Search Automator - Manifest V3 Background Service Worker
// Official Rewards card activation, server verification and cancellable runs.
// ============================================================

if (typeof importScripts === 'function') importScripts('quest-api.js', 'quest-ui.js');

let state = {
  isRunning: false,
  isPaused: false,
  phase: 'idle',
  current: 0,
  total: 0,
  manualQuestCount: 0,
  statusText: 'Ready'
};
let shouldStop = false;
let isPaused = false;
let pauseResolver = null;
let pauseStartedAt = 0;
let totalPausedMs = 0;
let questTimeoutMs = 10000;
let activeRun = null;
const stopWaiters = new Set();
const STATE_STORAGE_KEY = 'engineState';
const BROWSER_RESTRICTED_STATUS = 'QUEST_BROWSER_RESTRICTED: Browser blocks scripts on this page. Task tab kept open for manual inspection; increasing timeout will not help.';
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
  if (['idle', 'quests', 'search_desktop', 'needs_action', 'complete', 'stopped'].includes(saved.phase)) state.phase = saved.phase;
  state.current = Number.isSafeInteger(saved.current) && saved.current >= 0 ? saved.current : 0;
  state.total = Number.isSafeInteger(saved.total) && saved.total >= 0 ? saved.total : 0;
  state.manualQuestCount = Number.isSafeInteger(saved.manualQuestCount) && saved.manualQuestCount >= 0 && saved.manualQuestCount <= 500 ? saved.manualQuestCount : 0;
  const interruptedStatus = 'Run interrupted by service worker restart. Start again to rescan.';
  const knownStoppedStatuses = [interruptedStatus, BROWSER_RESTRICTED_STATUS, 'Stopped', 'Task tab was closed. Start again to rescan.',
    'Task page timed out. Check your connection and retry.', 'Task failed. Check the Rewards page and retry.',
    'QUEST_SIGN_IN_REQUIRED: Sign in to Microsoft Rewards in Edge, then retry.',
    'QUEST_API_SCHEMA: Rewards returned an unsupported activity format. Open the dashboard and report the new structure.',
    'QUEST_API_NON_JSON: Rewards returned a web page instead of activity data. Open the dashboard, confirm sign-in, then retry.',
    'QUEST_RATE_LIMITED: Rewards asked the extension to slow down. Wait before retrying.',
    'QUEST_API_HTTP: Rewards did not accept the flyout request. Retry later.',
    'QUEST_API_NETWORK: Cannot reach the Rewards flyout. Check the connection and retry.',
    'QUEST_API_TIMEOUT: Rewards did not respond within the configured wait limit.',
    'QUEST_DESTINATION_INVALID: Rewards returned an unsafe or malformed activity destination.'];
  state.statusText = saved.isRunning ? interruptedStatus
    : state.phase === 'complete' ? 'Previous run finished. Check Rewards for completion.'
    : state.phase === 'needs_action' ? 'Some Quest activities still need action; their tabs were kept open.'
    : state.phase === 'stopped' ? (knownStoppedStatuses.includes(saved.statusText) ? saved.statusText : 'Previous run stopped. Start again to rescan.') : 'Ready';
  if (saved.isRunning) state.phase = 'stopped';
  await persistState();
}).catch(() => addLog('Stored state unavailable'));

function requestStop() {
  if (activeRun) activeRun.cancelled = true;
  shouldStop = true;
  if (isPaused && pauseStartedAt) totalPausedMs += Date.now() - pauseStartedAt;
  isPaused = false;
  pauseStartedAt = 0;
  if (pauseResolver) { pauseResolver(); pauseResolver = null; }
  for (const cancel of [...stopWaiters, ...(activeRun?.stopWaiters || [])]) cancel();
  questUiPermits.clear();
  // Release the popup immediately; late Chrome callbacks belong to the old
  // run and must not lock or finish a subsequent run.
  Object.assign(state, { isRunning: false, isPaused: false, phase: 'stopped', statusText: 'Stopped' });
  broadcast();
}

function assertRun(run = activeRun) {
  if (shouldStop || (run && (run.cancelled || run !== activeRun))) throw new Error('STOPPED');
}

function runWaiters(run) { return run?.stopWaiters || stopWaiters; }

// ============================================================
// Utilities
// ============================================================
function delay(ms) { return new Promise(r => setTimeout(r, ms)); }
function runDelay(ms, run = activeRun) {
  return new Promise((resolve, reject) => {
    const waiters = runWaiters(run);
    let handle;
    const onStop = () => { clearTimeout(handle); waiters.delete(onStop); reject(new Error('STOPPED')); };
    try { assertRun(run); } catch (error) { reject(error); return; }
    waiters.add(onStop);
    handle = setTimeout(() => {
      waiters.delete(onStop);
      try { assertRun(run); resolve(); } catch (error) { reject(error); }
    }, ms);
  });
}
function randomInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function activeClock() {
  const currentPause = isPaused && pauseStartedAt ? Date.now() - pauseStartedAt : 0;
  return Date.now() - totalPausedMs - currentPause;
}

function setActiveTimeout(callback, timeoutMs) {
  const started = activeClock();
  let handle;
  const check = () => {
    const remaining = timeoutMs - (activeClock() - started);
    if (remaining <= 0) callback();
    else handle = setTimeout(check, Math.min(250, Math.max(1, remaining)));
  };
  handle = setTimeout(check, Math.min(250, Math.max(1, timeoutMs)));
  return () => clearTimeout(handle);
}

function update(partial, run = activeRun) {
  assertRun(run);
  Object.assign(state, partial);
  broadcast();
}

async function finish(msg, phase, run = activeRun) {
  if (run && (run.cancelled || run !== activeRun)) return;
  state.isRunning = false;
  state.isPaused = false;
  isPaused = false;
  if (pauseResolver) { pauseResolver(); pauseResolver = null; }
  state.phase = phase || 'complete';
  state.statusText = msg;
  broadcast();
  await persistenceQueue;
}

function resetState() {
  activeRun = { cancelled: false, stopWaiters: new Set() };
  state = {
    isRunning: true,
    isPaused: false,
    phase: 'idle',
    current: 0,
    total: 0,
    manualQuestCount: 0,
    statusText: 'Starting...'
  };
  shouldStop = false;
  isPaused = false;
  pauseResolver = null;
  pauseStartedAt = 0;
  totalPausedMs = 0;
  broadcast();
  return activeRun;
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

async function checkPause(run = activeRun) {
  assertRun(run);
  while (isPaused && !shouldStop) {
    await new Promise(resolve => { pauseResolver = resolve; });
    assertRun(run);
  }
  assertRun(run);
}

// ============================================================
// ============================================================
// Tab Helpers
// ============================================================
function waitTabReady(tabId, timeoutMs = 15000, run = activeRun) {
  const waiters = runWaiters(run);
  return new Promise((resolve, reject) => {
    let settled = false;
    const finishWait = error => {
      if (settled) return;
      settled = true;
      cancelTimeout();
      chrome.tabs.onUpdated.removeListener(onUpdated);
      chrome.tabs.onRemoved.removeListener(onRemoved);
      waiters.delete(onStop);
      if (error) reject(new Error(error)); else resolve();
    };
    const onUpdated = (id, info) => { if (id === tabId && info.status === 'complete') { try { assertRun(run); finishWait(); } catch { finishWait('STOPPED'); } } };
    const onRemoved = id => { if (id === tabId) finishWait('TAB_CLOSED'); };
    const onStop = () => finishWait('STOPPED');
    const cancelTimeout = setActiveTimeout(() => finishWait('TAB_TIMEOUT'), timeoutMs);
    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.tabs.onRemoved.addListener(onRemoved);
    waiters.add(onStop);
    try { assertRun(run); } catch { onStop(); return; }
    chrome.tabs.get(tabId, tab => {
      if (run?.cancelled || (run && run !== activeRun)) finishWait('STOPPED');
      else if (chrome.runtime.lastError || !tab) finishWait('TAB_CLOSED');
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
// Query Generator
// General query categories used by the configured search run.
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
// Navigate queries using the configured count and delay range.
// ============================================================
async function doDesktopSearches(cfg, run = activeRun) {
  assertRun(run);
  const count = cfg.desktopSearches;
  if (count <= 0) return;

  update({ phase: 'search_desktop', statusText: 'Desktop Search...', total: count, current: 0 }, run);

  // Create a background tab for searching
  let tab;
  try {
    tab = await chrome.tabs.create({ url: "https://www.bing.com", active: false });
    assertRun(run);
    await waitTabReady(tab.id, 15000, run);
    assertRun(run);
  } catch (e) { assertRun(run); throw e; }

  for (let i = 0; i < count; i++) {
    assertRun(run);
    await checkPause(run);
    assertRun(run);
    update({ current: i + 1 }, run);

    try {
      const q = generateQuery();
      const searchUrl = `https://www.bing.com/search?q=${encodeURIComponent(q)}&form=QBRE`;
      await chrome.tabs.update(tab.id, { url: searchUrl });
      assertRun(run);
      await waitTabReady(tab.id, 15000, run);
      assertRun(run);

      // Stop cancels this delay immediately, including long configured waits.
      if (i < count - 1) {
        const minMs = cfg.minDelay * 1000;
        const maxMs = cfg.maxDelay * 1000;
        await runDelay(randomInt(minMs, maxMs), run);
        assertRun(run);
      }
    } catch (e) { assertRun(run); }
  }

  // Close search tab
  await checkPause(run);
  assertRun(run);
  try { await chrome.tabs.remove(tab.id); assertRun(run); } catch (e) { assertRun(run); }
}

// ============================================================
// Quest Engine: activate the actual card in Bing's official flyout. The site's
// own handler processes the activity; the read API only verifies completion.
async function checkQuestPause(tabSignal, run = activeRun) {
  assertRun(run);
  if (!tabSignal) { await checkPause(run); assertRun(run); return; }
  if (tabSignal.aborted) throw new Error('TAB_CLOSED');
  await new Promise((resolve, reject) => {
    const onClosed = () => {
      tabSignal.removeEventListener('abort', onClosed);
      reject(new Error('TAB_CLOSED'));
    };
    tabSignal.addEventListener('abort', onClosed, { once: true });
    checkPause(run).then(() => {
      tabSignal.removeEventListener('abort', onClosed);
      if (tabSignal.aborted) reject(new Error('TAB_CLOSED')); else resolve();
    }, error => {
      tabSignal.removeEventListener('abort', onClosed);
      reject(error);
    });
  });
  assertRun(run);
}

async function questDelay(ms, tabSignal, run = activeRun) {
  assertRun(run);
  for (let elapsed = 0; elapsed < ms && !shouldStop; elapsed += 100) {
    await checkQuestPause(tabSignal, run);
    assertRun(run);
    if (!shouldStop) await delay(Math.min(100, ms - elapsed));
    assertRun(run);
  }
}

async function fetchQuestDashboard(timeoutMs = questTimeoutMs, tabSignal, run = activeRun) {
  assertRun(run);
  const controller = new AbortController();
  let timedOut = false;
  const onStop = () => controller.abort();
  const onClosed = () => controller.abort();
  const cancelTimeout = setActiveTimeout(() => { timedOut = true; controller.abort(); }, Math.max(1, timeoutMs));
  runWaiters(run).add(onStop);
  tabSignal?.addEventListener('abort', onClosed, { once: true });
  try {
    if (shouldStop) throw new Error('STOPPED');
    if (tabSignal?.aborted) throw new Error('TAB_CLOSED');
    const response = await fetch('https://www.bing.com/rewards/panelflyout/getuserinfo?channel=BingFlyout&partnerId=BingRewards&timestamp=' + Date.now(), {
      method: 'GET',
      credentials: 'include',
      cache: 'no-store',
      headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
      signal: controller.signal
    });
    assertRun(run);
    await checkQuestPause(tabSignal, run);
    if (shouldStop) throw new Error('STOPPED');
    let finalUrl;
    try { finalUrl = new URL(response.url); } catch { throw new Error('QUEST_API_HTTP'); }
    if (finalUrl.protocol !== 'https:' || finalUrl.port !== '' ||
        finalUrl.hostname !== 'www.bing.com' ||
        finalUrl.pathname !== '/rewards/panelflyout/getuserinfo') {
      throw new Error(finalUrl.hostname === 'www.bing.com' ? 'QUEST_API_HTTP' : 'QUEST_SIGN_IN_REQUIRED');
    }
    if (response.status === 401 || response.status === 403) throw new Error('QUEST_SIGN_IN_REQUIRED');
    if (response.status === 429) throw new Error('QUEST_RATE_LIMITED');
    if (!response.ok) throw new Error('QUEST_API_HTTP');
    let payload;
    try {
      payload = await response.json();
    } catch {
      const contentType = response.headers?.get?.('content-type') || '';
      const mediaType = contentType.split(';', 1)[0].trim().toLowerCase();
      const safeType = /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/.test(mediaType) ? mediaType : 'unknown';
      const error = new Error('QUEST_API_NON_JSON');
      error.diagnostic = `status=${response.status},type=${safeType},redirected=${response.redirected ? 'yes' : 'no'}`;
      throw error;
    }
    assertRun(run);
    await checkQuestPause(tabSignal, run);
    if (shouldStop) throw new Error('STOPPED');
    const issue = classifyQuestDashboard(payload);
    if (issue) {
      const error = new Error(issue);
      if (issue === 'QUEST_API_SCHEMA') error.diagnostic = describeQuestDashboard(payload);
      throw error;
    }
    return payload;
  } catch (error) {
    assertRun(run);
    if (shouldStop) throw new Error('STOPPED');
    if (tabSignal?.aborted) throw new Error('TAB_CLOSED');
    if (timedOut || error?.name === 'AbortError') throw new Error('QUEST_API_TIMEOUT');
    if (['QUEST_SIGN_IN_REQUIRED', 'QUEST_RATE_LIMITED', 'QUEST_API_HTTP', 'QUEST_API_SCHEMA', 'QUEST_API_NON_JSON'].includes(error?.message)) throw error;
    throw new Error(navigator.onLine ? 'QUEST_API_NETWORK' : 'NETWORK_OFFLINE');
  } finally {
    cancelTimeout();
    tabSignal?.removeEventListener('abort', onClosed);
    runWaiters(run).delete(onStop);
  }
}

async function loadQuestActivities(run = activeRun) {
  assertRun(run);
  const started = activeClock();
  let lastError;
  const activeElapsed = () => activeClock() - started;
  while (!shouldStop && activeElapsed() < questTimeoutMs) {
    await checkPause(run);
    assertRun(run);
    if (shouldStop) throw new Error('STOPPED');
    const remaining = questTimeoutMs - activeElapsed();
    if (remaining <= 0) break;
    try {
      const payload = await fetchQuestDashboard(remaining, undefined, run);
      assertRun(run);
      const activities = extractQuestActivities(payload, new Date(), true);
      const promotionCount = Array.isArray(payload?.userInfo?.promotions)
        ? payload.userInfo.promotions.length : 0;
      addLog(`Quest flyout: promotions=${promotionCount}, eligible=${activities.length}`);
      return activities;
    } catch (error) {
      lastError = error;
      addLog('Quest API probe: ' + (['QUEST_API_TIMEOUT', 'QUEST_API_HTTP', 'QUEST_API_NETWORK', 'NETWORK_OFFLINE',
        'QUEST_SIGN_IN_REQUIRED', 'QUEST_RATE_LIMITED', 'QUEST_API_SCHEMA', 'QUEST_API_NON_JSON', 'STOPPED'].includes(error.message)
        ? error.message : 'QUEST_API_UNAVAILABLE'));
      if (error.message === 'QUEST_API_SCHEMA' &&
          /^(?:wrapped=(yes|no),user=(yes|no),daily=(missing|null|array|object|string|number|boolean|function|symbol|bigint),more=(missing|null|array|object|string|number|boolean|function|symbol|bigint)|source=flyout,rewards=(yes|no|unknown),activities=(missing|null|array|object|string|number|boolean|function|symbol|bigint),promotions=(missing|null|array|object|string|number|boolean|function|symbol|bigint))$/.test(error.diagnostic || '')) {
        addLog('Quest API schema: ' + error.diagnostic);
      }
      if (error.message === 'QUEST_API_NON_JSON' &&
          /^status=\d{3},type=[a-z0-9!#$&^_.+\/-]{1,80},redirected=(yes|no)$/.test(error.diagnostic || '')) {
        addLog('Quest API response: ' + error.diagnostic);
      }
      if (!['QUEST_API_HTTP', 'QUEST_API_NETWORK'].includes(error.message)) throw error;
      const delayMs = Math.min(1000, questTimeoutMs - activeElapsed());
      if (delayMs > 0) await questDelay(delayMs, undefined, run);
    }
  }
  throw lastError || new Error('QUEST_API_TIMEOUT');
}

function validQuestActivity(activity) {
  if (!activity || typeof activity.key !== 'string' || !activity.key ||
      typeof activity.url !== 'string') return false;
  try {
    const url = new URL(activity.url);
    return url.protocol === 'https:' && url.port === '' && !url.username && !url.password &&
      ['www.bing.com', 'bing.com', 'rewards.bing.com', 'rewards.microsoft.com'].includes(url.hostname);
  } catch {
    return false;
  }
}

async function waitForQuestCredit(activityKey, timeoutMs = questTimeoutMs, tabSignal, run = activeRun) {
  assertRun(run);
  const started = activeClock();
  let completeObservations = 0;
  const activeElapsed = () => activeClock() - started;
  while (!shouldStop && activeElapsed() < timeoutMs) {
    await checkQuestPause(tabSignal, run);
    assertRun(run);
    if (shouldStop) throw new Error('STOPPED');
    const remaining = timeoutMs - activeElapsed();
    if (remaining <= 0) break;
    try {
      const payload = await fetchQuestDashboard(remaining, tabSignal, run);
      assertRun(run);
      const serverState = questActivityServerState(payload, activityKey);
      completeObservations = serverState === 'complete' ? completeObservations + 1 : 0;
      // Require affirmative completion twice. Missing, filtered or changed
      // activities are inconclusive and must never be counted as credit.
      if (completeObservations >= 2) return true;
    } catch (error) {
      if (error.message === 'QUEST_API_TIMEOUT') return false;
      if (!['QUEST_API_HTTP', 'QUEST_API_NETWORK'].includes(error.message)) throw error;
      addLog('Quest verification retry: ' + error.message);
    }
    const delayMs = Math.min(750, timeoutMs - activeElapsed());
    if (delayMs > 0) await questDelay(delayMs, tabSignal, run);
  }
  if (shouldStop) throw new Error('STOPPED');
  return false;
}

const questUiPermits = new Map();

function grantQuestUiPermit(msg, sender) {
  const permit = typeof msg.nonce === 'string' ? questUiPermits.get(msg.nonce) : null;
  let url;
  try { url = new URL(sender.url); } catch { return { ok: false, error: 'QUEST_ACTIVATION_DENIED' }; }
  if (!permit || sender.id !== chrome.runtime.id || sender.tab?.id !== permit.tabId ||
      sender.documentId !== permit.documentId || url.protocol !== 'https:' || url.port ||
      url.hostname !== 'www.bing.com' || url.pathname !== '/rewards/panelflyout') {
    return { ok: false, error: 'QUEST_ACTIVATION_DENIED' };
  }
  questUiPermits.delete(msg.nonce);
  if (shouldStop || !state.isRunning || (permit.run && (permit.run.cancelled || permit.run !== activeRun))) return { ok: false, error: 'STOPPED' };
  if (isPaused) return { ok: false, error: 'QUEST_UI_PAUSED' };
  if (Date.now() > permit.expiresAt) return { ok: false, error: 'QUEST_SCRIPT_TIMEOUT' };
  return { ok: true, expiresAt: Math.min(permit.expiresAt, Date.now() + 250) };
}

async function probeQuestCard(tabId, activity, mode, documentId, signature, tabSignal, timeoutMs = questTimeoutMs, run = activeRun) {
  await checkQuestPause(tabSignal, run);
  assertRun(run);
  const waiters = runWaiters(run);
  const expiresAt = Date.now() + timeoutMs;
  const nonce = mode === 'activate' ? crypto.randomUUID() : '';
  if (nonce) questUiPermits.set(nonce, { tabId, documentId, expiresAt, run });
  try {
    const results = await new Promise((resolve, reject) => {
      let settled = false;
      const settle = (error, value) => {
        if (settled) return;
        settled = true;
        cancelTimeout();
        waiters.delete(onStop);
        tabSignal?.removeEventListener('abort', onClosed);
        if (error) reject(error); else resolve(value);
      };
      const onStop = () => settle(new Error('STOPPED'));
      const onClosed = () => settle(new Error('TAB_CLOSED'));
      const cancelTimeout = setActiveTimeout(() => settle(new Error('QUEST_SCRIPT_TIMEOUT')), timeoutMs);
      waiters.add(onStop);
      tabSignal?.addEventListener('abort', onClosed, { once: true });
      try {
        assertRun(run);
        Promise.resolve(chrome.scripting.executeScript({
          target: documentId ? { tabId, documentIds: [documentId] } : { tabId, frameIds: [0] },
          func: probeQuestUi,
          args: [activity, mode, signature || '', expiresAt, nonce]
        })).then(value => settle(null, value), error => settle(error));
      } catch (error) { settle(error); }
    });
    await checkQuestPause(tabSignal, run);
    assertRun(run);
    const frame = results?.[0];
    if (!frame?.result || !frame.documentId) throw new Error('QUEST_NO_RESULT');
    return { ...frame.result, documentId: frame.documentId };
  } catch (error) {
    assertRun(run);
    if (tabSignal?.aborted) throw new Error('TAB_CLOSED');
    // Edge can report a temporary error/old frame between the tab's load event
    // and the real document commit. Only read-only scans may retry this state.
    if (mode === 'scan' && /Frame with ID \d+ is showing error page|No frame with id|No document with id/i.test(error?.message || '')) {
      return { status: 'QUEST_CARD_NOT_READY' };
    }
    if (/extensions gallery|cannot access|not allowed|cannot be scripted/i.test(error?.message || '')) {
      throw new Error('QUEST_BROWSER_RESTRICTED');
    }
    if (/^(QUEST_|STOPPED|TAB_CLOSED)/.test(error?.message || '')) throw error;
    throw new Error('QUEST_SCRIPT_FAILED');
  } finally {
    if (nonce) questUiPermits.delete(nonce);
  }
}

async function activateQuestCard(tabId, activity, tabSignal, run = activeRun, activatedCards) {
  assertRun(run);
  const started = activeClock();
  let diagnostic;
  while (activeClock() - started < questTimeoutMs) {
    let probe;
    try {
      probe = await probeQuestCard(tabId, activity, 'scan', null, '', tabSignal,
        Math.max(1, questTimeoutMs - (activeClock() - started)), run);
      assertRun(run);
    } catch (error) {
      // A timed-out read cannot have activated anything. Preserve the last
      // diagnostic and let this card reach needs_action; never retry a click.
      if (error.message === 'QUEST_SCRIPT_TIMEOUT') break;
      throw error;
    }
    if (probe.diagnostic) diagnostic = probe.diagnostic;
    if (probe.status === 'QUEST_CARD_READY') {
      let fingerprint;
      if (activatedCards) {
        let matched;
        try { matched = JSON.parse(probe.signature); } catch { throw new Error('QUEST_CARD_CHANGED'); }
        if (!Array.isArray(matched) || matched.length !== 3 || typeof matched[0] !== 'string' ||
            typeof matched[1] !== 'string' || !Number.isSafeInteger(matched[2]) || matched[2] <= 0) {
          throw new Error('QUEST_CARD_CHANGED');
        }
        fingerprint = questActivationFingerprint({ url: matched[0], title: matched[1], points: matched[2] });
        if (activatedCards.has(fingerprint)) {
          addLog('Quest duplicate activation suppressed');
          return false;
        }
      }
      // Pin the document and re-check the card synchronously. Readiness probes
      // never install callbacks that could click after Stop or timeout.
      const remaining = questTimeoutMs - (activeClock() - started);
      if (remaining <= 0) break;
      const activated = await probeQuestCard(tabId, activity, 'activate', probe.documentId, probe.signature, tabSignal, remaining, run);
      assertRun(run);
      if (activated.status === 'QUEST_UI_PAUSED') continue; // Explicit denial means no click occurred.
      if (activated.status !== 'QUEST_CARD_ACTIVATED') throw new Error(activated.status);
      if (fingerprint) activatedCards.add(fingerprint);
      addLog('Quest official card activated');
      return true;
    }
    if (probe.status !== 'QUEST_CARD_NOT_READY') throw new Error(probe.status);
    await questDelay(Math.min(200, questTimeoutMs - (activeClock() - started)), tabSignal, run);
    assertRun(run);
  }
  assertRun(run);
  const fields = ['cards', 'visible', 'pending', 'urlMatches', 'titleMatches', 'pointMatches', 'completed', 'inprogress', 'locked'];
  if (diagnostic && fields.every(key => Number.isInteger(diagnostic[key]) && diagnostic[key] >= 0 && diagnostic[key] <= 500)) {
    addLog('Quest card scan: ' + fields.map(key => key + '=' + diagnostic[key]).join(','));
  }
  throw new Error('QUEST_CARD_NOT_READY');
}

async function refreshQuestActivity(activity, tabSignal, run = activeRun) {
  assertRun(run);
  const started = activeClock();
  while (activeClock() - started < questTimeoutMs) {
    await checkQuestPause(tabSignal, run);
    assertRun(run);
    if (shouldStop) throw new Error('STOPPED');
    const remaining = questTimeoutMs - (activeClock() - started);
    if (remaining <= 0) break;
    try {
      const payload = await fetchQuestDashboard(remaining, tabSignal, run);
      assertRun(run);
      const now = new Date();
      const fresh = extractQuestActivities(payload, now, true).find(item => item.key === activity.key);
      return { serverState: questActivityServerState(payload, activity.key, now), activity: fresh || null };
    } catch (error) {
      if (!['QUEST_API_HTTP', 'QUEST_API_NETWORK'].includes(error.message)) throw error;
      addLog('Quest refresh retry: ' + error.message);
      await questDelay(Math.min(1000, Math.max(0, questTimeoutMs - (activeClock() - started))), tabSignal, run);
    }
  }
  if (shouldStop) throw new Error('STOPPED');
  throw new Error('QUEST_API_TIMEOUT');
}

function questNavigationMatches(actual, expected) {
  const normalize = value => {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.port || url.username || url.password ||
        !['www.bing.com', 'bing.com', 'rewards.bing.com', 'rewards.microsoft.com'].includes(url.hostname)) return '';
    for (const key of [...url.searchParams.keys()]) if (key.toLowerCase() === 'form') url.searchParams.delete(key);
    url.searchParams.sort();
    return url.href;
  };
  try { const left = normalize(actual); return !!left && left === normalize(expected); } catch { return false; }
}

async function openManualQuests(tasks, run) {
  const opened = new Set();
  for (const { activity, resultTabs = [] } of tasks) {
    await checkPause(run);
    assertRun(run);
    if (!validQuestActivity(activity)) throw new Error('QUEST_DESTINATION_INVALID');
    if (opened.has(activity.url)) continue;
    let alreadyOpen = false;
    for (const id of resultTabs) {
      const tab = await chrome.tabs.get(id).catch(() => null);
      assertRun(run);
      if (tab && questNavigationMatches(tab.url || tab.pendingUrl, activity.url)) { alreadyOpen = true; break; }
    }
    if (!alreadyOpen) {
      await chrome.tabs.create({ url: activity.url, active: false });
      assertRun(run);
    }
    opened.add(activity.url);
  }
  assertRun(run);
  update({ manualQuestCount: tasks.length }, run);
}

function questActivationFingerprint(activity) {
  const url = new URL(activity.url);
  for (const key of [...url.searchParams.keys()]) if (key.toLowerCase() === 'form') url.searchParams.delete(key);
  url.searchParams.sort();
  return JSON.stringify([url.href, String(activity.title || '').trim().replace(/\s+/g, ' '), activity.points]);
}

async function doQuests(run = activeRun) {
  assertRun(run);
  addLog('Quest scanner: official-cards-v17');
  update({ phase: 'quests', statusText: 'Reading Rewards activities...', current: 0, total: 0, manualQuestCount: 0 }, run);
  const discovered = await loadQuestActivities(run);
  assertRun(run);
  if (discovered.some(activity => !validQuestActivity(activity))) throw new Error('QUEST_DESTINATION_INVALID');
  const { automatic: activities, manual } = partitionQuestActivities(discovered);
  const activatedCards = new Set();
  const manualTasks = manual.map(activity => ({ activity }));
  update({ total: activities.length, statusText: activities.length + ' activities' }, run);
  addLog('Quest plan: daily=' + activities.filter(activity => activity.daily).length +
    ',earn=' + activities.filter(activity => !activity.daily && activity.section === 'Earn').length + ',manual=' + manualTasks.length);
  if (activities.length === 0) {
    await openManualQuests(manualTasks, run);
    assertRun(run);
    return manualTasks.length > 0;
  }
  await checkPause(run);
  assertRun(run);
  const flyoutUrl = 'https://www.bing.com/rewards/panelflyout?channel=BingFlyout&partnerId=BingRewards';
  const tab = await chrome.tabs.create({ url: flyoutUrl, active: true });
  assertRun(run);
  for (let index = 0; index < activities.length; index++) {
    assertRun(run);
    let activity = activities[index];
    if (!validQuestActivity(activity)) throw new Error('QUEST_DESTINATION_INVALID');
    update({ statusText: 'Waiting for Quest card ' + (index + 1) + '/' + activities.length }, run);
    const tabController = new AbortController();
    const candidates = new Set();
    const children = new Set();
    let armed = false;
    const observeChild = child => {
      if (!armed || run?.cancelled || run !== activeRun || child.openerTabId !== tab.id) return;
      candidates.add(child.id);
      if (questNavigationMatches(child.pendingUrl || child.url, activity.url)) children.add(child.id);
    };
    const onCreated = child => observeChild(child);
    const onUpdated = (id, info) => {
      if (candidates.has(id) && questNavigationMatches(info.url, activity.url)) children.add(id);
    };
    const onRemoved = id => { if (id === tab.id || children.has(id)) tabController.abort(); };
    chrome.tabs.onRemoved.addListener(onRemoved);
    chrome.tabs.onCreated.addListener(onCreated);
    chrome.tabs.onUpdated.addListener(onUpdated);
    let credited = false;
    let pendingReason = '';
    try {
      await checkQuestPause(tabController.signal, run);
      assertRun(run);
      // Each scan uses fresh official UI, including after same-tab navigation.
      if (index > 0) await chrome.tabs.update(tab.id, { url: flyoutUrl, active: true });
      assertRun(run);
      await waitTabReady(tab.id, questTimeoutMs, run);
      await checkQuestPause(tabController.signal, run);
      assertRun(run);
      const refreshed = await refreshQuestActivity(activity, tabController.signal, run);
      assertRun(run);
      if (refreshed.serverState === 'complete') {
        credited = await waitForQuestCredit(activity.key, questTimeoutMs, tabController.signal, run);
        pendingReason = credited ? '' : 'QUEST_CREDIT_UNCONFIRMED';
      } else if (!refreshed.activity) {
        pendingReason = 'QUEST_OFFER_UNAVAILABLE';
      } else if (!canActivateQuestActivity(refreshed.activity)) {
        activity = refreshed.activity;
        pendingReason = 'QUEST_MANUAL_REQUIRED';
      } else {
        activity = refreshed.activity;
        if (!validQuestActivity(activity)) throw new Error('QUEST_DESTINATION_INVALID');
        const fingerprint = questActivationFingerprint(activity);
        if (activatedCards.has(fingerprint)) {
          // Raw/rendered fallback identities can describe one physical card.
          // Reconcile credit for this ID, but never replay its handler.
          addLog('Quest duplicate activation suppressed');
        } else {
          armed = true;
          await activateQuestCard(tab.id, activity, tabController.signal, run, activatedCards);
          assertRun(run);
          activatedCards.add(fingerprint);
        }
        for (const childId of children) await waitTabReady(childId, questTimeoutMs, run);
        update({ statusText: 'Verifying Quest activity ' + (index + 1) + '/' + activities.length }, run);
        credited = await waitForQuestCredit(activity.key, questTimeoutMs, tabController.signal, run);
        assertRun(run);
        for (const childId of children) await waitTabReady(childId, questTimeoutMs, run);
        pendingReason = credited ? '' : 'QUEST_CREDIT_UNCONFIRMED';
      }
      await checkQuestPause(tabController.signal, run);
    } catch (error) {
      assertRun(run);
      // These results definitively mean no click was dispatched. Preserve the
      // target as unconfirmed and continue, rather than aborting other offers.
      // Uncertain activation, browser, network, sign-in, Stop and tab errors
      // remain terminal and are never automatically replayed.
      if (!['QUEST_CARD_NOT_READY', 'QUEST_CARD_AMBIGUOUS', 'QUEST_CARD_CHANGED'].includes(error.message)) throw error;
      pendingReason = error.message;
      const refreshed = await refreshQuestActivity(activity, tabController.signal, run);
      assertRun(run);
      if (refreshed.serverState === 'complete') {
        credited = await waitForQuestCredit(activity.key, questTimeoutMs, tabController.signal, run);
      }
      await checkQuestPause(tabController.signal, run);
    } finally {
      chrome.tabs.onRemoved.removeListener(onRemoved);
      chrome.tabs.onCreated.removeListener(onCreated);
      chrome.tabs.onUpdated.removeListener(onUpdated);
    }
    // Do not yield for Pause after dropping the close listeners.
    assertRun(run);
    if (tabController.signal.aborted) throw new Error('TAB_CLOSED');
    if (credited) {
      update({ current: state.current + 1,
        statusText: (state.current + 1) + '/' + activities.length + ' activities confirmed' }, run);
      // Keep official UI and result tabs visible. A site-created tab could
      // also have been opened manually; never close it based on opener alone.
      addLog('Quest activity ' + (index + 1) + '/' + activities.length + ' confirmed');
    } else {
      manualTasks.push({ activity, resultTabs: [...children] });
      update({ statusText: state.current + '/' + activities.length + ' confirmed; ' + manualTasks.length + ' need action' }, run);
      addLog('Quest activity ' + (index + 1) + '/' + activities.length + ' needs action: ' + pendingReason);
      addLog('Quest activity ' + (index + 1) + '/' + activities.length + ' not confirmed; task tab kept open');
    }
  }
  await openManualQuests(manualTasks, run);
  assertRun(run);
  addLog('Quest verification finished: confirmed=' + state.current + ',manual=' + manualTasks.length);
  return manualTasks.length > 0;
}

// ============================================================
// Engine Orchestrator
// ============================================================
async function runEngine(action, cfg) {
  if (state.isRunning) return;
  const run = resetState();
  questTimeoutMs = (cfg?.questTimeoutSeconds ?? 10) * 1000;

  try {
    await persistenceQueue;
    assertRun(run);
    let questNeedsAction = false;
    let questHadActivities = false;
    if (action === 'START_QUEST') {
      questNeedsAction = await doQuests(run);
      assertRun(run);
      questHadActivities = state.total > 0;
    }
    else if (action === 'START_DESKTOP') {
      await doDesktopSearches(cfg, run);
      assertRun(run);
    }
    else if (action === 'START_ALL') {
      // 1. Run Quests first (shows Quest progress bar)
      questNeedsAction = await doQuests(run);
      assertRun(run);
      questHadActivities = state.total > 0;
      // Manual offers are handed to the user; they do not block searches.
      await doDesktopSearches(cfg, run);
      assertRun(run);
    }

    if (shouldStop) {
      await finish('Stopped', 'stopped', run);
    } else if (questNeedsAction) {
      await finish(state.manualQuestCount > 0 ? `${state.manualQuestCount} quests need your action; tabs opened.`
        : 'Some Quest activities still need action; their tabs were kept open.', 'needs_action', run);
    } else {
      await finish(action !== 'START_QUEST' ? 'Completed!'
        : questHadActivities ? 'Quest activities confirmed by Rewards.'
        : 'No eligible Quest offers found; check Rewards for credit.', 'complete', run);
    }
  } catch (e) {
    // A stopped run may reject long after a replacement starts. Its error is
    // deliberately ignored; it cannot change the replacement's state.
    if (run.cancelled || run !== activeRun) return;
    const reasons = {
      TAB_CLOSED: 'Task tab was closed. Start again to rescan.',
      TAB_TIMEOUT: 'Task page timed out. Check your connection and retry.',
      NETWORK_OFFLINE: 'NETWORK_OFFLINE: Browser reports offline. Reconnect, then start again.',
      QUEST_CONTENT_TIMEOUT: 'QUEST_CONTENT_TIMEOUT: Page is still loading. Increase Quest wait limit and retry.',
      QUEST_CARDS_EMPTY: 'QUEST_CARDS_EMPTY: Section found but no cards loaded. Check Rewards manually.',
      QUEST_SCRIPT_TIMEOUT: 'QUEST_SCRIPT_TIMEOUT: Page did not respond. Check the tab and retry.',
      QUEST_SCRIPT_FAILED: 'QUEST_SCRIPT_FAILED: Cannot read page. Check site access, navigation and connection.',
      QUEST_NO_RESULT: 'QUEST_NO_RESULT: Script returned no data. Reload extension and retry; inspect the task tab console.',
      QUEST_DOM_FAILED: 'QUEST_DOM_FAILED: Page scanner failed. Send the Quest DOM failure stage from service worker logs.',
      QUEST_ACCESS_DENIED: 'QUEST_ACCESS_DENIED: Cannot access page. Check extension site access for Bing and Rewards.',
      QUEST_API_UNSUPPORTED: 'QUEST_API_UNSUPPORTED: Browser rejected the scripting API options. Update Edge and reload extension.',
      QUEST_BROWSER_RESTRICTED: BROWSER_RESTRICTED_STATUS,
      QUEST_CONTENT_UNAVAILABLE: 'QUEST_CONTENT_UNAVAILABLE: Rewards content bridge did not load. Reload the extension and the task tab, then retry.',
      QUEST_SIGN_IN_REQUIRED: 'QUEST_SIGN_IN_REQUIRED: Sign in to Microsoft Rewards in Edge, then retry.',
      QUEST_API_SCHEMA: 'QUEST_API_SCHEMA: Rewards returned an unsupported activity format. Open the dashboard and report the new structure.',
      QUEST_API_NON_JSON: 'QUEST_API_NON_JSON: Rewards returned a web page instead of activity data. Open the dashboard, confirm sign-in, then retry.',
      QUEST_RATE_LIMITED: 'QUEST_RATE_LIMITED: Rewards asked the extension to slow down. Wait before retrying.',
      QUEST_API_HTTP: 'QUEST_API_HTTP: Rewards did not accept the flyout request. Retry later.',
      QUEST_API_NETWORK: 'QUEST_API_NETWORK: Cannot reach the Rewards flyout. Check the connection and retry.',
      QUEST_API_TIMEOUT: 'QUEST_API_TIMEOUT: Rewards did not respond within the configured wait limit.',
      QUEST_DESTINATION_INVALID: 'QUEST_DESTINATION_INVALID: Rewards returned an unsafe or malformed activity destination.',
      QUEST_CARD_NOT_READY: 'QUEST_CARD_NOT_READY: Official Quest card has not loaded or no longer matches. Flyout kept open; increase wait limit or inspect it.',
      QUEST_CARD_AMBIGUOUS: 'QUEST_CARD_AMBIGUOUS: Multiple pending cards match. Select the correct card manually in the open flyout.',
      QUEST_PAGE_INVALID: 'QUEST_PAGE_INVALID: The official flyout redirected or is unavailable. Inspect the open tab and sign-in.',
      QUEST_ACTIVITY_INVALID: 'QUEST_ACTIVITY_INVALID: Activity metadata cannot safely identify an official card.',
      QUEST_CARD_CHANGED: 'QUEST_CARD_CHANGED: Card changed before activation. Start again to rescan.',
      QUEST_CARD_ACTIVATION_FAILED: 'QUEST_CARD_ACTIVATION_FAILED: The official card could not be activated. Inspect the open flyout.',
      QUEST_ACTIVATION_DENIED: 'QUEST_ACTIVATION_DENIED: The click authorization expired or was rejected. Start again to rescan.',
      QUEST_PAGE_CHANGED: 'QUEST_PAGE_CHANGED: Official Quest page changed before activation. Start again to rescan.',
      'Quest page unavailable; check sign-in': 'Quest page unavailable; check sign-in.',
      'Quest layout/section unavailable; check sign-in or selectors': 'Quest layout/section unavailable; check sign-in or selectors.',
      'Quest scan failed': 'Quest scan failed. Check the Rewards page and retry.',
      STOPPED: 'Stopped'
    };
    await finish(shouldStop ? 'Stopped' : reasons[e.message] || 'Task failed. Check the Rewards page and retry.', 'stopped', run);
    addLog(shouldStop ? 'Run stopped' : 'Run failed; state saved for inspection');
  }
}

// ============================================================
// Message Listeners
// ============================================================
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.action === 'QUEST_UI_PERMIT') {
    sendResponse(grantQuestUiPermit(msg, sender));
    return false;
  }
  if (!msg || !['GET_STATUS', 'STOP', 'PAUSE', 'RESUME', 'START_QUEST', 'START_DESKTOP', 'START_ALL'].includes(msg.action)) return false;
  if (sender.id !== chrome.runtime.id || sender.url !== chrome.runtime.getURL('popup.html')) {
    sendResponse({ ok: false, error: 'Unauthorized sender' });
    return false;
  }
  stateReady.then(async () => {
    if (msg.action === 'GET_STATUS') { sendResponse({ ...state }); return; }
    if (msg.action.startsWith('START_')) {
      if (state.isRunning) { sendResponse({ ok: false, error: 'A run is already active', state: { ...state } }); return; }
      const cfg = msg.config;
      if (cfg?.questTimeoutSeconds !== undefined && (!Number.isInteger(cfg.questTimeoutSeconds) || cfg.questTimeoutSeconds < 10 || cfg.questTimeoutSeconds > 300)) {
        sendResponse({ ok: false, error: 'Quest wait limit must be 10–300 seconds', state: { ...state } }); return;
      }
      if (msg.action !== 'START_QUEST' && (!cfg || !Number.isInteger(cfg.desktopSearches) || cfg.desktopSearches < 1 || cfg.desktopSearches > 1000 ||
        !Number.isFinite(cfg.minDelay) || !Number.isFinite(cfg.maxDelay) || cfg.minDelay < 1 || cfg.maxDelay < cfg.minDelay || cfg.maxDelay > 3600)) {
        sendResponse({ ok: false, error: 'Invalid search configuration', state: { ...state } }); return;
      }
      void runEngine(msg.action, cfg);
    } else if (msg.action === 'STOP' && state.isRunning) {
      requestStop();
      sendResponse({ ok: true, state: { ...state } });
      return;
    } else if (msg.action === 'PAUSE' && state.isRunning && !shouldStop && !isPaused) {
      isPaused = true;
      pauseStartedAt = Date.now();
      update({ isPaused: true, statusText: 'Paused' });
    } else if (msg.action === 'RESUME' && state.isRunning && !shouldStop && isPaused) {
      if (pauseStartedAt) totalPausedMs += Date.now() - pauseStartedAt;
      pauseStartedAt = 0;
      isPaused = false;
      if (pauseResolver) { pauseResolver(); pauseResolver = null; }
      update({ isPaused: false, statusText: 'Resuming...' });
    }
    await persistenceQueue;
    sendResponse({ ok: true, state: { ...state } });
  }).catch(() => sendResponse({ ok: false, error: 'Command failed' }));
  return true;
});
