const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;

const on = (event) => (callback) => {
  listen(event, (e) => callback(e.payload));
};

window.electronAPI = {
  close: () => invoke('app_close'),
  minimize: () => invoke('app_minimize'),
  fitWindow: (width, height) => invoke('fit_window', { width, height }),

  connectUser: (username) => invoke('connect_user', { username }),
  disconnectGame: () => invoke('disconnect_game'),
  refreshFE2: () => invoke('refresh_fe2'),
  showFe2Window: () => invoke('show_fe2_window'),

  // The slider hands us strings.
  setVolume: (val) => invoke('set_volume', { value: Math.round(Number(val)) }),
  clickOption: (group, val) => invoke('click_option', { group, value: val }),
  setSiteMute: (mute) => invoke('set_site_mute', { mute }),
  setSiteVolume: (vol) => invoke('set_site_volume', { value: Math.round(Number(vol)) }),
  setCustomAudioActive: (active) => invoke('set_custom_audio_active', { active }),
  onGameAudioState: on('game-audio-state'),

  saveAdvancedSettings: (settings) => invoke('save_advanced_settings', { settings }),

  importTheme: (name, description, base, css) => invoke('import_theme', { name, description, base, css }),
  deleteTheme: (id) => invoke('delete_theme', { id }),
  getThemeCss: (id) => invoke('get_theme_css', { id }),
  onSetTheme: on('set-theme'),
  showNotification: (text) => invoke('show_notification', { text }),

  startHotkeyCapture: () => invoke('start_hotkey_capture'),
  stopHotkeyCapture: () => invoke('stop_hotkey_capture'),
  onHotkeyCaptured: on('hotkey-captured'),

  onStartLoading: (callback) => { listen('start-loading', () => callback()); },
  onRestoreState: (callback) => {
    listen('restore-state', (e) => callback(e.payload));
    invoke('get_config').then(callback);
  },
  onUpdateVolume: on('update-volume'),
  onConnectionStatus: (callback) => {
    listen('connection-status', (e) => callback(e.payload));
    // The status may have been emitted before we started listening.
    invoke('ui_ready').then((status) => { if (status) callback(status); });
  },
  onToggleMute: (callback) => { listen('toggle-mute', () => callback()); },

  // Only reaches a file in the diagnostics build; elsewhere no logger is installed.
  debugLog: (level, message) => { invoke('debug_log', { level, message: String(message) }).catch(() => {}); },
};

window.addEventListener('error', (e) => {
  window.electronAPI.debugLog('error', `ui error: ${e.message} @${e.filename}:${e.lineno}`);
});
window.addEventListener('unhandledrejection', (e) => {
  const r = e.reason;
  window.electronAPI.debugLog('error', `ui unhandled rejection: ${(r && (r.stack || r.message)) || r}`);
});

invoke('build_info').then((info) => {
  if (!info.diagnostics) return;
  document.querySelectorAll('.title-text').forEach((el) => { el.textContent += ' (Debug)'; });
}).catch(() => {});
