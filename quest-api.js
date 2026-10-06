// Pure Microsoft Rewards dashboard parsing shared by the MV3 service worker and tests.
function questDashboard(payload) {
  if (!payload || typeof payload !== 'object') return null;
  if (payload.flyoutResult && typeof payload.flyoutResult === 'object') return payload.flyoutResult;
  return payload.dashboard && typeof payload.dashboard === 'object' ? payload.dashboard : payload;
}

function questFlyout(payload) {
  if (!payload || typeof payload !== 'object' || !payload.userInfo || typeof payload.userInfo !== 'object') return null;
  const looksLikeFlyout = 'isRewardsUser' in payload || 'isRewardsUser' in payload.userInfo ||
    'activities' in payload.userInfo || 'promotions' in payload.userInfo;
  if (!looksLikeFlyout) return null;
  return payload.userInfo;
}

function classifyQuestDashboard(payload) {
  if (payload?.isRewardsUser === false) return 'QUEST_SIGN_IN_REQUIRED';
  const flyout = questFlyout(payload);
  if (flyout) {
    if (payload.isRewardsUser === false || flyout.isRewardsUser === false) return 'QUEST_SIGN_IN_REQUIRED';
    // The signed-in flyout may omit this collection or return it as null while
    // placing all current cards in promotions.
    const activitiesValid = flyout.activities == null || typeof flyout.activities === 'object';
    if (!activitiesValid || !Array.isArray(flyout.promotions)) return 'QUEST_API_SCHEMA';
    return null;
  }
  const dashboard = questDashboard(payload);
  if (!dashboard) {
    return 'QUEST_SIGN_IN_REQUIRED';
  }
  const hasCollections = 'dailySetPromotions' in dashboard || 'morePromotions' in dashboard;
  if (!hasCollections) return 'userStatus' in dashboard ? 'QUEST_API_SCHEMA' : 'QUEST_SIGN_IN_REQUIRED';
  if (!dashboard.dailySetPromotions || Array.isArray(dashboard.dailySetPromotions) ||
      typeof dashboard.dailySetPromotions !== 'object' || !Array.isArray(dashboard.morePromotions)) {
    return 'QUEST_API_SCHEMA';
  }
  return null;
}

