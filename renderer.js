const api = window.electronAPI;

const settingsModal = document.getElementById('settings-modal');
const settingsBody = document.getElementById('settingsBody');

function openSettings() {
  settingsModal.style.display = 'flex';
  settingsBody.style.transform = 'none';

  requestAnimationFrame(() => {
    const header = document.querySelector('.settings-header');
    const availableHeight = settingsModal.clientHeight - header.offsetHeight;
    const contentHeight = settingsBody.scrollHeight;

    if (contentHeight > availableHeight) {
      const scale = availableHeight / contentHeight;
      settingsBody.style.transform = `scale(${scale})`;
    } else {
      settingsBody.style.transform = 'none';
    }
  });
}

document.getElementById('openSettings').onclick = openSettings;
document.getElementById('closeSettings').onclick = () => settingsModal.style.display = 'none';

function triggerSave() {
  const settings = {
    autoConnect: document.getElementById('set-autoConnect').checked,
    alwaysOnTop: document.getElementById('set-alwaysOnTop').checked,
    startMinimized: document.getElementById('set-startMinimized').checked,
    minimizeOnClose: document.getElementById('set-minimizeOnClose').checked,
    hotkeys: {
      mute: document.getElementById('key-mute').value,
      volUp: document.getElementById('key-volUp').value,
      volDown: document.getElementById('key-volDown').value
    }
  };
  api.saveAdvancedSettings(settings);
}

function updateVolumeFill() {
  const slider = document.getElementById('volume');
  const val = slider.value;
  const min = slider.min ? slider.min : 0;
  const max = slider.max ? slider.max : 100;
  const percentage = ((val - min) / (max - min)) * 100;
  slider.style.background = `linear-gradient(to right, #3182ce ${percentage}%, #4a5568 ${percentage}%)`;
}

document.getElementById('set-autoConnect').onchange = triggerSave;
document.getElementById('set-alwaysOnTop').onchange = triggerSave;
document.getElementById('set-startMinimized').onchange = triggerSave;
document.getElementById('set-minimizeOnClose').onchange = triggerSave;

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

document.getElementById('set-customAudioEnabled').onchange = (e) => {
  isCustomAudioEnabled = e.target.checked;
  if (!isCustomAudioEnabled) {
    customAudioPlayer.pause();
    api.setSiteMute(false);
  } else {
    if (customAudioPlayer.src && !customAudioPlayer.paused) {
      api.setSiteMute(true);
    }
  }
};

api.onGameAudioState((state) => {
  // If manually muted, keep site muted and don't play custom audio
  if (isMuted) {
    api.setSiteMute(true);
    return;
  }

  if (!isCustomAudioEnabled || !customAudioPlayer.src) {
    api.setSiteMute(false);
    return;
  }

  if (state === 'playing') {
    api.setSiteMute(true);
    if (customAudioPlayer.paused) {
      customAudioPlayer.play().catch(e => console.log("Play error", e));
    }
  } else {
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

// Active hotkey input element (only one can capture at a time)
let activeHotkeyInput = null;

// Listen for key combos captured by uiohook in the main process
api.onHotkeyCaptured((accel) => {
  if (!activeHotkeyInput) return;

  // Clear keybind on bare Backspace/Delete/Escape
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
    const container = document.getElementById('app-container');

    // Temporarily disable flex-grow to measure natural content size
    dashboard.style.flex = '0 0 auto';
    void container.offsetHeight; // force reflow

    const height = container.scrollHeight;
    const width = container.offsetWidth;

    // Restore flex behavior
    dashboard.style.flex = '';

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
    // Unmute
    isMuted = false;
    muteBtn.innerHTML = '&#128266;';
    volGroup.classList.remove('volume-muted');
    api.setVolume(volumeBeforeMute);
    api.setSiteMute(false);
    customAudioPlayer.volume = volumeBeforeMute / 100;
  } else {
    // Mute
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
api.onToggleMute(toggleMute);

volSlider.oninput = () => {
  if (isMuted) {
    isMuted = false;
    muteBtn.innerHTML = '&#128266;';
    volGroup.classList.remove('volume-muted');
  }
  const val = volSlider.value;
  volDisplay.innerText = val + '%';
  api.setVolume(val);
  customAudioPlayer.volume = val / 100;
  updateVolumeFill();
};

document.querySelectorAll('input[type="radio"]').forEach(radio => {
  radio.onchange = (e) => api.clickOption(e.target.name, e.target.value);
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

  if (data.settings) {
    document.getElementById('set-autoConnect').checked = data.settings.autoConnect;
    document.getElementById('set-alwaysOnTop').checked = data.settings.alwaysOnTop;
    document.getElementById('set-startMinimized').checked = data.settings.startMinimized;
    document.getElementById('set-minimizeOnClose').checked = data.settings.minimizeOnClose;

    if (data.settings.hotkeys) {
      document.getElementById('key-mute').value = data.settings.hotkeys.mute || '';
      document.getElementById('key-volUp').value = data.settings.hotkeys.volUp || '';
      document.getElementById('key-volDown').value = data.settings.hotkeys.volDown || '';
    }
  }
});

api.onUpdateVolume((val) => {
  if (isMuted && val > 0) {
    isMuted = false;
    muteBtn.innerHTML = '&#128266;';
    volGroup.classList.remove('volume-muted');
  }
  volSlider.value = val;
  volDisplay.innerText = val + '%';
  customAudioPlayer.volume = val / 100;
  updateVolumeFill();
});

updateVolumeFill();