const api = window.electronAPI;

const settingsModal = document.getElementById('settings-modal');
const settingsBody = document.getElementById('settingsBody');

// ---------- Themes ----------
// Ids are 'fe2', 'legacy' or 'custom:<id>', where custom themes layer CSS over a built-in base.
const BUILT_IN_THEMES = ['fe2', 'legacy'];
const BASE_NAMES = { fe2: 'Flood Escape', legacy: 'Legacy' };
const MAX_THEME_BYTES = 512 * 1024;
const root = document.documentElement;
const customCss = document.getElementById('css-custom');

let customThemes = [];
let currentTheme = root.dataset.themeId || root.dataset.theme || 'fe2';
let currentBase = root.dataset.theme || 'fe2';
let themeLoadToken = 0;

function findCustomTheme(id) {
  return (id && id.startsWith('custom:')) ? customThemes.find((t) => 'custom:' + t.id === id) : null;
}

function themeExists(id) {
  return BUILT_IN_THEMES.includes(id) || !!findCustomTheme(id);
}

function cacheTheme(id, base, css) {
  try {
    localStorage.setItem('fe2cm-theme', id);
    localStorage.setItem('fe2cm-theme-base', base);
    if (css) localStorage.setItem('fe2cm-theme-css', css);
    else localStorage.removeItem('fe2cm-theme-css');
  } catch (e) { }
}

function refitWindow() {
  hasAutoFitted = false;
  if (document.getElementById('dashboard').style.display === 'flex') autoFitWindow();
}

function applyTheme(id, { save = true } = {}) {
  if (!themeExists(id)) id = 'fe2';
  const custom = findCustomTheme(id);
  const base = custom ? custom.base : id;
  const changed = id !== currentTheme;
  const baseChanged = base !== currentBase;
  currentTheme = id;
  currentBase = base;
  root.dataset.theme = base;
  root.dataset.themeId = id;

  // Stops legacy's transitions from morphing out of the previous theme's styles.
  root.classList.add('theme-switching');
  setTimeout(() => root.classList.remove('theme-switching'), 50);
  document.getElementById('css-legacy').media = (base === 'legacy') ? 'all' : 'not all';
  document.getElementById('css-fe2').media = (base === 'fe2') ? 'all' : 'not all';

  const token = ++themeLoadToken;
  if (custom) {
    api.getThemeCss(custom.id).then((css) => {
      if (token !== themeLoadToken) return;
      customCss.textContent = css;
      cacheTheme(id, base, css);
      refitWindow();
    }).catch((err) => {
      console.log('Theme load failed', err);
      if (token === themeLoadToken) applyTheme('fe2');
    });
  } else {
    customCss.textContent = '';
    cacheTheme(id, base, '');
  }

  markActiveThemeCard();

  if (changed) {
    // Each base has its own tab layout.
    if (baseChanged) selectTab(activeTab === 'themes' ? 'themes' : null);
    refitWindow();
  }
  if (save && changed) triggerSave();
}

function markActiveThemeCard() {
  document.querySelectorAll('.theme-card').forEach((card) => {
    card.classList.toggle('active', card.dataset.themeId === currentTheme);
  });
}

document.querySelectorAll('.theme-card').forEach((card) => {
  card.onclick = () => applyTheme(card.dataset.themeId);
});

api.onSetTheme((id) => applyTheme(id, { save: false }));

// ---------- Custom themes ----------
const customThemeList = document.getElementById('customThemeList');

function renderCustomThemes() {
  customThemeList.textContent = '';
  for (const t of customThemes) {
    const id = 'custom:' + t.id;
    const row = document.createElement('div');
    row.className = 'custom-theme-row';

    const card = document.createElement('button');
    card.className = 'theme-card';
    card.dataset.themeId = id;
    card.innerHTML =
      '<span class="theme-swatch swatch-custom"><i></i><i></i><i></i></span>' +
      '<span class="theme-meta"><span class="theme-name"></span><span class="theme-desc"></span></span>' +
      '<span class="theme-check">&#10003;</span>';
    // User text, so never set as HTML.
    card.querySelector('.theme-name').textContent = t.name;
    card.querySelector('.theme-desc').textContent =
      (t.description ? t.description + ' · ' : '') + 'Based on ' + (BASE_NAMES[t.base] || t.base);
    card.onclick = () => applyTheme(id);

    const del = document.createElement('button');
    del.className = 'theme-delete-btn';
    del.title = 'Delete theme';
    del.textContent = '✕';
    let armTimer = null;
    del.onclick = () => {
      if (!del.classList.contains('armed')) {
        del.classList.add('armed');
        del.textContent = 'Delete?';
        armTimer = setTimeout(() => { del.classList.remove('armed'); del.textContent = '✕'; }, 3000);
        return;
      }
      clearTimeout(armTimer);
      api.deleteTheme(t.id).then(() => {
        customThemes = customThemes.filter((x) => x.id !== t.id);
        renderCustomThemes();
        if (currentTheme === id) applyTheme('fe2', { save: false });
      }).catch((err) => console.log('Delete failed', err));
    };

    row.append(card, del);
    customThemeList.append(row);
  }
  markActiveThemeCard();
  if (settingsModal.style.display === 'flex') fitSettings();
}

