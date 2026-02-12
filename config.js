const { app } = require('electron');
const path = require('path');
const fs = require('fs');

const configPath = path.join(app.getPath('userData'), 'fe2-config.json');

let appState = {
    username: '',
    volume: 70,
    previousVolume: 70,
    onDeath: 'Quieten BGM',
    onLeave: 'Stop BGM',
    settings: {
        autoConnect: true,
        alwaysOnTop: false,
        startMinimized: false,
        minimizeOnClose: true,
        hotkeys: { mute: '', volUp: '', volDown: '' }
    }
};

function loadSettings() {
    try {
        if (fs.existsSync(configPath)) {
            const saved = JSON.parse(fs.readFileSync(configPath));
            const defaultSettings = { ...appState.settings };
            Object.assign(appState, saved);
            appState.settings = { ...defaultSettings, ...(saved.settings || {}) };
            if (!appState.previousVolume) appState.previousVolume = 70;
        }
    } catch (e) { console.error(e); }
}

function saveSettings() {
    try { fs.writeFileSync(configPath, JSON.stringify(appState)); } catch (e) { }
}

module.exports = { appState, loadSettings, saveSettings };