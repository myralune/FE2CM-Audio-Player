const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;

const OPTIONS = {
  onDeath: ['Quieten BGM', 'Stop BGM', 'Disable'],
  onLeave: ['Stop BGM', 'Disable'],
};
const SHORT_LABELS = { 'Quieten BGM': 'Quieten', 'Stop BGM': 'Stop', 'Disable': 'Off' };
const VOLUME_SEND_INTERVAL_MS = 50;

const root = document.documentElement;
const quickMenu = document.getElementById('quickMenu');
const volumeSlider = document.getElementById('volume');
const volumeText = document.getElementById('volumeText');
const muteBtn = document.getElementById('muteBtn');
const refreshBtn = document.getElementById('refreshBtn');
const toast = document.getElementById('toast');
const optionButtons = [...document.querySelectorAll('.option-btn')];

const current = { onDeath: '', onLeave: '' };
let draggingVolume = false;
let lastVolumeSent = 0;
let pendingVolume = null;
let toastTimer = null;

function setTheme(theme) {
  root.dataset.theme = theme === 'legacy' ? 'legacy' : 'fe2';
}

function renderVolume(volume) {
  volumeSlider.value = volume;
  volumeText.textContent = volume + '%';
  volumeSlider.style.setProperty('--fill', volume + '%');
  quickMenu.classList.toggle('muted', Number(volume) === 0);
}

function renderOptions() {
  for (const btn of optionButtons) {
    const value = current[btn.dataset.group];
    btn.textContent = SHORT_LABELS[value] || value || '—';
    btn.title = value;
    btn.classList.toggle('is-off', value === 'Disable');
  }
}

function applyState(state) {
  setTheme(state.theme);
  if (!draggingVolume) renderVolume(state.volume);
  current.onDeath = state.onDeath;
  current.onLeave = state.onLeave;
  renderOptions();
}

function sendVolume(volume) {
  const now = performance.now();
  if (now - lastVolumeSent < VOLUME_SEND_INTERVAL_MS) {
    pendingVolume = volume;
    return;
  }
  lastVolumeSent = now;
  pendingVolume = null;
  invoke('quick_set_volume', { value: Number(volume) });
}

volumeSlider.addEventListener('pointerdown', () => { draggingVolume = true; });
volumeSlider.addEventListener('input', () => {
  renderVolume(volumeSlider.value);
  sendVolume(volumeSlider.value);
});
volumeSlider.addEventListener('change', () => {
  draggingVolume = false;
  // Always send the final value, which the throttle may have skipped.
  lastVolumeSent = 0;
  sendVolume(volumeSlider.value);
});
window.addEventListener('pointerup', () => { draggingVolume = false; });

muteBtn.onclick = () => invoke('quick_toggle_mute');

for (const btn of optionButtons) {
  btn.onclick = () => {
    const group = btn.dataset.group;
    const values = OPTIONS[group];
    const next = values[(values.indexOf(current[group]) + 1) % values.length];
    current[group] = next;
    renderOptions();
    invoke('quick_click_option', { group, value: next });
  };
}

refreshBtn.onclick = () => {
  if (refreshBtn.classList.contains('busy')) return;
  refreshBtn.classList.add('busy');
  invoke('quick_refresh');
  setTimeout(() => refreshBtn.classList.remove('busy'), 1500);
};

listen('overlay-open', (e) => {
  applyState(e.payload);
  toast.classList.remove('show');
  quickMenu.classList.add('open');
});

listen('overlay-close', () => {
  quickMenu.classList.remove('open');
  draggingVolume = false;
});

listen('overlay-state', (e) => applyState(e.payload));

listen('overlay-toast', (e) => {
  setTheme(e.payload.theme);
  quickMenu.classList.remove('open');
  toast.textContent = e.payload.text;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 1500);
});

invoke('get_overlay_state').then(applyState);