const importForm = document.getElementById('importForm');
const importBtn = document.getElementById('importThemeBtn');
const themeFile = document.getElementById('themeFile');
const themeFileName = document.getElementById('themeFileName');
const themeName = document.getElementById('themeName');
const themeDesc = document.getElementById('themeDesc');
const themeBase = document.getElementById('themeBase');
const importError = document.getElementById('importError');
const importConfirm = document.getElementById('importConfirm');
let pendingThemeCss = null;

function showImportError(msg) {
  importError.textContent = msg;
  importError.hidden = !msg;
  if (settingsModal.style.display === 'flex') fitSettings();
}

function setImportFormOpen(open) {
  importForm.hidden = !open;
  importBtn.hidden = open;
  if (!open) {
    pendingThemeCss = null;
    themeFile.value = '';
    themeFileName.textContent = 'No file selected';
    themeName.value = '';
    themeDesc.value = '';
    setThemeBase('fe2');
    showImportError('');
  }
  if (settingsModal.style.display === 'flex') fitSettings();
}

function setThemeBase(base) {
  themeBase.dataset.base = base;
  themeBase.textContent = BASE_NAMES[base];
}

importBtn.onclick = () => setImportFormOpen(true);
document.getElementById('importCancel').onclick = () => setImportFormOpen(false);
themeBase.onclick = () => setThemeBase(themeBase.dataset.base === 'fe2' ? 'legacy' : 'fe2');

themeFile.onchange = async () => {
  const file = themeFile.files[0];
  pendingThemeCss = null;
  showImportError('');
  if (!file) {
    themeFileName.textContent = 'No file selected';
    return;
  }
  themeFileName.textContent = file.name;
  if (file.size > MAX_THEME_BYTES) {
    showImportError('Theme files must be 512 KB or smaller.');
    return;
  }
  try {
    pendingThemeCss = await file.text();
  } catch (e) {
    showImportError("Couldn't read that file.");
    return;
  }
  if (!themeName.value.trim()) {
    themeName.value = file.name.replace(/\.[^.]+$/, '').slice(0, 40);
  }
};

importConfirm.onclick = () => {
  if (pendingThemeCss === null) return showImportError('Choose a theme file first.');
  if (!themeName.value.trim()) return showImportError('Give the theme a name.');
  importConfirm.disabled = true;
  api.importTheme(themeName.value, themeDesc.value, themeBase.dataset.base, pendingThemeCss)
    .then((theme) => {
      customThemes = [...customThemes.filter((x) => x.id !== theme.id), theme];
      renderCustomThemes();
      setImportFormOpen(false);
      applyTheme('custom:' + theme.id);
    })
    .catch((err) => showImportError(String(err)))
    .finally(() => { importConfirm.disabled = false; });
};

// ---------- Settings tabs ----------
let activeTab = null;

function tabsForTheme() {
  const hide = currentBase === 'legacy' ? 'only-fe2' : 'only-legacy';
  return [...document.querySelectorAll('.tab-btn')].filter((b) => !b.classList.contains(hide));
}

function selectTab(tab) {
  const tabs = tabsForTheme();
  const btn = tabs.find((b) => b.dataset.tab === tab) || tabs[0];
  if (!btn) return;
  activeTab = btn.dataset.tab;
  const show = btn.dataset.show.split(' ');
  document.querySelectorAll('.tab-btn').forEach((b) => b.classList.toggle('active', b === btn));
  document.querySelectorAll('.settings-section').forEach((sec) => {
    sec.hidden = !show.includes(sec.dataset.section);
  });
  settingsBody.scrollTop = 0;
  if (settingsModal.style.display === 'flex') fitSettings();
}

document.querySelectorAll('.tab-btn').forEach((btn) => {
  btn.onclick = () => selectTab(btn.dataset.tab);
});

