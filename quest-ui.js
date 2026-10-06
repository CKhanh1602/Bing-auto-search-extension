// Synchronous probe injected into the official Bing Rewards flyout.
// It only locates one server-described pending card and invokes that card's
// ordinary click handler; reward reporting remains owned by Bing's page code.
function probeQuestUi(activity, mode, expectedSignature, expiresAt, permitNonce) {
  const result = status => ({ status });
  if (mode === 'activate' && typeof permitNonce === 'string') {
    if (!permitNonce || typeof chrome === 'undefined' ||
        typeof chrome.runtime?.sendMessage !== 'function') {
      return Promise.resolve(result('QUEST_ACTIVATION_DENIED'));
    }
    try {
      return Promise.resolve(chrome.runtime.sendMessage({ action: 'QUEST_UI_PERMIT', nonce: permitNonce }))
        .then(permit => {
          if (!permit?.ok || !Number.isFinite(permit.expiresAt)) {
            return result(typeof permit?.error === 'string' && permit.error
              ? permit.error : 'QUEST_ACTIVATION_DENIED');
          }
          const boundedExpiry = Number.isFinite(expiresAt)
            ? Math.min(expiresAt, permit.expiresAt) : permit.expiresAt;
          return probeQuestUi(activity, mode, expectedSignature, boundedExpiry);
        }, () => result('QUEST_ACTIVATION_DENIED'));
    } catch {
      return Promise.resolve(result('QUEST_ACTIVATION_DENIED'));
    }
  }
  const allowedDestinations = new Set([
    'www.bing.com', 'bing.com', 'rewards.bing.com', 'rewards.microsoft.com'
  ]);

  if (location.protocol !== 'https:' || location.hostname !== 'www.bing.com' ||
      location.port !== '' || location.pathname !== '/rewards/panelflyout') {
    return result('QUEST_PAGE_INVALID');
  }
  if (!['scan', 'activate'].includes(mode) || !activity || typeof activity !== 'object' ||
      typeof activity.url !== 'string' || !Number.isSafeInteger(activity.points) || activity.points <= 0 ||
      (activity.title !== undefined && typeof activity.title !== 'string')) {
    return result('QUEST_ACTIVITY_INVALID');
  }
  const activationExpired = () => mode === 'activate' && expiresAt !== undefined &&
    (!Number.isFinite(expiresAt) || Date.now() > expiresAt);
  if (activationExpired()) {
    return result('QUEST_SCRIPT_TIMEOUT');
  }

  const canonicalUrl = value => {
    let url;
    try { url = new URL(value, 'https://www.bing.com/'); } catch { return null; }
    if (url.protocol !== 'https:' || url.port !== '' || url.username || url.password ||
        !allowedDestinations.has(url.hostname)) return null;

    // FlyoutLink replaces the offer's FORM value with the flyout partner form
    // code. Ignore that page-owned parameter and no other value.
    for (const name of [...new Set([...url.searchParams.keys()].filter(key => key.toLowerCase() === 'form'))]) {
      url.searchParams.delete(name);
    }
    url.searchParams.sort();
    return url.href;
  };

  const expectedUrl = canonicalUrl(activity.url);
  if (!expectedUrl) return result('QUEST_ACTIVITY_INVALID');
  const expectedTitle = typeof activity.title === 'string'
    ? activity.title.trim().replace(/\s+/g, ' ') : '';

  const isDisabled = element => {
    if (!element) return true;
    if (element.hasAttribute?.('disabled') || element.getAttribute?.('aria-disabled') === 'true') return true;
    if (element.closest?.('[disabled], [aria-disabled="true"]')) return true;
    try { return element.matches?.(':disabled') === true; } catch { return true; }
  };
  const isVisible = element => {
    if (!element || element.hidden || element.getAttribute?.('aria-hidden') === 'true') return false;
    if (element.closest?.('[hidden], [aria-hidden="true"]')) return false;
    let style;
    try { style = getComputedStyle(element); } catch { return false; }
    if (!style || style.display === 'none' || style.visibility === 'hidden' ||
        style.visibility === 'collapse' || style.opacity === '0') return false;
    try {
      const rect = element.getBoundingClientRect();
      return element.getClientRects().length > 0 && rect.width > 0 && rect.height > 0;
    } catch {
      return false;
    }
  };
  const parsePoints = element => {
    if (!element) return null;
    const text = String(element.textContent || '').trim();
    if (!/^\+?[\d\s,.\u00a0]+$/.test(text)) return null;
    const digits = text.replace(/\D/g, '');
    if (!digits) return null;
    const value = Number(digits);
    return Number.isSafeInteger(value) && value > 0 ? value : null;
  };

  const matches = [];
  let completedMatch = false;
  const diagnostic = {
    cards: 0, visible: 0, pending: 0, urlMatches: 0, titleMatches: 0,
    pointMatches: 0, completed: 0, inprogress: 0, locked: 0
  };
  for (const card of document.querySelectorAll('.promo_cont')) {
    if (diagnostic.cards >= 500) break;
    diagnostic.cards++;
    if (!isVisible(card) || isDisabled(card)) continue;
    diagnostic.visible++;
    const completed = Boolean(card.querySelector('.pc.complete'));
    const inprogress = Boolean(card.querySelector('.pc.inprogress'));
    const locked = Boolean(card.querySelector('.locked_overlay') || card.querySelector('.pc.locked_point'));
    if (completed) diagnostic.completed++;
    if (inprogress) diagnostic.inprogress++;
    if (locked) diagnostic.locked++;
    if (inprogress || locked) continue;

    const anchor = card.querySelector('a.block[href]');
    const titleElement = card.querySelector('.promo-title');
    const pointElement = card.querySelector(completed ? '.pc.complete .point'
      : '.pc:not(.complete):not(.inprogress):not(.locked_point) .point');
    if (!anchor || typeof anchor.click !== 'function' || !isVisible(anchor) || isDisabled(anchor)) continue;

    const actualHref = (() => {
      try { return new URL(anchor.href || anchor.getAttribute('href'), location.href).href; } catch { return null; }
    })();
    const actualUrl = actualHref && canonicalUrl(actualHref);
    const title = String(titleElement?.textContent || '').trim().replace(/\s+/g, ' ');
    const points = parsePoints(pointElement);
    if (!actualUrl || !points) continue;
    if (completed) {
      if (actualUrl === expectedUrl && (!expectedTitle || title === expectedTitle) && points === activity.points) {
        completedMatch = true;
      }
      continue;
    }
    diagnostic.pending++;
    if (actualUrl !== expectedUrl) continue;
    diagnostic.urlMatches++;
    if (expectedTitle && title !== expectedTitle) continue;
    diagnostic.titleMatches++;
    if (points !== activity.points) continue;
    diagnostic.pointMatches++;

    matches.push({ anchor, signature: JSON.stringify([actualHref, title, points]) });
  }

  // Page completion is a reason to suppress activation, never proof of new
  // server credit. Prefer suppression if a stale pending alias also exists.
  if (completedMatch) return result('QUEST_CARD_COMPLETE');
  if (matches.length === 0) return mode === 'scan'
    ? { status: 'QUEST_CARD_NOT_READY', diagnostic }
    : result('QUEST_CARD_NOT_READY');
  if (matches.length !== 1) return result('QUEST_CARD_AMBIGUOUS');
  const match = matches[0];
  if (mode === 'scan') return { status: 'QUEST_CARD_READY', signature: match.signature };
  if (typeof expectedSignature !== 'string' || expectedSignature !== match.signature) {
    return result('QUEST_CARD_CHANGED');
  }
  if (activationExpired()) return result('QUEST_SCRIPT_TIMEOUT');
  try {
    match.anchor.click();
  } catch {
    return result('QUEST_CARD_ACTIVATION_FAILED');
  }
  return { status: 'QUEST_CARD_ACTIVATED', signature: match.signature };
}

globalThis.probeQuestUi = probeQuestUi;
