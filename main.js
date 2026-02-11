const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, dialog, globalShortcut } = require('electron');
const path = require('path');
const fs = require('fs');

app.setAppUserModelId("com.fe2cm.audioplayer");

const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) { app.quit(); } else {
    app.on('second-instance', () => {
        if (uiWindow) {
            if (uiWindow.isMinimized()) uiWindow.restore();
            uiWindow.show();
            uiWindow.focus();
        }
    });
    app.whenReady().then(createWindows);
}

// --- GLOBAL VARIABLES ---
let uiWindow;
let backgroundWindow;
let tray = null;
let isQuitting = false;
let hasShownMinimizeAlert = false;
let forceReconnect = false;
let userDisconnected = false;

// --- CONFIGURATION ---
const configPath = path.join(app.getPath('userData'), 'fe2-config.json');

// Default State
let appState = {
    username: '',
    volume: 70,
    previousVolume: 70,
    onDeath: 'Quieten BGM',
    onLeave: 'Stop BGM',
    settings: {
        autoConnect: true,
        startMinimized: false,
        minimizeOnClose: true,
        hotkeys: { mute: '', volUp: '', volDown: '' }
    }
};

function loadSettings() {
    try {
        if (fs.existsSync(configPath)) {
            const saved = JSON.parse(fs.readFileSync(configPath));
            appState = { ...appState, ...saved };
            appState.settings = { ...appState.settings, ...(saved.settings || {}) };

            if (!appState.previousVolume) appState.previousVolume = 70;
        }
    } catch (e) { console.error(e); }
}