// Legacy keeps its original scale-to-fit behaviour while FE2 scrolls.
function fitSettings() {
  settingsBody.style.transform = 'none';
  if (currentBase !== 'legacy') return;

  requestAnimationFrame(() => {
    const modalRect = settingsModal.getBoundingClientRect();
    const bodyTop = settingsBody.getBoundingClientRect().top;
    const padBottom = parseFloat(getComputedStyle(settingsModal).paddingBottom) || 0;
    const availableHeight = modalRect.bottom - padBottom - bodyTop;
    const contentHeight = settingsBody.scrollHeight;

    // Layout can be mid-swap right after a theme change.
    if (availableHeight > 50 && contentHeight > availableHeight) {
      const scale = availableHeight / contentHeight;
      settingsBody.style.transform = `scale(${scale})`;
    } else {
      settingsBody.style.transform = 'none';
    }
  });
}

const settingsIsOpen = () => settingsModal.style.display === 'flex';

function openSettings() {
  if (settingsIsOpen()) return;
  settingsModal.style.display = 'flex';
  selectTab(activeTab);
  fitSettings();
}

function closeSettings() {
  if (!settingsIsOpen()) return;
  settingsModal.style.display = 'none';
}

document.getElementById('openSettings').onclick = () => (settingsIsOpen() ? closeSettings() : openSettings());
document.getElementById('closeSettings').onclick = closeSettings;
document.getElementById('closeSettingsBig').onclick = closeSettings;
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !activeHotkeyInput) closeSettings();
});


function triggerSave() {
  const settings = {
    autoConnect: document.getElementById('set-autoConnect').checked,
    alwaysOnTop: document.getElementById('set-alwaysOnTop').checked,
    startMinimized: document.getElementById('set-startMinimized').checked,
    minimizeOnClose: document.getElementById('set-minimizeOnClose').checked,
    quickBar: document.getElementById('set-quickBar').checked,
    notifications: document.getElementById('set-notifications').checked,
    hotkeys: {
      mute: document.getElementById('key-mute').value,
      volUp: document.getElementById('key-volUp').value,
      volDown: document.getElementById('key-volDown').value
    },
    theme: currentTheme
  };
  api.saveAdvancedSettings(settings);
}

function updateVolumeFill() {
  const slider = document.getElementById('volume');
  const val = slider.value;
  const min = slider.min ? slider.min : 0;
  const max = slider.max ? slider.max : 100;
  const percentage = ((val - min) / (max - min)) * 100;
  slider.style.background = `linear-gradient(to right, var(--range-fill) ${percentage}%, var(--range-track) ${percentage}%)`;
}

document.getElementById('set-autoConnect').onchange = triggerSave;
document.getElementById('set-alwaysOnTop').onchange = triggerSave;
document.getElementById('set-startMinimized').onchange = triggerSave;
document.getElementById('set-minimizeOnClose').onchange = triggerSave;
document.getElementById('set-quickBar').onchange = triggerSave;
document.getElementById('set-notifications').onchange = triggerSave;

let customAudioPlayer = new Audio();
customAudioPlayer.loop = true;
let isCustomAudioEnabled = false;

document.getElementById('customAudioFile').onchange = (e) => {
  const file = e.target.files[0];
  const fileNameDisplay = document.getElementById('fileNameDisplay');
  if (file) {
    customAudioPlayer.src = URL.createObjectURL(file);
    fileNameDisplay.innerText = file.name;
  } else {
    fileNameDisplay.innerText = "No file selected";
  }
};

// FE2 is held at volume 0 while custom audio plays in its place.
let siteVolumeBeforeCustom = -1;

document.getElementById('set-customAudioEnabled').onchange = (e) => {
  isCustomAudioEnabled = e.target.checked;
  
  if (!isCustomAudioEnabled) {
    customAudioPlayer.pause();
    customAudioPlayer.currentTime = 0;
    lastBgmState = '';
    
    api.setCustomAudioActive(false);
    api.setSiteMute(false);
    api.setVolume(parseInt(volSlider.value));
  } else {
    api.setCustomAudioActive(true);
    api.setSiteMute(true);
  }
};

const QUIETEN_SCALE = 0.5;
let lastBgmState = '';

