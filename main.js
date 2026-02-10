const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

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

// --- GLOBAL VARIABLES ---
let uiWindow;
let backgroundWindow;
let tray = null;
let isQuitting = false;
let hasShownMinimizeAlert = false;

// --- CONFIGURATION ---
const configPath = path.join(app.getPath('userData'), 'fe2-config.json');
let appState = { username: '', volume: 70, onDeath: 'Quieten BGM', onLeave: 'Stop BGM' };

function loadSettings() {
    try {
        if (fs.existsSync(configPath)) {
            appState = { ...appState, ...JSON.parse(fs.readFileSync(configPath)) };
        }
    } catch (e) { console.error(e); }
}

function saveSettings() {
    try { fs.writeFileSync(configPath, JSON.stringify(appState)); } catch (e) {}
}

// --- CREATE WINDOWS ---
function createWindows() {
  loadSettings();

  // UI Window
  uiWindow = new BrowserWindow({
    width: 400, height: 580, frame: false, resizable: false,
    transparent: true, backgroundColor: '#00000000',
    icon: path.join(__dirname, 'icon.ico'),
    webPreferences: { nodeIntegration: true, contextIsolation: false },
  });
  uiWindow.loadFile('index.html');

  // Background Worker
  backgroundWindow = new BrowserWindow({
    show: false,
    webPreferences: { autoplayPolicy: 'no-user-gesture-required' },
  });
  backgroundWindow.loadURL('https://fe2.io');

  // Auto-Connect Logic
  backgroundWindow.webContents.on('did-finish-load', () => {
      if (appState.username) {
          uiWindow.webContents.send('start-loading');
          uiWindow.webContents.send('restore-state', appState);
          connectUserLogic(appState.username);
          setTimeout(() => {
              applyVolumeLogic(appState.volume);
              clickOptionLogic('onDeath', appState.onDeath);
              clickOptionLogic('onLeave', appState.onLeave);
          }, 2000);
      }
  });

  // Handle Close to Tray
  uiWindow.on('close', (event) => {
      if (!isQuitting) {
          event.preventDefault(); // Stop the app from closing
          
          if (!hasShownMinimizeAlert) {
              // Show the Pop-up Dialog
              dialog.showMessageBox(uiWindow, {
                  type: 'info',
                  buttons: ['OK'],
                  title: 'FE2CM Audio Player',
                  message: 'The app is still running!',
                  detail: 'The app has been minimized to the System Tray. Right-click the icon in your taskbar to quit.'
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

// Tray
function createTray() {
    const iconPath = path.join(__dirname, 'icon.ico');
    
    let trayIcon;
    if (fs.existsSync(iconPath)) {
        trayIcon = nativeImage.createFromPath(iconPath);
    } else {
        console.log("Icon not found, using system default");
        trayIcon = nativeImage.createEmpty(); 
    }

    tray = new Tray(trayIcon);
    tray.setToolTip('FE2CM Audio Player');
    tray.on('click', () => uiWindow.isVisible() ? uiWindow.hide() : uiWindow.show());
    
    updateTrayMenu();
}

function updateTrayMenu() {
    const contextMenu = Menu.buildFromTemplate([
        { label: 'FE2CM Audio Player', enabled: false },
        { type: 'separator' },
        { label: uiWindow.isVisible() ? 'Minimize to Tray' : 'Show App', click: () => uiWindow.isVisible() ? uiWindow.hide() : uiWindow.show() },
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
        { label: 'Quit', click: () => { isQuitting = true; app.quit(); } }
    ]);
    
    tray.setContextMenu(contextMenu);
}

// Helpers
function runSafe(desc, jsCode) {
    if (!backgroundWindow) return;
    backgroundWindow.webContents.executeJavaScript(`try { ${jsCode} } catch (e) {}`).catch(() => {});
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
    appState.volume = val; saveSettings();
    runSafe('Volume', `
        const s = document.getElementById('volumeRange');
        if(s) { s.value = ${val}; s.dispatchEvent(new Event('input', { bubbles: true })); s.dispatchEvent(new Event('change', { bubbles: true })); }
    `);
}

function clickOptionLogic(group, val) {
    if(group==='onDeath') appState.onDeath = val;
    if(group==='onLeave') appState.onLeave = val;
    saveSettings();
    updateTrayMenu(); 

    const ids = {
        'onDeath': {'Quieten BGM': 'deathQuietenRadio', 'Stop BGM': 'deathStopRadio', 'Disable': 'deathDisableRadio'},
        'onLeave': {'Stop BGM': 'leaveStopRadio', 'Disable': 'leaveDisableRadio'}
    };
    
    if(ids[group] && ids[group][val]) {
        runSafe('Radio', `const el = document.getElementById('${ids[group][val]}'); if(el) el.click();`);
    }
}

// IPC
function changeVolumeFromTray(val) { applyVolumeLogic(val); uiWindow.webContents.send('update-volume', val); }
function changeOptionFromTray(group, val) { clickOptionLogic(group, val); uiWindow.webContents.send('restore-state', appState); }

ipcMain.on('app-close', () => uiWindow.close()); 

ipcMain.on('app-minimize', () => uiWindow.minimize());
ipcMain.on('disconnect-game', () => { 
    appState.username = ''; saveSettings(); 
    if(backgroundWindow) backgroundWindow.reload(); 
});
ipcMain.on('connect-user', (e, u) => connectUserLogic(u));
ipcMain.on('set-volume', (e, v) => applyVolumeLogic(v));
ipcMain.on('click-option', (e, g, v) => clickOptionLogic(g, v));
