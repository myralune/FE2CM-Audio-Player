const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    // Window controls
    close: () => ipcRenderer.send('app-close'),
    minimize: () => ipcRenderer.send('app-minimize'),

    // Connection
    connectUser: (username) => ipcRenderer.send('connect-user', username),
    disconnectGame: () => ipcRenderer.send('disconnect-game'),
    refreshFE2: () => ipcRenderer.send('refresh-fe2'),

    // Audio controls
    setVolume: (val) => ipcRenderer.send('set-volume', val),
    clickOption: (group, val) => ipcRenderer.send('click-option', group, val),
    
    // Custom Audio Helpers
    setSiteMute: (shouldMute) => ipcRenderer.send('set-site-mute', shouldMute),
    onGameAudioState: (callback) => ipcRenderer.on('game-audio-state', (_event, state) => callback(state)),

    // Settings
    saveAdvancedSettings: (settings) => ipcRenderer.send('save-advanced-settings', settings),

    // Window sizing
    fitWindow: (width, height) => ipcRenderer.send('fit-window', width, height),

    // Listeners
    onStartLoading: (callback) => ipcRenderer.on('start-loading', (_event) => callback()),
    onRestoreState: (callback) => ipcRenderer.on('restore-state', (_event, data) => callback(data)),
    onUpdateVolume: (callback) => ipcRenderer.on('update-volume', (_event, val) => callback(val)),
    onConnectionStatus: (callback) => ipcRenderer.on('connection-status', (_event, status) => callback(status)),
    onToggleMute: (callback) => ipcRenderer.on('toggle-mute', (_event) => callback()),
});