const { Tray, Menu, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const { appState } = require('./config');
const { applyVolumeLogic, clickOptionLogic } = require('./game-logic');

let tray = null;
let uiWindow = null;
let backgroundWindow = null;
let forceReconnectSetter = null;

function init(ui, bg, setForceReconnect) {
    uiWindow = ui;
    backgroundWindow = bg;
    forceReconnectSetter = setForceReconnect;
}

function createTray(isQuittingRef, quitApp) {
    const iconPath = path.join(__dirname, 'icon.ico');
    let trayIcon = fs.existsSync(iconPath) ? nativeImage.createFromPath(iconPath) : nativeImage.createEmpty();
    tray = new Tray(trayIcon);
    tray.setToolTip('FE2CM Audio Player');
    tray.on('click', () => uiWindow.isVisible() ? uiWindow.hide() : uiWindow.show());
    updateTrayMenu(isQuittingRef, quitApp);
}

function updateTrayMenu(isQuittingRef, quitApp) {
    const contextMenu = Menu.buildFromTemplate([
        { label: 'FE2CM Audio Player', enabled: false },
        { type: 'separator' },
        {
            label: 'Toggle Visibility',
            click: () => {
                if (uiWindow.isVisible()) {
                    uiWindow.hide();
                } else {
                    uiWindow.show();
                    uiWindow.focus();
                }
            },
        },
        {
            label: 'Refresh FE2IO',
            click: () => {
                if (forceReconnectSetter) forceReconnectSetter(true);
                if (backgroundWindow) backgroundWindow.reload();
            }
        },
        { type: 'separator' },
        {
            label: 'Volume',
            submenu: [
                { label: 'Mute', click: () => changeVolumeFromTray(0) },
                { label: '25%', click: () => changeVolumeFromTray(25) },
                { label: '50%', click: () => changeVolumeFromTray(50) },
                { label: '75%', click: () => changeVolumeFromTray(75) },
                { label: '100%', click: () => changeVolumeFromTray(100) }
            ]
        },
        {
            label: 'On Death',
            submenu: [
                { label: 'Quieten BGM', type: 'radio', checked: appState.onDeath === 'Quieten BGM', click: () => changeOptionFromTray('onDeath', 'Quieten BGM') },
                { label: 'Stop BGM', type: 'radio', checked: appState.onDeath === 'Stop BGM', click: () => changeOptionFromTray('onDeath', 'Stop BGM') },
                { label: 'Disable', type: 'radio', checked: appState.onDeath === 'Disable', click: () => changeOptionFromTray('onDeath', 'Disable') }
            ]
        },
        {
            label: 'Leaving Game',
            submenu: [
                { label: 'Stop BGM', type: 'radio', checked: appState.onLeave === 'Stop BGM', click: () => changeOptionFromTray('onLeave', 'Stop BGM') },
                { label: 'Disable', type: 'radio', checked: appState.onLeave === 'Disable', click: () => changeOptionFromTray('onLeave', 'Disable') }
            ]
        },
        { type: 'separator' },
        { label: 'Quit', click: () => { if (isQuittingRef) isQuittingRef.value = true; quitApp(); } }
    ]);
    tray.setContextMenu(contextMenu);
}

function changeVolumeFromTray(val) {
    applyVolumeLogic(val);
    uiWindow.webContents.send('update-volume', val);
}

function changeOptionFromTray(group, val) {
    clickOptionLogic(group, val);
    uiWindow.webContents.send('restore-state', appState);
}

module.exports = { init, createTray, updateTrayMenu };