api.onGameAudioState((bgmInfo) => {
  if (isMuted) return;

  if (!isCustomAudioEnabled || !customAudioPlayer.src) return;

  api.setSiteVolume(0);

  const userVolume = parseInt(volSlider.value) / 100;
  const prevState = lastBgmState;
  lastBgmState = bgmInfo;

  if (bgmInfo.startsWith('Playing BGM')) {
    if (bgmInfo.includes('Quietened')) {
      if (customAudioPlayer.paused) {
        customAudioPlayer.play().catch(e => console.log("Play error", e));
      }
      customAudioPlayer.volume = userVolume * QUIETEN_SCALE;
    } else {
      // A new "Playing BGM" state means a new song, so restart from the beginning.
      if (prevState !== bgmInfo) {
        customAudioPlayer.currentTime = 0;
        customAudioPlayer.play().catch(e => console.log("Play error", e));
      } else if (customAudioPlayer.paused) {
        customAudioPlayer.play().catch(e => console.log("Play error", e));
      }
      customAudioPlayer.volume = userVolume;
    }
  } else if (bgmInfo.startsWith('Stopped BGM') || bgmInfo === 'Waiting for BGM') {
    if (!customAudioPlayer.paused) {
      customAudioPlayer.pause();
      customAudioPlayer.currentTime = 0;
    }
  }
});

api.onConnectionStatus((status) => {
  if (status === 'show-login') {
    showScreen('login-screen');
  } else if (status === 'connected') {
    showScreen('dashboard');
  }
});

api.onStartLoading(() => {
  document.getElementById('loadingText').innerText = "Connecting...";
  showScreen('loading-screen');
});

let activeHotkeyInput = null;

api.onHotkeyCaptured((accel) => {
  if (!activeHotkeyInput) return;

  if (accel === 'Backspace' || accel === 'Delete' || accel === 'Esc') {
    activeHotkeyInput.value = '';
  } else {
    activeHotkeyInput.value = accel;
  }
  triggerSave();
});

function setupHotkeyInput(id) {
  const input = document.getElementById(id);

  input.onkeydown = (e) => {
    e.preventDefault();
    e.stopPropagation();
  };

  input.onfocus = () => {
    activeHotkeyInput = input;
    api.startHotkeyCapture();
  };

  input.onblur = () => {
    if (activeHotkeyInput === input) {
      activeHotkeyInput = null;
      api.stopHotkeyCapture();
    }
  };
}

setupHotkeyInput('key-mute');
setupHotkeyInput('key-volUp');
setupHotkeyInput('key-volDown');

let hasAutoFitted = false;

function autoFitWindow() {
  if (hasAutoFitted) return;
  hasAutoFitted = true;

  requestAnimationFrame(() => {
    const dashboard = document.getElementById('dashboard');
    const content = document.getElementById('content');
    const container = document.getElementById('app-container');

    // The container is always window-height, so content is measured at its natural size.
    const els = [container, content, dashboard];
    const saved = els.map((el) => el.style.cssText);
    container.style.height = 'auto';
    content.style.flex = '0 0 auto';
    content.style.overflow = 'visible';
    dashboard.style.flex = '0 0 auto';

    // Rounding down after zoom can leave the content a sub-pixel too tall.
    const rect = container.getBoundingClientRect();
    const height = Math.ceil(rect.height);
    const width = Math.round(rect.width);

    els.forEach((el, i) => { el.style.cssText = saved[i]; });

    api.fitWindow(width, height);
  });
}

function showScreen(screenId) {
  ['loading-screen', 'login-screen', 'dashboard'].forEach(id => {
    document.getElementById(id).style.display = (id === screenId) ? 'flex' : 'none';
  });
  if (screenId === 'dashboard') {
    autoFitWindow();
  }
}

document.getElementById('winClose').onclick = () => api.close();
document.getElementById('winMin').onclick = () => api.minimize();

document.getElementById('connectBtn').onclick = () => {
  const user = document.getElementById('username').value;
  if (!user) return;

  document.getElementById('displayUser').innerText = user;

  showScreen('loading-screen');
  setTimeout(() => {
    api.connectUser(user);
  }, 200);
};

document.getElementById('refreshBtn').onclick = () => {
  api.refreshFE2();
  showScreen('loading-screen');
};

document.getElementById('disconnectBtn').onclick = () => {
  api.disconnectGame();
  showScreen('login-screen');
};

const volSlider = document.getElementById('volume');
const volDisplay = document.getElementById('volDisplay');
const muteBtn = document.getElementById('muteBtn');
const volGroup = volSlider.closest('.control-group');
let isMuted = false;
let volumeBeforeMute = 70;