function questValueType(value) {
  if (value === undefined) return 'missing';
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

// Return only field presence/types. Never include values from the signed-in account.
function describeQuestDashboard(payload) {
  const flyout = questFlyout(payload);
  if (flyout) {
    const rewards = payload.isRewardsUser === true || flyout.isRewardsUser === true ? 'yes'
      : payload.isRewardsUser === false || flyout.isRewardsUser === false ? 'no' : 'unknown';
    return `source=flyout,rewards=${rewards},activities=${questValueType(flyout.activities)},` +
      `promotions=${questValueType(flyout.promotions)}`;
  }
  const wrapped = Boolean(payload && typeof payload === 'object' &&
    payload.dashboard && typeof payload.dashboard === 'object');
  const dashboard = questDashboard(payload);
  return `wrapped=${wrapped ? 'yes' : 'no'},user=${dashboard && 'userStatus' in dashboard ? 'yes' : 'no'},` +
    `daily=${questValueType(dashboard?.dailySetPromotions)},more=${questValueType(dashboard?.morePromotions)}`;
}

// Earn's multi-step Quests are a different group from one-card Keep earning
// activities. Ignore their whole subtree so steps cannot become standalone
// offers when nested promotion data is flattened. Daily Set quiz metadata is
// deliberately preserved; titles and destination wording are not classifiers.
function isExcludedEarnQuest(item, attributes = item?.attributes || {}, dailyContext = false) {
  if (!item || typeof item !== 'object') return false;
  const questKinds = new Set(['quest', 'questcard', 'punchcard', 'multistepquest', 'searchstreak']);
  const kinds = [item.promotionType, attributes.promotionType, attributes.type]
    .filter(value => typeof value === 'string')
    .map(value => value.toLowerCase().replace(/[^a-z0-9]/g, ''));
  if (kinds.some(kind => questKinds.has(kind))) return true;
  const daily = dailyContext || Boolean(item.dailySetDate || attributes.daily_set_date);
  if (!daily && (truthyQuestFlag(item.inProgress) || truthyQuestFlag(attributes.inProgress))) return true;
  const steps = finiteQuestNumber(item.activityProgressMax, attributes.activityProgressMax);
  return !daily && Number.isFinite(steps) && steps > 1;
}

function excludedEarnQuestIds(payload) {
  const excluded = new Set();
  let visited = 0;
  const visit = (value, insideExcluded = false, depth = 0) => {
    if (!value || typeof value !== 'object' || depth > 10 || visited++ >= 5000) return;
    if (Array.isArray(value)) { for (const child of value) visit(child, insideExcluded, depth + 1); return; }
    const attributes = value.attributes && typeof value.attributes === 'object' ? value.attributes : {};
    const skip = insideExcluded || isExcludedEarnQuest(value, attributes);
    const id = questItemStableIdentity(value, attributes);
    if (skip && id) excluded.add(id);
    for (const [key, child] of Object.entries(value)) {
      if (key !== 'attributes') visit(child, skip, depth + 1);
    }
  };
  const flyout = questFlyout(payload);
  const dashboard = questDashboard(payload);
  // Daily Set is a separate source. Inspect only Earn groups and propagate
  // exclusions by stable identity, never by title or shared destination URL.
  visit(flyout?.promotions);
  visit(dashboard?.morePromotions);
  return excluded;
}

function collectQuestItems(value, output, depth = 0, dailyContext = false, applyScope = true) {
  if (!value || depth > 8 || output.length >= 500) return;
  if (Array.isArray(value)) {
    for (const item of value) collectQuestItems(item, output, depth + 1, dailyContext, applyScope);
    return;
  }
  if (typeof value !== 'object') return;
  const attributes = value.attributes && typeof value.attributes === 'object' ? value.attributes : {};
  if (applyScope && isExcludedEarnQuest(value, attributes, dailyContext)) return;
  const destination = value.destinationUrl || value.destination || attributes.destinationUrl || attributes.destination;
  if (typeof destination === 'string' || questItemStableIdentity(value, attributes)) {
    output.push(value);
  }
  for (const [key, nested] of Object.entries(value)) {
    if (key !== 'attributes') collectQuestItems(nested, output, depth + 1, dailyContext, applyScope);
  }
}

function truthyQuestFlag(value) {
  return value === true || value === 1 || (typeof value === 'string' && value.toLowerCase() === 'true');
}

function finiteQuestNumber(...values) {
  for (const value of values) {
    if (value === undefined || value === null || value === '') continue;
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return NaN;
}

function questItemStableIdentity(item, attributes) {
  const stableId = attributes.offerid || item.offerId;
  if (typeof stableId === 'string' && stableId && stableId.length <= 512) return stableId;
  return null;
}

function questItemIdentity(item, attributes, normalizedUrl, section) {
  const stableId = questItemStableIdentity(item, attributes);
  if (stableId) return stableId;
  const name = typeof item.name === 'string' ? item.name : '';
  const fallback = section + '|' + name + '|' + normalizedUrl;
  return fallback.length <= 2048 ? fallback : null;
}

function questItemServerState(item) {
  const attributes = item.attributes && typeof item.attributes === 'object' ? item.attributes : {};
  if (truthyQuestFlag(item.complete) || truthyQuestFlag(attributes.complete)) return 'complete';
  const points = finiteQuestNumber(item.pointProgressMax, attributes.pointProgressMax,
    attributes.max, item.max, attributes.points, item.points);
  const progress = finiteQuestNumber(item.pointProgress, attributes.pointProgress,
    attributes.progress, item.progress, attributes.activityprogress);
  if (Number.isFinite(points) && points > 0 && Number.isFinite(progress)) {
    return progress >= points ? 'complete' : 'pending';
  }
  if ('complete' in item || 'complete' in attributes) return 'pending';
  return 'unknown';
}

function questDateKeys(now) {
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const year = String(now.getFullYear());
  return new Set([
    `${month}/${day}/${year}`,
    `${Number(month)}/${Number(day)}/${year}`,
    `${year}-${month}-${day}`
  ]);
}

function currentQuestDate(value, dateKeys) {
  return !value || dateKeys.has(String(value)) || [...dateKeys].some(date =>
    /^\d{4}-\d{2}-\d{2}$/.test(date) && String(value).startsWith(date + 'T'));
}

function completedQuestIds(candidates, dateKeys) {
  const ids = new Set();
  for (const { item, date } of candidates) {
    if (!item || typeof item !== 'object') continue;
    const attributes = item.attributes && typeof item.attributes === 'object' ? item.attributes : {};
    if (!currentQuestDate(date || attributes.daily_set_date || item.dailySetDate, dateKeys)) continue;
    const id = questItemStableIdentity(item, attributes);
    if (id && questItemServerState(item) === 'complete') ids.add(id);
  }
  return ids;
}

function appendQuestActivity(activities, seen, conflicts, activity, includeUi) {
  const previous = seen.get(activity.key);
  if (previous) {
    if (includeUi && (previous.url !== activity.url || previous.title !== activity.title || previous.points !== activity.points)) {
      conflicts.add(activity.key);
    }
    if (includeUi) {
      previous.daily ||= activity.daily;
      previous.manualOnly ||= activity.manualOnly;
      previous.autoEligible = !previous.manualOnly && (previous.autoEligible || activity.autoEligible);
    }
    return;
  }
  seen.set(activity.key, activity);
  activities.push(activity);
}

// Eligibility allows one official card activation, not automatic completion
// of the destination. Quiz labels or URL shape cannot tell whether a click is
// sufficient; the read-only server verification decides after the activation.
function questUiPolicy(item, attributes, daily, section, source) {
  const explicitlyFalse = value => value === false || value === 0 ||
    (typeof value === 'string' && value.toLowerCase() === 'false');
  const unavailable = [item.isRewardable, attributes.isRewardable, item.isEnabled, attributes.isEnabled].some(explicitlyFalse) ||
    truthyQuestFlag(item.inProgress) || truthyQuestFlag(attributes.inProgress) ||
    [item.exclusiveLockedFeatureStatus, attributes.exclusiveLockedFeatureStatus]
      .some(value => String(value || '').toLowerCase() === 'locked');
  const manualOnly = unavailable;
  return { daily, autoEligible: (daily || section === 'Earn') && !manualOnly, manualOnly, source };
}

function canActivateQuestActivity(activity) {
  return activity?.autoEligible === true && (activity.daily === true || activity.section === 'Earn');
}

function partitionQuestActivities(activities) {
  const automatic = [], manual = [];
  for (const activity of Array.isArray(activities) ? activities : []) {
    (canActivateQuestActivity(activity) ? automatic : manual).push(activity);
  }
  return { automatic, manual };
}

function extractFlyoutActivities(payload, now, includeUi = false) {
  const flyout = questFlyout(payload);
  if (!flyout) return [];
  const excludedIds = excludedEarnQuestIds(payload);
  const candidates = [];
  const dailyCandidates = [];
  collectQuestItems(flyout.activities, dailyCandidates, 0, true);
  candidates.push(...dailyCandidates.map(item => ({ item, defaultSection: 'Dashboard', source: 'flyout' })));
  const promotionCandidates = [];
  collectQuestItems(flyout.promotions, promotionCandidates);
  candidates.push(...promotionCandidates.map(item => ({ item, defaultSection: 'Earn', source: 'flyout' })));

  // The rendered official UI uses the transformed flyoutResult, which may
  // contain Daily Set cards omitted from the raw userInfo promotion list.
  const rendered = payload.flyoutResult;
  const dateKeys = questDateKeys(now);
  if (rendered && typeof rendered === 'object') {
    for (const [date, items] of Object.entries(rendered.dailySetPromotions || {})) {
      if (dateKeys.has(date) && Array.isArray(items)) {
        candidates.push(...items.map(item => ({ item, defaultSection: 'Dashboard', date, source: 'dashboard' })));
      }
    }
    if (Array.isArray(rendered.morePromotions)) {
      candidates.push(...rendered.morePromotions.map(item => ({ item, defaultSection: 'Earn', source: 'dashboard' })));
    }
  }

  const allowedHosts = new Set(['www.bing.com', 'bing.com', 'rewards.bing.com', 'rewards.microsoft.com']);
  const activities = [];
  const seen = new Map();
  const conflicts = new Set();
  const completed = completedQuestIds(candidates, dateKeys);
  for (const { item, defaultSection, date, source } of candidates) {
    if (!item || typeof item !== 'object') continue;
    const attributes = item.attributes && typeof item.attributes === 'object' ? item.attributes : {};
    const dailyDate = date || attributes.daily_set_date || item.dailySetDate;
    const dailyContext = Boolean(dailyDate) || defaultSection === 'Dashboard';
    if (!dailyContext && excludedIds.has(questItemStableIdentity(item, attributes))) continue;
    if (isExcludedEarnQuest(item, attributes, Boolean(date) || defaultSection === 'Dashboard')) continue;
    if (truthyQuestFlag(item.hidden) || truthyQuestFlag(attributes.hidden) ||
        truthyQuestFlag(item.isHidden) || truthyQuestFlag(attributes.isHidden) ||
        truthyQuestFlag(item.isTestOnly) || truthyQuestFlag(attributes.isTestOnly)) continue;
    if (!currentQuestDate(dailyDate, dateKeys)) continue;
    const points = finiteQuestNumber(item.pointProgressMax, attributes.pointProgressMax,
      attributes.max, item.max, attributes.points, item.points);
    const progress = finiteQuestNumber(item.pointProgress, attributes.pointProgress,
      attributes.progress, item.progress, attributes.activityprogress, 0);
    if (!Number.isFinite(points) || points <= 0) continue;
    const destination = item.destinationUrl || item.destination || attributes.destinationUrl || attributes.destination;
    if (typeof destination !== 'string' || !destination.trim()) continue;
    let url;
    try { url = new URL(destination, 'https://www.bing.com/'); } catch { continue; }
    if (url.protocol !== 'https:' || url.port !== '' || url.username || url.password || !allowedHosts.has(url.hostname)) continue;
    const normalized = url.href;
    const section = dailyDate ? 'Dashboard' : defaultSection;
    const identity = questItemIdentity(item, attributes, normalized, section);
    if (!identity) continue;
    // Completion in either current source suppresses replay, even if another
    // API representation is stale. Credit verification remains stricter.
    if (questItemServerState(item) === 'complete') { completed.add(identity); continue; }
    if (progress >= points) continue;
    appendQuestActivity(activities, seen, conflicts, { key: identity, url: normalized, points, section,
      ...(includeUi ? { title: String(attributes.title || item.title || '').slice(0, 512),
        ...questUiPolicy(item, attributes, Boolean(dailyDate), section, source) } : {}) }, includeUi);
  }
  return activities.filter(activity => !conflicts.has(activity.key) && !completed.has(activity.key));
}

function extractQuestActivities(payload, now = new Date(), includeUi = false) {
  if (classifyQuestDashboard(payload)) return [];
  if (questFlyout(payload)) return extractFlyoutActivities(payload, now, includeUi);
  const dashboard = questDashboard(payload);
  const excludedIds = excludedEarnQuestIds(payload);
  const dateKeys = questDateKeys(now);
  const daily = Object.entries(dashboard.dailySetPromotions)
    .filter(([date, items]) => dateKeys.has(date) && Array.isArray(items))
    .flatMap(([, items]) => items);
  const sources = [
    ...daily.map(item => ({ item, section: 'Dashboard' })),
    ...dashboard.morePromotions.map(item => ({ item, section: 'Earn' }))
  ];
  const allowedHosts = new Set(['www.bing.com', 'bing.com', 'rewards.bing.com', 'rewards.microsoft.com']);
  const activities = [];
  const seen = new Map();
  const conflicts = new Set();
  const completed = completedQuestIds(sources, dateKeys);
  for (const { item, section } of sources) {
    if (!item || typeof item !== 'object') continue;
    const attributes = item.attributes && typeof item.attributes === 'object' ? item.attributes : {};
    if (section !== 'Dashboard' && !item.dailySetDate && !attributes.daily_set_date &&
        excludedIds.has(questItemStableIdentity(item, attributes))) continue;
    if (isExcludedEarnQuest(item, attributes, section === 'Dashboard')) continue;
    if ([item.hidden, attributes.hidden, item.isHidden, attributes.isHidden, item.isTestOnly, attributes.isTestOnly]
          .some(truthyQuestFlag)) continue;
    if (!currentQuestDate(attributes.daily_set_date || item.dailySetDate, dateKeys)) continue;
    const points = Number(item.pointProgressMax);
    const progress = Number(item.pointProgress || 0);
    if (!Number.isFinite(points) || points <= 0) continue;
    const destination = item.destinationUrl || item.attributes?.destination;
    if (typeof destination !== 'string' || !destination.trim()) continue;
    let url;
    try { url = new URL(destination, 'https://rewards.bing.com/'); } catch { continue; }
    if (url.protocol !== 'https:' || url.port !== '' || url.username || url.password || !allowedHosts.has(url.hostname)) continue;
    const normalized = url.href;
    const identity = questItemIdentity(item, item.attributes || {}, normalized, section);
    if (!identity) continue;
    if (questItemServerState(item) === 'complete') { completed.add(identity); continue; }
    if (progress >= points) continue;
    appendQuestActivity(activities, seen, conflicts, { key: identity, url: normalized, points, section,
      ...(includeUi ? { title: String(item.title || item.attributes?.title || '').slice(0, 512),
        ...questUiPolicy(item, item.attributes || {}, section === 'Dashboard', section, 'dashboard') } : {}) }, includeUi);
  }
  return activities.filter(activity => !conflicts.has(activity.key) && !completed.has(activity.key));
}

function questActivityServerState(payload, activityKey, now = new Date()) {
  if (typeof activityKey !== 'string' || !activityKey) return 'unknown';
  const candidates = [];
  const dateKeys = questDateKeys(now);
  const flyout = questFlyout(payload);
  if (flyout) {
    const daily = [];
    // Scope controls planning, not credit evidence. An excluded group's
    // reference to a real Daily Set card must not hide conflicting progress.
    collectQuestItems(flyout.activities, daily, 0, true, false);
    candidates.push(...daily.map(item => ({ item, section: 'Dashboard' })));
    const promotions = [];
    collectQuestItems(flyout.promotions, promotions, 0, false, false);
    candidates.push(...promotions.map(item => ({ item, section: 'Earn' })));
    const rendered = payload.flyoutResult;
    if (rendered && typeof rendered === 'object') {
      for (const [date, items] of Object.entries(rendered.dailySetPromotions || {})) {
        if (dateKeys.has(date) && Array.isArray(items)) {
          candidates.push(...items.map(item => ({ item, section: 'Dashboard' })));
        }
      }
      if (Array.isArray(rendered.morePromotions)) {
        candidates.push(...rendered.morePromotions.map(item => ({ item, section: 'Earn' })));
      }
    }
  } else {
    const dashboard = questDashboard(payload);
    if (!dashboard || typeof dashboard !== 'object') return 'unknown';
    if (dashboard.dailySetPromotions && typeof dashboard.dailySetPromotions === 'object' &&
        !Array.isArray(dashboard.dailySetPromotions)) {
      for (const [date, items] of Object.entries(dashboard.dailySetPromotions)) {
        if (dateKeys.has(date) && Array.isArray(items)) {
          candidates.push(...items.map(item => ({ item, section: 'Dashboard' })));
        }
      }
    }
    if (Array.isArray(dashboard.morePromotions)) {
      candidates.push(...dashboard.morePromotions.map(item => ({ item, section: 'Earn' })));
    }
  }
  let complete = false;
  let unknown = false;
  for (const { item, section } of candidates) {
    if (!item || typeof item !== 'object') continue;
    const attributes = item.attributes && typeof item.attributes === 'object' ? item.attributes : {};
    const dailyDate = attributes.daily_set_date || item.dailySetDate;
    if (!currentQuestDate(dailyDate, dateKeys)) continue;
    const destination = item.destinationUrl || item.destination || attributes.destinationUrl || attributes.destination;
    let identity = questItemStableIdentity(item, attributes);
    if (!identity) {
      if (typeof destination !== 'string' || !destination.trim()) continue;
      let normalized;
      try { normalized = new URL(destination, flyout ? 'https://www.bing.com/' : 'https://rewards.bing.com/').href; } catch { continue; }
      identity = questItemIdentity(item, attributes, normalized, dailyDate ? 'Dashboard' : section);
    }
    if (identity !== activityKey) continue;
    const status = questItemServerState(item);
    if (status === 'pending') return 'pending';
    if (status === 'complete') complete = true;
    else unknown = true;
  }
  return complete && !unknown ? 'complete' : 'unknown';
}
