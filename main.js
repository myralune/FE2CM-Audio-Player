const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');

let uiWindow;
let backgroundWindow;
let tray = null;
let isQuitting = false;

// PERSISTENCE (SAVE/LOAD)
const configPath = path.join(app.getPath('userData'), 'fe2-config.json');

// Default Settings
let appState = {
    username: '',
    volume: 70,
    onDeath: 'Quieten BGM',
    onLeave: 'Stop BGM'
};

function loadSettings() {
    try {
        if (fs.existsSync(configPath)) {
            const data = JSON.parse(fs.readFileSync(configPath));
            appState = { ...appState, ...data }; // Merge defaults with saved data
            console.log("Loaded Config:", appState);
        }
    } catch (e) { console.error("Load Failed:", e); }
}

function saveSettings() {
    try {
        fs.writeFileSync(configPath, JSON.stringify(appState));
    } catch (e) { console.error("Save Failed:", e); }
}


// WINDOW CREATION
function createWindows() {
  loadSettings(); // Load data before creating windows

  // Custom UI
  uiWindow = new BrowserWindow({
    width: 400,
    height: 580,
    frame: false,
    resizable: false,
    transparent: true,
    backgroundColor: '#00000000',
    icon: path.join(__dirname, 'icon.ico'),
    webPreferences: { nodeIntegration: true, contextIsolation: false },
  });
  uiWindow.loadFile('index.html');

  // Background Worker
  backgroundWindow = new BrowserWindow({
    show: false,
    webPreferences: { autoplayPolicy: 'no-user-gesture-required' },
  });
  
  // WAIT FOR PAGE LOAD TO AUTO-CONNECT
  backgroundWindow.loadURL('https://fe2.io');
  backgroundWindow.webContents.on('did-finish-load', () => {
      // If we have a saved username, auto-connect
      if (appState.username) {
          console.log("Auto-connecting for:", appState.username);
          uiWindow.webContents.send('restore-state', appState);
          connectUserLogic(appState.username);
          
          // Apply settings after a short delay to ensure site is ready
          setTimeout(() => {
              applyVolumeLogic(appState.volume);
              clickOptionLogic('onDeath', appState.onDeath);
              clickOptionLogic('onLeave', appState.onLeave);
          }, 2000);
      }
  });

  // Close Button (Minimize to Tray instead of quitting)
  uiWindow.on('close', (event) => {
      if (!isQuitting) {
          event.preventDefault();
          uiWindow.hide();
      }
      return false;
  });

  createTray();
}

// SYSTEM TRAY
function createTray() {
    const iconPath = path.join(__dirname, 'icon.ico');
    tray = new Tray(nativeImage.createFromPath(iconPath));
    
    tray.setToolTip('FE2CM Audio Player');
    
    // Left click toggles window
    tray.on('click', () => {
        uiWindow.isVisible() ? uiWindow.hide() : uiWindow.show();
    });

    updateTrayMenu();
}

function updateTrayMenu() {
    const contextMenu = Menu.buildFromTemplate([
        { label: 'FE2CM Audio Player', enabled: false },
        { type: 'separator' },
        { 
            label: uiWindow.isVisible() ? 'Minimize to Tray' : 'Show App', 
            click: () => uiWindow.isVisible() ? uiWindow.hide() : uiWindow.show() 
        },
        { type: 'separator' },
        {
            label: 'Volume',
            submenu: [
                { label: 'Mute (0%)', click: () => changeVolumeFromTray(0) },
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
        { 
            label: 'Reconnect', 
            click: () => {
                if(backgroundWindow) backgroundWindow.reload();
            } 
        },
        { type: 'separator' },
        { 
            label: 'Quit', 
            click: () => {
                isQuitting = true;
                app.quit();
            } 
        }
    ]);
    
    tray.setContextMenu(contextMenu);
}

// Shared by IPC and Tray
function runSafe(desc, jsCode) {
    if (!backgroundWindow) return;
    const safeCode = `try { ${jsCode} } catch (e) { console.error('${desc} error:', e); }`;
    backgroundWindow.webContents.executeJavaScript(safeCode).catch(() => {});
}

function connectUserLogic(username) {
    appState.username = username;
    saveSettings();
    
    runSafe('Connect', `
        const input = document.querySelector('input[type="text"]');
        if(input) {
            input.value = "${username}";
            input.dispatchEvent(new Event('input', { bubbles: true }));
            const btns = Array.from(document.querySelectorAll('button'));
            const connectBtn = btns.find(b => b.innerText.includes('Connect')); 
            if(connectBtn) connectBtn.click();
        }
    `);
}

function applyVolumeLogic(value) {
    appState.volume = value;
    saveSettings();
    
    runSafe('Volume', `
        const slider = document.getElementById('volumeRange');
        if(slider) {
            slider.value = ${value};
            slider.dispatchEvent(new Event('input', { bubbles: true }));
            slider.dispatchEvent(new Event('change', { bubbles: true }));
        }
    `);
}

function clickOptionLogic(groupName, value) {
    // Update State
    if (groupName === 'onDeath') appState.onDeath = value;
    if (groupName === 'onLeave') appState.onLeave = value;
    saveSettings();
    updateTrayMenu(); // Update checkmarks in tray

    let targetId = null;
    if (groupName === 'onDeath') {
        if (value === 'Quieten BGM') targetId = 'deathQuietenRadio';
        if (value === 'Stop BGM')    targetId = 'deathStopRadio';
        if (value === 'Disable')     targetId = 'deathDisableRadio';
    } 
    else if (groupName === 'onLeave') {
        if (value === 'Stop BGM')    targetId = 'leaveStopRadio';
        if (value === 'Disable')     targetId = 'leaveDisableRadio';
    }

    if (targetId) {
        runSafe('Radio Click', `
            const el = document.getElementById('${targetId}');
            if(el) el.click();
        `);
    }
}

// More Tray Stuff
function changeVolumeFromTray(val) {
    applyVolumeLogic(val);
    uiWindow.webContents.send('update-volume', val); // Sync UI
}

function changeOptionFromTray(group, val) {
    clickOptionLogic(group, val);
    // Sync UI Again
    uiWindow.webContents.send('restore-state', appState);
}


// IPC Handling from ui

app.whenReady().then(createWindows);

ipcMain.on('app-close', () => uiWindow.hide());
ipcMain.on('app-minimize', () => uiWindow.minimize());

ipcMain.on('disconnect-game', () => {
    // Clear username on disconnect so we don't auto-connect next time
    appState.username = ''; 
    saveSettings();
    if(backgroundWindow) backgroundWindow.reload();
});

ipcMain.on('connect-user', (e, user) => connectUserLogic(user));
ipcMain.on('set-volume', (e, val) => applyVolumeLogic(val));
ipcMain.on('click-option', (e, group, val) => clickOptionLogic(group, val));