function saveSettings() {
    try { fs.writeFileSync(configPath, JSON.stringify(appState)); } catch (e) { }
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

    let previousVolume = appState.volume;

    reg(k.mute, () => {
        let newVol;
        if (appState.volume > 0) {
            appState.previousVolume = appState.volume;
            newVol = 0;
        } else {
            newVol = appState.previousVolume || 70;
        }

        applyVolumeLogic(newVol);
        if (uiWindow) uiWindow.webContents.send('update-volume', newVol);
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

function createWindows() {
    loadSettings();
    registerShortcuts();

    const startShow = !appState.settings.startMinimized;

    uiWindow = new BrowserWindow({
        width: 400, height: 580, frame: false, resizable: false,
        show: startShow,
        transparent: true, backgroundColor: '#00000000',
        icon: path.join(__dirname, 'icon.ico'),
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.js')
        },
    });
    uiWindow.loadFile('index.html');

    backgroundWindow = new BrowserWindow({
        show: false,
        webPreferences: { autoplayPolicy: 'no-user-gesture-required' },
    });
    backgroundWindow.loadURL('https://fe2.io');

    backgroundWindow.webContents.on('did-finish-load', () => {
        uiWindow.webContents.send('restore-state', appState);

        // Audio Polling
        setInterval(() => {
            if (!backgroundWindow || backgroundWindow.isDestroyed()) return;
            backgroundWindow.webContents.executeJavaScript(`
              (function(){
                  const a = document.querySelector('audio');
                  return a ? !a.paused : false;
              })()
          `).then(isPlaying => {
                if (uiWindow && !uiWindow.isDestroyed()) {
                    uiWindow.webContents.send('game-audio-state', isPlaying ? 'playing' : 'paused');
                }
            }).catch(() => { });
        }, 1000);

        // Auto-Connect Check
        const shouldConnect = (appState.username && appState.username !== '') &&
            (appState.settings.autoConnect === true || forceReconnect) &&
            !userDisconnected;

        if (shouldConnect) {
            console.log("Connecting with saved username:", appState.username);
            uiWindow.webContents.send('start-loading');

            connectUserLogic(appState.username);

            setTimeout(() => {
                applyVolumeLogic(appState.volume);
                clickOptionLogic('onDeath', appState.onDeath);
                clickOptionLogic('onLeave', appState.onLeave);

                uiWindow.webContents.send('connection-status', 'connected');
                forceReconnect = false;
            }, 2000);
        } else {
            console.log("Showing Login Screen");
            uiWindow.webContents.send('connection-status', 'show-login');
        }
    });

    uiWindow.on('close', (event) => {
        if (!isQuitting) {
            if (!appState.settings.minimizeOnClose) {
                isQuitting = true;
                app.quit();
                return;
            }
            event.preventDefault();
            if (!hasShownMinimizeAlert) {
                dialog.showMessageBox(uiWindow, {
                    type: 'info', buttons: ['OK'], title: 'FE2CM Audio Player',
                    message: 'App minimized to Tray.',
                    detail: 'You can change this behavior in Settings.'
                }).then(() => {
                    uiWindow.hide();
                    hasShownMinimizeAlert = true;
                });
            } else {
                uiWindow.hide();
            }
        }
        return false;
    });

    createTray();
}

function createTray() {
    const iconPath = path.join(__dirname, 'icon.ico');
    let trayIcon = fs.existsSync(iconPath) ? nativeImage.createFromPath(iconPath) : nativeImage.createEmpty();
    tray = new Tray(trayIcon);
    tray.setToolTip('FE2CM Audio Player');
    tray.on('click', () => uiWindow.isVisible() ? uiWindow.hide() : uiWindow.show());
    updateTrayMenu();
}

function updateTrayMenu() {
    const contextMenu = Menu.buildFromTemplate([
        { label: 'FE2CM Audio Player', enabled: false },
        { type: 'separator' },

        // MINIMIZE TO TRAY
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

        // REFRESH BUTTON
        {
            label: 'Refresh FE2IO',
            click: () => {
                forceReconnect = true;
                if (backgroundWindow) backgroundWindow.reload();
            }
        },

        { type: 'separator' },

        // VOLUME
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

        // ON DEATH
        {
            label: 'On Death',
            submenu: [
                { label: 'Quieten BGM', type: 'radio', checked: appState.onDeath === 'Quieten BGM', click: () => changeOptionFromTray('onDeath', 'Quieten BGM') },
                { label: 'Stop BGM', type: 'radio', checked: appState.onDeath === 'Stop BGM', click: () => changeOptionFromTray('onDeath', 'Stop BGM') },
                { label: 'Disable', type: 'radio', checked: appState.onDeath === 'Disable', click: () => changeOptionFromTray('onDeath', 'Disable') }
            ]
        },

        // LEAVING GAME
        {
            label: 'Leaving Game',
            submenu: [
                { label: 'Stop BGM', type: 'radio', checked: appState.onLeave === 'Stop BGM', click: () => changeOptionFromTray('onLeave', 'Stop BGM') },
                { label: 'Disable', type: 'radio', checked: appState.onLeave === 'Disable', click: () => changeOptionFromTray('onLeave', 'Disable') }
            ]
        },

        { type: 'separator' },
        { label: 'Quit', click: () => { isQuitting = true; app.quit(); } }
    ]);
    tray.setContextMenu(contextMenu);
}

// HELPERS
function runSafe(desc, jsCode) {
    if (!backgroundWindow || backgroundWindow.isDestroyed()) return;
    backgroundWindow.webContents.executeJavaScript(`try { ${jsCode} } catch (e) {}`)
        .catch(err => console.log(`[${desc}] Ignored error:`, err.message));
}

function connectUserLogic(username) {
    appState.username = username; saveSettings();
    runSafe('Connect', `
        const input = document.querySelector('input[type="text"]');
        if(input) {
            input.value = "${username}";
            input.dispatchEvent(new Event('input', { bubbles: true }));
            const btns = Array.from(document.querySelectorAll('button'));
            const b = btns.find(x => x.innerText.includes('Connect')); 
            if(b) b.click();
        }
    `);
}

function applyVolumeLogic(val) {
    appState.volume = val;

    if (val > 0) {
        appState.previousVolume = val;
    }

    saveSettings();
    runSafe('Volume', `
        const s = document.getElementById('volumeRange');
        if(s) { s.value = ${val}; s.dispatchEvent(new Event('input', { bubbles: true })); s.dispatchEvent(new Event('change', { bubbles: true })); }
    `);
}

function clickOptionLogic(group, val) {
    if (group === 'onDeath') appState.onDeath = val;
    if (group === 'onLeave') appState.onLeave = val;
    saveSettings();
    updateTrayMenu(); // Update the checks in the tray

    const ids = {
        'onDeath': { 'Quieten BGM': 'deathQuietenRadio', 'Stop BGM': 'deathStopRadio', 'Disable': 'deathDisableRadio' },
        'onLeave': { 'Stop BGM': 'leaveStopRadio', 'Disable': 'leaveDisableRadio' }
    };
    if (ids[group] && ids[group][val]) {
        runSafe('Radio', `const el = document.getElementById('${ids[group][val]}'); if(el) el.click();`);
    }
}

function changeVolumeFromTray(val) { applyVolumeLogic(val); uiWindow.webContents.send('update-volume', val); }
function changeOptionFromTray(group, val) { clickOptionLogic(group, val); uiWindow.webContents.send('restore-state', appState); }

ipcMain.on('app-close', () => uiWindow.close());
ipcMain.on('app-minimize', () => uiWindow.minimize());

ipcMain.on('save-advanced-settings', (event, newSettings) => {
    appState.settings = { ...appState.settings, ...newSettings };
    saveSettings();
    registerShortcuts();
});

ipcMain.on('disconnect-game', () => {
    userDisconnected = true;
    saveSettings();
    if (backgroundWindow) backgroundWindow.reload();
});

ipcMain.on('connect-user', (e, u) => {
    userDisconnected = false;
    connectUserLogic(u);
    setTimeout(() => {
        if (uiWindow) uiWindow.webContents.send('connection-status', 'connected');
    }, 1000);
});

ipcMain.on('set-volume', (e, v) => applyVolumeLogic(v));
ipcMain.on('click-option', (e, g, v) => clickOptionLogic(g, v));

ipcMain.on('set-site-mute', (event, shouldMute) => {
    if (backgroundWindow && !backgroundWindow.isDestroyed()) {
        backgroundWindow.webContents.executeJavaScript(`
            const a = document.querySelector('audio');
            if(a) a.muted = ${shouldMute};
        `).catch(() => { });
    }
});