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

function collectQuestItems(value, output, depth = 0) {
  if (!value || depth > 8 || output.length >= 500) return;
  if (Array.isArray(value)) {
    for (const item of value) collectQuestItems(item, output, depth + 1);
    return;
  }
  if (typeof value !== 'object') return;
  const attributes = value.attributes && typeof value.attributes === 'object' ? value.attributes : {};
  const destination = value.destinationUrl || value.destination || attributes.destinationUrl || attributes.destination;
  if (typeof destination === 'string' || questItemStableIdentity(value, attributes)) {
    output.push(value);
  }
  for (const [key, nested] of Object.entries(value)) {
    if (key !== 'attributes') collectQuestItems(nested, output, depth + 1);
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
  const candidates = [];
  const dailyCandidates = [];
  collectQuestItems(flyout.activities, dailyCandidates);
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
  for (const { item, defaultSection, date, source } of candidates) {
    if (!item || typeof item !== 'object') continue;
    const attributes = item.attributes && typeof item.attributes === 'object' ? item.attributes : {};
    if (truthyQuestFlag(item.complete) || truthyQuestFlag(attributes.complete) ||
        truthyQuestFlag(item.hidden) || truthyQuestFlag(attributes.hidden) ||
        truthyQuestFlag(item.isHidden) || truthyQuestFlag(attributes.isHidden) ||
        truthyQuestFlag(item.isTestOnly) || truthyQuestFlag(attributes.isTestOnly)) continue;
    const dailyDate = date || attributes.daily_set_date || item.dailySetDate;
    if (!currentQuestDate(dailyDate, dateKeys)) continue;
    const points = finiteQuestNumber(item.pointProgressMax, attributes.pointProgressMax,
      attributes.max, item.max, attributes.points, item.points);
    const progress = finiteQuestNumber(item.pointProgress, attributes.pointProgress,
      attributes.progress, item.progress, attributes.activityprogress, 0);
    if (!Number.isFinite(points) || points <= 0 || progress >= points) continue;
    const destination = item.destinationUrl || item.destination || attributes.destinationUrl || attributes.destination;
    if (typeof destination !== 'string' || !destination.trim()) continue;
    let url;
    try { url = new URL(destination, 'https://www.bing.com/'); } catch { continue; }
    if (url.protocol !== 'https:' || url.port !== '' || url.username || url.password || !allowedHosts.has(url.hostname)) continue;
    const normalized = url.href;
    const section = dailyDate ? 'Dashboard' : defaultSection;
    const identity = questItemIdentity(item, attributes, normalized, section);
    if (!identity) continue;
    appendQuestActivity(activities, seen, conflicts, { key: identity, url: normalized, points, section,
      ...(includeUi ? { title: String(attributes.title || item.title || '').slice(0, 512),
        ...questUiPolicy(item, attributes, Boolean(dailyDate), section, source) } : {}) }, includeUi);
  }
  return activities.filter(activity => !conflicts.has(activity.key));
}

function extractQuestActivities(payload, now = new Date(), includeUi = false) {
  if (classifyQuestDashboard(payload)) return [];
  if (questFlyout(payload)) return extractFlyoutActivities(payload, now, includeUi);
  const dashboard = questDashboard(payload);
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
  for (const { item, section } of sources) {
    if (!item || typeof item !== 'object') continue;
    const attributes = item.attributes && typeof item.attributes === 'object' ? item.attributes : {};
    if (questItemServerState(item) === 'complete' ||
        [item.hidden, attributes.hidden, item.isHidden, attributes.isHidden, item.isTestOnly, attributes.isTestOnly]
          .some(truthyQuestFlag)) continue;
    if (!currentQuestDate(attributes.daily_set_date || item.dailySetDate, dateKeys)) continue;
    const points = Number(item.pointProgressMax);
    const progress = Number(item.pointProgress || 0);
    if (!Number.isFinite(points) || points <= 0 || progress >= points) continue;
    const destination = item.destinationUrl || item.attributes?.destination;
    if (typeof destination !== 'string' || !destination.trim()) continue;
    let url;
    try { url = new URL(destination, 'https://rewards.bing.com/'); } catch { continue; }
    if (url.protocol !== 'https:' || url.port !== '' || url.username || url.password || !allowedHosts.has(url.hostname)) continue;
    const normalized = url.href;
    const identity = questItemIdentity(item, item.attributes || {}, normalized, section);
    if (!identity) continue;
    appendQuestActivity(activities, seen, conflicts, { key: identity, url: normalized, points, section,
      ...(includeUi ? { title: String(item.title || item.attributes?.title || '').slice(0, 512),
        ...questUiPolicy(item, item.attributes || {}, section === 'Dashboard', section, 'dashboard') } : {}) }, includeUi);
  }
  return activities.filter(activity => !conflicts.has(activity.key));
}

function questActivityServerState(payload, activityKey, now = new Date()) {
  if (typeof activityKey !== 'string' || !activityKey) return 'unknown';
  const candidates = [];
  const dateKeys = questDateKeys(now);
  const flyout = questFlyout(payload);
  if (flyout) {
    const daily = [];
    collectQuestItems(flyout.activities, daily);
    candidates.push(...daily.map(item => ({ item, section: 'Dashboard' })));
    const promotions = [];
    collectQuestItems(flyout.promotions, promotions);
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
