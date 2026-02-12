const { autoUpdater } = require('electron-updater');
const { dialog, BrowserWindow } = require('electron');

let uiWindow = null;
let progressWindow = null;

function createProgressWindow() {
    if (progressWindow && !progressWindow.isDestroyed()) return;

    progressWindow = new BrowserWindow({
        width: 350,
        height: 120,
        resizable: false,
        minimizable: false,
        maximizable: false,
        closable: false,
        frame: false,
        alwaysOnTop: true,
        backgroundColor: '#1a202c',
        parent: uiWindow,
        modal: true,
        webPreferences: { nodeIntegration: false, contextIsolation: true }
    });

    progressWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(`
        <!DOCTYPE html>
        <html>
        <head><style>
            * { margin: 0; padding: 0; box-sizing: border-box; }
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #1a202c; color: #e2e8f0; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; padding: 20px; -webkit-app-region: drag; }
            .title { font-size: 13px; font-weight: 600; margin-bottom: 12px; }
            .bar-bg { width: 100%; height: 8px; background: #4a5568; border-radius: 4px; overflow: hidden; }
            .bar-fill { height: 100%; width: 0%; background: #3182ce; border-radius: 4px; transition: width 0.3s ease; }
            .percent { font-size: 12px; color: #a0aec0; margin-top: 8px; }
        </style></head>
        <body>
            <div class="title">Downloading update...</div>
            <div class="bar-bg"><div class="bar-fill" id="bar"></div></div>
            <div class="percent" id="pct">0%</div>
        </body>
        </html>
    `)}`);
}

function closeProgressWindow() {
    if (progressWindow && !progressWindow.isDestroyed()) {
        progressWindow.destroy();
        progressWindow = null;
    }
}

function init(window) {
    uiWindow = window;

    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = true;

    autoUpdater.on('update-available', (info) => {
        dialog.showMessageBox(uiWindow, {
            type: 'info',
            title: 'Update Available',
            message: `A new version (v${info.version}) is available.`,
            detail: 'Would you like to download and install it?',
            buttons: ['Update', 'Later'],
            defaultId: 0
        }).then(({ response }) => {
            if (response === 0) {
                createProgressWindow();
                autoUpdater.downloadUpdate().catch((err) => {
                    closeProgressWindow();
                    dialog.showMessageBox(uiWindow, {
                        type: 'error',
                        title: 'Update Failed',
                        message: 'Failed to download update.',
                        detail: err.message || 'Please check your internet connection and try again later.',
                        buttons: ['OK']
                    });
                });
            }
        });
    });

    autoUpdater.on('download-progress', (progress) => {
        if (progressWindow && !progressWindow.isDestroyed()) {
            const pct = Math.round(progress.percent);
            progressWindow.webContents.executeJavaScript(`
                document.getElementById('bar').style.width = '${pct}%';
                document.getElementById('pct').innerText = '${pct}%';
            `).catch(() => {});
        }
    });

    autoUpdater.on('update-downloaded', () => {
        closeProgressWindow();
        dialog.showMessageBox(uiWindow, {
            type: 'info',
            title: 'Update Ready',
            message: 'Update has been downloaded.',
            detail: 'The application will restart to apply the update.',
            buttons: ['Restart Now', 'Later'],
            defaultId: 0
        }).then(({ response }) => {
            if (response === 0) {
                autoUpdater.quitAndInstall(false, true);
            }
        });
    });

    autoUpdater.on('error', (err) => {
        console.log('Auto-updater error:', err.message);
        closeProgressWindow();
        dialog.showMessageBox(uiWindow, {
            type: 'error',
            title: 'Update Error',
            message: 'An error occurred while updating.',
            detail: err.message || 'Please try again later.',
            buttons: ['OK']
        });
    });
}

function checkForUpdates() {
    autoUpdater.checkForUpdates().catch((err) => {
        console.log('Update check failed:', err.message);
    });
}

module.exports = { init, checkForUpdates };
