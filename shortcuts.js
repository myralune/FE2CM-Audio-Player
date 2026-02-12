const { globalShortcut } = require('electron');
const { appState } = require('./config');
const { applyVolumeLogic } = require('./game-logic');

let uiWindow = null;

function init(window) {
    uiWindow = window;
}

function registerShortcuts() {
    globalShortcut.unregisterAll();
    if (!appState.settings || !appState.settings.hotkeys) return;
    const k = appState.settings.hotkeys;

    const reg = (accel, callback) => {
        if (accel && accel.trim() !== '') {
            try {
                const finalAccel = accel.replace('Ctrl', 'Control');
                globalShortcut.register(finalAccel, callback);
            } catch (e) { console.log("Invalid shortcut:", accel); }
        }
    };

    reg(k.mute, () => {
        if (uiWindow) uiWindow.webContents.send('toggle-mute');
    });

    reg(k.volUp, () => {
        const newVol = Math.min(100, parseInt(appState.volume) + 10);
        applyVolumeLogic(newVol);
        if (uiWindow) uiWindow.webContents.send('update-volume', newVol);
    });

    reg(k.volDown, () => {
        const newVol = Math.max(0, parseInt(appState.volume) - 10);
        applyVolumeLogic(newVol);
        if (uiWindow) uiWindow.webContents.send('update-volume', newVol);
    });
}

module.exports = { init, registerShortcuts };