document.addEventListener('DOMContentLoaded', () => {
  const questTimeoutInput = document.getElementById('questTimeoutSeconds');
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
    progressTrack: document.getElementById('progressTrack'),
    progressText: document.getElementById('progressText'),
    statusText: document.getElementById('statusText'),
    statusTextRow: document.getElementById('statusTextRow'),
    manualQuestNotice: document.getElementById('manualQuestNotice'),

    // Settings & Modal
    btnSettings: document.getElementById('btnSettings'),
    settingsPanel: document.getElementById('settingsPanel'),
    btnCloseSettings: document.getElementById('btnCloseSettings'),
    selLanguage: document.getElementById('selLanguage'),
    selTheme: document.getElementById('selTheme'),

    // Labels for i18n
    lblSettingsTitle: document.getElementById('lblSettingsTitle'),
    lblLanguage: document.getElementById('lblLanguage'),
    lblTheme: document.getElementById('lblTheme'),
    lblSearchSettings: document.getElementById('lblSearchSettings'),
    lblDesktopCount: document.getElementById('lblDesktopCount'),
    lblMinDelay: document.getElementById('lblMinDelay'),
    lblMaxDelay: document.getElementById('lblMaxDelay'),
    lblDailyTool: document.getElementById('lblDailyTool'),
    lblQuestText: document.getElementById('lblQuestText'),
    lblSearchText: document.getElementById('lblSearchText'),
    lblAllText: document.getElementById('lblAllText'),
    lblCredit: document.getElementById('lblCredit')
  };

  // Comprehensive i18n Dictionary
  const i18n = {
    en: {
      settingsTitle: 'Settings',
      languageLabel: 'Language',
      themeLabel: 'Theme',
      searchSettingsTitle: 'Search Settings',
      desktopLabel: 'Searches',
      minDelayLabel: 'Min delay (s)',
      maxDelayLabel: 'Max delay (s)',
      dailyTool: 'YOUR DAILY TOOL',
      questText: 'Quests', searchText: 'Search', allText: 'Run all', credit: 'Made by',
      skippedNotice: count => `${count} ${count === 1 ? 'activity' : 'activities'} skipped without confirmed credit. Check Rewards for details.`,
      pauseText: 'Pause',
      resumeText: 'Resume',
      stopText: 'Stop',
      phases: {
        'idle': 'READY',
        'scanning': 'SCANNING',
        'quests': 'QUEST',
        'search_desktop': 'SEARCHING',
        'needs_action': 'ACTION NEEDED',
        'complete': 'FINISHED',
        'stopped': 'STOPPED',
        'paused': 'PAUSED'
      },
      defaultStatusText: 'Ready when you are.',
      statusMap: {
        'Run finished; some Quest activities were skipped, not credited.': 'Run finished; some activities were skipped without confirmed credit.',
        'Ready': 'Ready when you are.',
        'Starting...': 'Starting automation...',
        'Processing Quests...': 'Processing Rewards cards...',
        'Reading Rewards activities...': 'Reading Daily Set and Keep earning activities...',
        'Reading daily Rewards activities...': 'Reading daily Rewards activities...',
        'Desktop Search...': 'Running Bing searches...',
        'Stopping...': 'Stopping automation...',
        'Stopped': 'Automation stopped.',
        'Completed!': 'Run finished.',
        'Paused': 'Automation paused.',
        'Resuming...': 'Resuming automation...',
        'Some Quest activities still need action; their tabs were kept open.': 'Some Quest activities still need action; their tabs were kept open.',
        'Quest activities confirmed by Rewards.': 'Quest activities confirmed by Rewards.'
      }
    },
    vi: {
      settingsTitle: 'Cài đặt',
      languageLabel: 'Ngôn ngữ',
      themeLabel: 'Giao diện',
      searchSettingsTitle: 'Cấu hình tìm kiếm',
      desktopLabel: 'Số lượt tìm',
      minDelayLabel: 'Chờ tối thiểu (s)',
      maxDelayLabel: 'Chờ tối đa (s)',
      dailyTool: 'CÔNG CỤ HẰNG NGÀY',
      questText: 'Nhiệm vụ', searchText: 'Tìm kiếm', allText: 'Chạy tất cả', credit: 'Tác giả',
      skippedNotice: count => `Đã bỏ qua ${count} hoạt động; chưa xác nhận điểm. Xem chi tiết trên Rewards.`,
      pauseText: 'Tạm dừng',
      resumeText: 'Tiếp tục',
      stopText: 'Dừng hẳn',
      phases: {
        'idle': 'SẴN SÀNG',
        'scanning': 'ĐANG SCAN',
        'quests': 'QUEST',
        'search_desktop': 'ĐANG SEARCH',
        'needs_action': 'CẦN THAO TÁC',
        'complete': 'ĐÃ CHẠY XONG',
        'stopped': 'ĐÃ DỪNG',
        'paused': 'TẠM DỪNG'
      },
      defaultStatusText: 'Sẵn sàng hoạt động...',
      statusMap: {
        'Run finished; some Quest activities were skipped, not credited.': 'Đã chạy xong; có hoạt động được bỏ qua, chưa xác nhận điểm.',
        'Ready': 'Sẵn sàng hoạt động...',
        'Starting...': 'Đang bắt đầu...',
        'Processing Quests...': 'Đang tự động làm Quest & Activities...',
        'Reading daily Rewards activities...': 'Đang đọc nhiệm vụ hằng ngày...',
        'Reading Rewards activities...': 'Đang đọc Daily set và Keep earning...',
        'Desktop Search...': 'Đang tìm kiếm Bing...',
        'Stopping...': 'Đang dừng tiến trình...',
        'Stopped': 'Đã dừng tiến trình.',
        'Completed!': 'Đã hoàn tất lượt chạy.',
        'Paused': 'Đã tạm dừng.',
        'Resuming...': 'Đang tiếp tục...',
        'Some Quest activities still need action; their tabs were kept open.': 'Một số nhiệm vụ vẫn cần thao tác; các tab tương ứng được giữ mở.',
        'Quest activities confirmed by Rewards.': 'Rewards đã xác nhận các nhiệm vụ hoàn thành.',
        'No eligible Quest offers found; check Rewards for credit.': 'Không tìm thấy nhiệm vụ hợp lệ; hãy kiểm tra điểm trên Rewards.'
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
    currentLang = i18n[lang] ? lang : 'en';
    const t = i18n[currentLang];
    document.documentElement.lang = currentLang;

    elements.lblSettingsTitle.textContent = t.settingsTitle;
    elements.lblLanguage.textContent = t.languageLabel;
    elements.lblTheme.textContent = t.themeLabel;
    elements.lblSearchSettings.textContent = t.searchSettingsTitle;
    elements.lblDesktopCount.textContent = t.desktopLabel;
    elements.lblMinDelay.textContent = t.minDelayLabel;
    elements.lblMaxDelay.textContent = t.maxDelayLabel;
    document.getElementById('lblQuestTimeout').textContent = currentLang === 'vi'
      ? 'Chờ nội dung Quest tối đa (10–300 giây)' : 'Quest wait limit (10–300 seconds)';
    elements.lblDailyTool.textContent = t.dailyTool;
    elements.lblQuestText.textContent = t.questText;
    elements.lblSearchText.textContent = t.searchText;
    elements.lblAllText.textContent = t.allText;
    elements.lblCredit.textContent = t.credit;
    elements.btnSettings.setAttribute('aria-label', t.settingsTitle);
    elements.btnSettings.title = t.settingsTitle;
    elements.btnCloseSettings.setAttribute('aria-label', currentLang === 'vi' ? 'Đóng cài đặt' : 'Close settings');
    elements.progressTrack.setAttribute('aria-label', currentLang === 'vi' ? 'Tiến trình tự động' : 'Automation progress');
    // Descriptions remain available without reserving a full popup row.
    for (const btn of [elements.btnQuest, elements.btnDesktop, elements.btnAll, elements.btnPause, elements.btnStop]) {
      const description = btn.getAttribute(currentLang === 'vi' ? 'data-desc-vi' : 'data-desc-en');
      if (description) {
        btn.title = description;
        btn.setAttribute('aria-description', description);
      }
    }
    elements.lblStopText.textContent = t.stopText;

    if (currentState) {
      updateUI(currentState);
    }
  };

  // Load saved config & settings
  chrome.storage.local.get(['desktopSearches', 'minDelay', 'maxDelay', 'questTimeoutSeconds', 'lang', 'theme'], (result) => {
    questTimeoutInput.value = result.questTimeoutSeconds || 10;
    elements.desktopSearches.value = result.desktopSearches || 30;
    elements.minDelay.value = result.minDelay || 10;
    elements.maxDelay.value = result.maxDelay || 15;

    const lang = i18n[result.lang] ? result.lang : 'en';
    const theme = result.theme === 'dark' ? 'dark' : 'light';

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
  questTimeoutInput.addEventListener('change', () => {
    const value = Number(questTimeoutInput.value);
    if (Number.isInteger(value) && value >= 10 && value <= 300) chrome.storage.local.set({ questTimeoutSeconds: value });
  });

  [elements.desktopSearches, elements.minDelay, elements.maxDelay].forEach(el => {
    el.addEventListener('change', saveConfig);
  });

  // Settings Panel Handlers
  elements.btnSettings.addEventListener('click', () => {
    elements.settingsPanel.classList.toggle('hidden');
    elements.btnSettings.setAttribute('aria-expanded', String(!elements.settingsPanel.classList.contains('hidden')));
  });

  elements.btnCloseSettings.addEventListener('click', () => {
    elements.settingsPanel.classList.add('hidden');
    elements.btnSettings.setAttribute('aria-expanded', 'false');
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

  const getConfig = () => ({
    questTimeoutSeconds: Number(questTimeoutInput.value),
    desktopSearches: parseInt(elements.desktopSearches.value, 10) || 30,
    minDelay: parseInt(elements.minDelay.value, 10) || 10,
    maxDelay: parseInt(elements.maxDelay.value, 10) || 15
  });

  // Acknowledge controls and expose a disconnected/restarted worker in the UI.
  const sendCommand = async (message) => {
    try {
      const response = await chrome.runtime.sendMessage(message);
      if (response?.state) updateUI(response.state);
      if (response?.ok === false) {
        elements.statusTextRow.classList.remove('hidden');
        elements.statusText.textContent = response.error;
      }
    } catch {
      elements.statusTextRow.classList.remove('hidden');
      elements.statusText.textContent = currentLang === 'vi'
        ? 'Không kết nối được extension. Đóng và mở lại popup.'
        : 'Extension unavailable. Close and reopen the popup.';
    }
  };

  // Feature Buttons
  elements.btnQuest.addEventListener('click', () => {
    sendCommand({ action: 'START_QUEST', config: getConfig() });
  });

  elements.btnDesktop.addEventListener('click', () => {
    sendCommand({ action: 'START_DESKTOP', config: getConfig() });
  });

  elements.btnAll.addEventListener('click', () => {
    sendCommand({ action: 'START_ALL', config: getConfig() });
  });

  // Control Buttons
  elements.btnPause.addEventListener('click', () => {
    const isCurrentlyPaused = currentState && currentState.isPaused;
    if (isCurrentlyPaused) {
      sendCommand({ action: 'RESUME' });
    } else {
      sendCommand({ action: 'PAUSE' });
    }
  });

  elements.btnStop.addEventListener('click', () => {
    return sendCommand({ action: 'STOP' });
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
      'needs_action': 'badge-needs-action',
      'complete': 'badge-complete',
      'stopped': 'badge-stopped',
      'paused': 'badge-paused'
    };

    const dotClassMap = {
      'idle': 'dot-idle',
      'scanning': 'dot-active',
      'quests': 'dot-quests',
      'search_desktop': 'dot-active',
      'needs_action': 'dot-needs-action',
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
    const percentage = total > 0 ? Math.min(100, Math.max(0, (current / total) * 100)) : 0;
    
    elements.progressBar.style.width = `${percentage}%`;
    elements.progressTrack.setAttribute('aria-valuenow', String(Math.round(percentage)));
    elements.progressText.textContent = `${current} / ${total}`;
    const skippedCount = Number.isInteger(state.skippedQuestCount) && state.skippedQuestCount > 0 ? state.skippedQuestCount : 0;
    elements.manualQuestNotice.classList.toggle('hidden', skippedCount === 0);
    elements.manualQuestNotice.textContent = skippedCount ? t.skippedNotice(skippedCount) : '';
    // The finished-run summary repeats the skipped notice. Keep one message
    // so native popup controls fit; active/stopped states and errors stay visible.
    elements.statusTextRow.classList.toggle('hidden', state.phase === 'complete' && !state.isRunning && skippedCount > 0);
    
    // Status text localization
    if (state.statusText) {
      let rawText = state.statusText;
      let localized = t.statusMap && t.statusMap[rawText] ? t.statusMap[rawText] : rawText;
      
      // Dynamic quest title translation fallback
      if (rawText.startsWith('Quest: ')) {
        localized = currentLang === 'vi' ? rawText.replace('Quest: ', 'Nhiệm vụ: ') : rawText;
      }
      if (currentLang === 'vi') {
        const patterns = [
          [/^(\d+) (?:daily )?activities$/, match => `${match[1]} nhiệm vụ`],
          [/^Waiting for (?:daily|Quest) card (\d+)\/(\d+)$/, match => `Chờ thẻ nhiệm vụ ${match[1]}/${match[2]}`],
          [/^Verifying (?:daily|Quest) activity (\d+)\/(\d+)$/, match => `Xác minh nhiệm vụ ${match[1]}/${match[2]}`],
          [/^(\d+)\/(\d+) (?:daily )?activities confirmed$/, match => `Rewards đã xác nhận ${match[1]}/${match[2]} nhiệm vụ`],
          [/^(\d+)\/(\d+) confirmed; (\d+) need action$/, match => `Đã xác nhận ${match[1]}/${match[2]}; còn ${match[3]} cần bạn thực hiện`],
          [/^(\d+) quests need your action; tabs opened\.$/, match => `Còn ${match[1]} quest cần bạn thực hiện; đã mở các tab.`]
        ];
        for (const [pattern, format] of patterns) {
          const match = rawText.match(pattern);
          if (match) { localized = format(match); break; }
        }
      }
      
      elements.statusText.textContent = localized;
    } else {
      elements.statusText.textContent = t.defaultStatusText;
    }

    // Toggle Inputs and Feature Buttons
    const isRunning = state.isRunning;
    questTimeoutInput.disabled = isRunning;
    
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
        if (chrome.runtime.lastError) {
          elements.statusTextRow.classList.remove('hidden');
          elements.statusText.textContent = 'Extension unavailable. Close and reopen the popup.';
          return;
        }
        if (response && response.phase !== undefined) {
          updateUI(response);
        }
      });
    }
  } catch (e) {}
});
