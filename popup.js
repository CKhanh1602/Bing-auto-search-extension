document.addEventListener('DOMContentLoaded', () => {
  const elements = {
    // Inputs & Config
    desktopSearches: document.getElementById('desktopSearches'),
    minDelay: document.getElementById('minDelay'),
    maxDelay: document.getElementById('maxDelay'),
    
    // Feature & Control Buttons
    btnQuest: document.getElementById('btnQuest'),
    btnDesktop: document.getElementById('btnDesktop'),
    btnAll: document.getElementById('btnAll'),
    btnPause: document.getElementById('btnPause'),
    pauseText: document.getElementById('pauseText'),
    btnStop: document.getElementById('btnStop'),
    lblStopText: document.getElementById('lblStopText'),
    
    // Status & Progress
    statusDot: document.getElementById('statusDot'),
    statusBadge: document.getElementById('statusBadge'),
    progressBar: document.getElementById('progressBar'),
    progressText: document.getElementById('progressText'),
    statusText: document.getElementById('statusText'),

    // Settings & Modal
    btnSettings: document.getElementById('btnSettings'),
    settingsPanel: document.getElementById('settingsPanel'),
    btnCloseSettings: document.getElementById('btnCloseSettings'),
    selLanguage: document.getElementById('selLanguage'),
    selTheme: document.getElementById('selTheme'),
    tooltipBar: document.getElementById('tooltipBar'),

    // Labels for i18n
    lblSettingsTitle: document.getElementById('lblSettingsTitle'),
    lblLanguage: document.getElementById('lblLanguage'),
    lblTheme: document.getElementById('lblTheme'),
    lblSearchSettings: document.getElementById('lblSearchSettings'),
    lblDesktopCount: document.getElementById('lblDesktopCount'),
    lblMinDelay: document.getElementById('lblMinDelay'),
    lblMaxDelay: document.getElementById('lblMaxDelay'),
    lblStarInfo: document.getElementById('lblStarInfo')
  };

  // Comprehensive i18n Dictionary
  const i18n = {
    en: {
      settingsTitle: 'Settings',
      languageLabel: 'Language',
      themeLabel: 'Theme',
      searchSettingsTitle: 'Search Settings',
      desktopLabel: 'Searches',
      minDelayLabel: 'Min Delay (s)',
      maxDelayLabel: 'Max Delay (s)',
      starInfo: 'STAR Bonus optimized: varied queries, natural timing',
      defaultTooltip: 'Hover over any button for description',
      pauseText: 'Pause',
      resumeText: 'Resume',
      stopText: 'Stop',
      phases: {
        'idle': 'READY',
        'scanning': 'SCANNING',
        'quests': 'QUEST',
        'search_desktop': 'SEARCHING',
        'complete': 'COMPLETED',
        'stopped': 'STOPPED',
        'paused': 'PAUSED'
      },
      defaultStatusText: 'Ready for action...',
      statusMap: {
        'Ready': 'Ready for action...',
        'Starting...': 'Starting automation...',
        'Processing Quests...': 'Processing Daily Quests & Activities...',
        'Desktop Search...': 'Performing Search (STAR optimized)...',
        'Stopping...': 'Stopping automation...',
        'Stopped': 'Automation stopped.',
        'Completed!': 'All tasks completed successfully!',
        'Paused': 'Automation paused.',
        'Resuming...': 'Resuming automation...'
      }
    },
    vi: {
      settingsTitle: 'Cài đặt',
      languageLabel: 'Ngôn ngữ',
      themeLabel: 'Giao diện',
      searchSettingsTitle: 'Cấu hình tìm kiếm',
      desktopLabel: 'Số lượt search',
      minDelayLabel: 'Min Delay (giây)',
      maxDelayLabel: 'Max Delay (giây)',
      starInfo: 'Tối ưu STAR Bonus: từ khóa đa dạng, thời gian tự nhiên',
      defaultTooltip: 'Rê chuột vào nút bất kỳ để xem mô tả',
      pauseText: 'Tạm dừng',
      resumeText: 'Tiếp tục',
      stopText: 'Dừng hẳn',
      phases: {
        'idle': 'SẴN SÀNG',
        'scanning': 'ĐANG SCAN',
        'quests': 'QUEST',
        'search_desktop': 'ĐANG SEARCH',
        'complete': 'HOÀN THÀNH',
        'stopped': 'ĐÃ DỪNG',
        'paused': 'TẠM DỪNG'
      },
      defaultStatusText: 'Sẵn sàng hoạt động...',
      statusMap: {
        'Ready': 'Sẵn sàng hoạt động...',
        'Starting...': 'Đang bắt đầu...',
        'Processing Quests...': 'Đang tự động làm Quest & Activities...',
        'Desktop Search...': 'Đang tìm kiếm (tối ưu STAR)...',
        'Stopping...': 'Đang dừng tiến trình...',
        'Stopped': 'Đã dừng tiến trình.',
        'Completed!': 'Hoàn thành tất cả nhiệm vụ!',
        'Paused': 'Đã tạm dừng.',
        'Resuming...': 'Đang tiếp tục...'
      }
    }
  };

  let currentLang = 'en';
  let currentState = null;

  // Apply Theme
  const applyTheme = (theme) => {
    if (theme === 'light') {
      document.body.classList.add('light-theme');
    } else {
      document.body.classList.remove('light-theme');
    }
  };

  // Apply Language Strings
  const applyLanguage = (lang) => {
    currentLang = lang;
    const t = i18n[lang];

    elements.lblSettingsTitle.textContent = t.settingsTitle;
    elements.lblLanguage.textContent = t.languageLabel;
    elements.lblTheme.textContent = t.themeLabel;
    elements.lblSearchSettings.textContent = t.searchSettingsTitle;
    elements.lblDesktopCount.textContent = t.desktopLabel;
    elements.lblMinDelay.textContent = t.minDelayLabel;
    elements.lblMaxDelay.textContent = t.maxDelayLabel;
    elements.tooltipBar.textContent = t.defaultTooltip;
    elements.lblStopText.textContent = t.stopText;
    if (elements.lblStarInfo) {
      elements.lblStarInfo.textContent = t.starInfo;
    }

    if (currentState) {
      updateUI(currentState);
    }
  };

  // Load saved config & settings
  chrome.storage.local.get(['desktopSearches', 'minDelay', 'maxDelay', 'lang', 'theme'], (result) => {
    elements.desktopSearches.value = result.desktopSearches || 30;
    elements.minDelay.value = result.minDelay || 10;
    elements.maxDelay.value = result.maxDelay || 15;

    const lang = result.lang || 'en';
    const theme = result.theme || 'dark';

    elements.selLanguage.value = lang;
    elements.selTheme.value = theme;

    applyTheme(theme);
    applyLanguage(lang);
  });

  // Save config on change
  const saveConfig = () => {
    chrome.storage.local.set({
      desktopSearches: parseInt(elements.desktopSearches.value, 10) || 30,
      minDelay: parseInt(elements.minDelay.value, 10) || 10,
      maxDelay: parseInt(elements.maxDelay.value, 10) || 15
    });
  };

  [elements.desktopSearches, elements.minDelay, elements.maxDelay].forEach(el => {
    el.addEventListener('change', saveConfig);
  });

  // Settings Panel Handlers
  elements.btnSettings.addEventListener('click', () => {
    elements.settingsPanel.classList.toggle('hidden');
  });

  elements.btnCloseSettings.addEventListener('click', () => {
    elements.settingsPanel.classList.add('hidden');
  });

  elements.selLanguage.addEventListener('change', (e) => {
    const lang = e.target.value;
    chrome.storage.local.set({ lang });
    applyLanguage(lang);
  });

  elements.selTheme.addEventListener('change', (e) => {
    const theme = e.target.value;
    chrome.storage.local.set({ theme });
    applyTheme(theme);
  });

  // Hover Tooltips for Buttons
  const buttonsWithTooltip = [
    elements.btnQuest, elements.btnDesktop,
    elements.btnAll, elements.btnPause, elements.btnStop
  ];

  buttonsWithTooltip.forEach(btn => {
    if (!btn) return;
    btn.addEventListener('mouseenter', () => {
      const descAttr = currentLang === 'vi' ? 'data-desc-vi' : 'data-desc-en';
      const desc = btn.getAttribute(descAttr);
      if (desc) {
        elements.tooltipBar.textContent = desc;
        elements.tooltipBar.style.color = 'var(--text-main)';
      }
    });

    btn.addEventListener('mouseleave', () => {
      elements.tooltipBar.textContent = i18n[currentLang].defaultTooltip;
      elements.tooltipBar.style.color = 'var(--tooltip-text)';
    });
  });

  const getConfig = () => ({
    desktopSearches: parseInt(elements.desktopSearches.value, 10) || 30,
    minDelay: parseInt(elements.minDelay.value, 10) || 10,
    maxDelay: parseInt(elements.maxDelay.value, 10) || 15
  });

  // Feature Buttons
  elements.btnQuest.addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: 'START_QUEST' });
  });

  elements.btnDesktop.addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: 'START_DESKTOP', config: getConfig() });
  });

  elements.btnAll.addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: 'START_ALL', config: getConfig() });
  });

  // Control Buttons
  elements.btnPause.addEventListener('click', () => {
    const isCurrentlyPaused = currentState && currentState.isPaused;
    if (isCurrentlyPaused) {
      chrome.runtime.sendMessage({ action: 'RESUME' });
    } else {
      chrome.runtime.sendMessage({ action: 'PAUSE' });
    }
  });

  elements.btnStop.addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: 'STOP' });
  });

  // UI Update Function
  const updateUI = (state) => {
    if (!state) return;
    currentState = state;

    const t = i18n[currentLang];

    // Update Status Badge
    const phaseKey = state.isPaused ? 'paused' : state.phase;
    const badgeText = (t.phases && t.phases[phaseKey]) || t.phases['idle'];
    
    const phaseClassMap = {
      'idle': 'badge-idle',
      'scanning': 'badge-scanning',
      'quests': 'badge-quests',
      'search_desktop': 'badge-search-desktop',
      'complete': 'badge-complete',
      'stopped': 'badge-stopped',
      'paused': 'badge-paused'
    };

    const dotClassMap = {
      'idle': 'dot-idle',
      'scanning': 'dot-active',
      'quests': 'dot-quests',
      'search_desktop': 'dot-active',
      'complete': 'dot-complete',
      'stopped': 'dot-stopped',
      'paused': 'dot-paused'
    };

    elements.statusBadge.textContent = badgeText;
    elements.statusBadge.className = `badge ${phaseClassMap[phaseKey] || 'badge-idle'}`;
    elements.statusDot.className = `status-dot ${dotClassMap[phaseKey] || 'dot-idle'}`;

    // Update Progress
    const total = state.total || 0;
    const current = state.current || 0;
    const percentage = total > 0 ? (current / total) * 100 : 0;
    
    elements.progressBar.style.width = `${percentage}%`;
    elements.progressText.textContent = `${current} / ${total}`;
    
    // Status text localization
    if (state.statusText) {
      let rawText = state.statusText;
      let localized = t.statusMap && t.statusMap[rawText] ? t.statusMap[rawText] : rawText;
      
      // Dynamic quest title translation fallback
      if (rawText.startsWith('Quest: ')) {
        localized = currentLang === 'vi' ? rawText.replace('Quest: ', 'Nhiệm vụ: ') : rawText;
      }
      
      elements.statusText.textContent = localized;
    } else {
      elements.statusText.textContent = t.defaultStatusText;
    }

    // Toggle Inputs and Feature Buttons
    const isRunning = state.isRunning;
    
    [elements.desktopSearches, elements.minDelay, elements.maxDelay].forEach(el => {
      el.disabled = isRunning;
    });

    elements.btnQuest.disabled = isRunning;
    elements.btnDesktop.disabled = isRunning;
    elements.btnAll.disabled = isRunning;
    
    // Control Buttons
    elements.btnPause.disabled = !isRunning;
    elements.btnStop.disabled = !isRunning;

    // Pause/Resume Text Toggle
    if (state.isPaused) {
      elements.pauseText.textContent = t.resumeText;
    } else {
      elements.pauseText.textContent = t.pauseText;
    }
  };

  // Listen for status updates
  if (chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((message) => {
      if (message.action === 'STATUS_UPDATE' && message.state) {
        updateUI(message.state);
      }
    });
  }

  // Request initial status
  try {
    if (chrome.runtime && chrome.runtime.sendMessage) {
      chrome.runtime.sendMessage({ action: 'GET_STATUS' }, (response) => {
        if (response && response.phase !== undefined) {
          updateUI(response);
        }
      });
    }
  } catch (e) {}
});