function toggleMute() {
  if (isMuted) {
    isMuted = false;
    muteBtn.innerHTML = '&#128266;';
    volGroup.classList.remove('volume-muted');
    api.setVolume(volumeBeforeMute);
    customAudioPlayer.volume = volumeBeforeMute / 100;
    if (isCustomAudioEnabled) {
      api.setSiteVolume(0);
    }
    api.setSiteMute(false);
  } else {
    volumeBeforeMute = parseInt(volSlider.value) || 70;
    isMuted = true;
    muteBtn.innerHTML = '&#128263;';
    volGroup.classList.add('volume-muted');
    api.setVolume(0);
    api.setSiteMute(true);
    customAudioPlayer.volume = 0;
  }
}

muteBtn.onclick = toggleMute;
api.onToggleMute(() => {
  toggleMute();
  api.showNotification(isMuted ? 'Muted' : `Volume ${volSlider.value}%`);
});

volSlider.oninput = () => {
  if (isMuted) {
    isMuted = false;
    muteBtn.innerHTML = '&#128266;';
    volGroup.classList.remove('volume-muted');
    api.setSiteMute(false);
  }
  const val = volSlider.value;
  volDisplay.innerText = val + '%';
  api.setVolume(val);
  customAudioPlayer.volume = val / 100;
  if (isCustomAudioEnabled) {
    api.setSiteVolume(0);
  }
  updateVolumeFill();
};

document.querySelectorAll('input[type="radio"]').forEach(radio => {
  radio.onchange = (e) => {
    api.clickOption(e.target.name, e.target.value);
    syncCycleButtons();
  };
});

function syncCycleButtons() {
  document.querySelectorAll('.cycle-btn').forEach((btn) => {
    const checked = document.querySelector(`input[name="${btn.dataset.group}"]:checked`);
    const value = checked ? checked.value : '';
    btn.textContent = value || '—';
    btn.classList.toggle('is-off', value === 'Disable');
  });
}

document.querySelectorAll('.cycle-btn').forEach((btn) => {
  btn.onclick = () => {
    const radios = [...document.querySelectorAll(`input[name="${btn.dataset.group}"]`)];
    const next = radios[(radios.findIndex((r) => r.checked) + 1) % radios.length];
    next.checked = true;
    next.dispatchEvent(new Event('change'));
  };
});

api.onRestoreState((data) => {
  if (data.username) {
    document.getElementById('username').value = data.username;
    document.getElementById('displayUser').innerText = data.username;
  }
  if (data.volume !== undefined && data.volume !== null) {
    volSlider.value = data.volume;
    document.getElementById('volDisplay').innerText = data.volume + '%';
    customAudioPlayer.volume = data.volume / 100;
    updateVolumeFill();
  }
  if (data.onDeath) {
    const el = document.querySelector(`input[name="onDeath"][value="${data.onDeath}"]`);
    if (el) el.checked = true;
  }
  if (data.onLeave) {
    const el = document.querySelector(`input[name="onLeave"][value="${data.onLeave}"]`);
    if (el) el.checked = true;
  }
  syncCycleButtons();

  if (data.settings) {
    document.getElementById('set-autoConnect').checked = data.settings.autoConnect;
    document.getElementById('set-alwaysOnTop').checked = data.settings.alwaysOnTop;
    document.getElementById('set-startMinimized').checked = data.settings.startMinimized;
    document.getElementById('set-minimizeOnClose').checked = data.settings.minimizeOnClose;
    document.getElementById('set-quickBar').checked = data.settings.quickBar !== false;
    document.getElementById('set-notifications').checked = data.settings.notifications !== false;

    if (data.settings.hotkeys) {
      document.getElementById('key-mute').value = data.settings.hotkeys.mute || '';
      document.getElementById('key-volUp').value = data.settings.hotkeys.volUp || '';
      document.getElementById('key-volDown').value = data.settings.hotkeys.volDown || '';
    }

    customThemes = Array.isArray(data.customThemes) ? [...data.customThemes] : [];
    renderCustomThemes();
    applyTheme(data.settings.theme || 'fe2', { save: false });
  }
});

api.onUpdateVolume((val) => {
  if (isMuted && val > 0) {
    isMuted = false;
    muteBtn.innerHTML = '&#128266;';
    volGroup.classList.remove('volume-muted');
    api.setSiteMute(false);
  }
  volSlider.value = val;
  volDisplay.innerText = val + '%';
  customAudioPlayer.volume = val / 100;
  if (isCustomAudioEnabled) {
    api.setSiteVolume(0);
  }
  updateVolumeFill();
});

updateVolumeFill();
markActiveThemeCard();
selectTab(null);
