const { autoUpdater } = require('electron-updater');
const { dialog } = require('electron');

let uiWindow = null;

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
                if (uiWindow && !uiWindow.isDestroyed()) {
                    uiWindow.webContents.send('update-status', 'downloading');
                }
                autoUpdater.downloadUpdate();
            }
        });
    });

    autoUpdater.on('update-downloaded', () => {
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
    });
}

function checkForUpdates() {
    autoUpdater.checkForUpdates().catch((err) => {
        console.log('Update check failed:', err.message);
    });
}

module.exports = { init, checkForUpdates };
