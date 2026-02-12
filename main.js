const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');

const { appState, loadSettings, saveSettings } = require('./config');
const gameLogic = require('./game-logic');
const shortcuts = require('./shortcuts');
const tray = require('./tray');

app.setAppUserModelId("com.fe2cm.audioplayer");

// --- GLOBAL STATE ---
let uiWindow;
let backgroundWindow;
let isQuitting = false;
let hasShownMinimizeAlert = false;
let forceReconnect = false;
let userDisconnected = false;
let baseContentSize = { width: 400, height: 580 };

const isQuittingRef = { get value() { return isQuitting; }, set value(v) { isQuitting = v; } };

const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
    app.quit();
} else {
    app.on('second-instance', () => {
        if (uiWindow) {
            if (uiWindow.isMinimized()) uiWindow.restore();
            uiWindow.show();
            uiWindow.focus();
        }
    });
    app.whenReady().then(createWindows);
}

function createWindows() {
    loadSettings();

    const startShow = !appState.settings.startMinimized;

    uiWindow = new BrowserWindow({
        width: 400, height: 580, frame: false, resizable: true,
        minWidth: 300, minHeight: 435,
        show: startShow,
        alwaysOnTop: appState.settings.alwaysOnTop,
        backgroundColor: '#1a202c',
        icon: path.join(__dirname, 'icon.ico'),
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            zoomFactor: 1.0,
            preload: path.join(__dirname, 'preload.js')
        },
    });
    uiWindow.setAspectRatio(400 / 580);
    uiWindow.loadFile('index.html');

    uiWindow.webContents.on('dom-ready', () => {
        uiWindow.webContents.setZoomFactor(1.0);
    });

    uiWindow.on('resize', () => {
        if (!baseContentSize) return;
        const [currentWidth] = uiWindow.getContentSize();
        const zoomFactor = currentWidth / baseContentSize.width;
        uiWindow.webContents.setZoomFactor(zoomFactor);
    });

    backgroundWindow = new BrowserWindow({
        show: false,
        webPreferences: { autoplayPolicy: 'no-user-gesture-required' },
    });
    backgroundWindow.loadURL('https://fe2.io');

    // Initialize modules
    gameLogic.init(backgroundWindow, () => tray.updateTrayMenu(isQuittingRef, () => { isQuitting = true; app.quit(); }));
    shortcuts.init(uiWindow);
    shortcuts.registerShortcuts();
    tray.init(uiWindow, backgroundWindow, (val) => { forceReconnect = val; });

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
            gameLogic.connectUserLogic(appState.username);

            setTimeout(() => {
                gameLogic.applyVolumeLogic(appState.volume);
                gameLogic.clickOptionLogic('onDeath', appState.onDeath);
                gameLogic.clickOptionLogic('onLeave', appState.onLeave);
                uiWindow.webContents.send('connection-status', 'connected');
                forceReconnect = false;
            }, 50);
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

    tray.createTray(isQuittingRef, () => { isQuitting = true; app.quit(); });
}

// --- IPC HANDLERS ---
ipcMain.on('app-close', () => uiWindow.close());
ipcMain.on('app-minimize', () => uiWindow.minimize());

ipcMain.on('save-advanced-settings', (event, newSettings) => {
    appState.settings = { ...appState.settings, ...newSettings };
    if (uiWindow) uiWindow.setAlwaysOnTop(appState.settings.alwaysOnTop);
    saveSettings();
    shortcuts.registerShortcuts();
});

ipcMain.on('refresh-fe2', () => {
    forceReconnect = true;
    if (backgroundWindow) backgroundWindow.reload();
});

ipcMain.on('disconnect-game', () => {
    userDisconnected = true;
    saveSettings();
    if (backgroundWindow) backgroundWindow.reload();
});

ipcMain.on('connect-user', (e, u) => {
    userDisconnected = false;
    gameLogic.connectUserLogic(u);
    setTimeout(() => {
        if (uiWindow) uiWindow.webContents.send('connection-status', 'connected');
    }, 50);
});

ipcMain.on('set-volume', (e, v) => gameLogic.applyVolumeLogic(v));
ipcMain.on('click-option', (e, g, v) => gameLogic.clickOptionLogic(g, v));

ipcMain.on('fit-window', (e, width, height) => {
    if (uiWindow && !uiWindow.isDestroyed()) {
        baseContentSize = { width, height };
        uiWindow.setContentSize(Math.round(width), Math.round(height));
        uiWindow.setAspectRatio(width / height);
    }
});

ipcMain.on('set-site-mute', (event, shouldMute) => {
    if (backgroundWindow && !backgroundWindow.isDestroyed()) {
        backgroundWindow.webContents.executeJavaScript(`
            const a = document.querySelector('audio');
            if(a) a.muted = ${shouldMute};
        `).catch(() => { });
    }
});