const { appState, saveSettings } = require('./config');

let backgroundWindow = null;
let updateTrayMenu = null;
let customAudioActive = false;

function init(bgWindow, trayMenuUpdater) {
    backgroundWindow = bgWindow;
    updateTrayMenu = trayMenuUpdater;
}

function setCustomAudioActive(active) {
    customAudioActive = active;
}

function runSafe(desc, jsCode) {
    if (!backgroundWindow || backgroundWindow.isDestroyed()) return;
    backgroundWindow.webContents.executeJavaScript(`try { ${jsCode} } catch (e) {}`)
        .catch(err => console.log(`[${desc}] Ignored error:`, err.message));
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
    // Don't touch FE2's volume when custom audio is active — it's held at 0
    if (!customAudioActive) {
        runSafe('Volume', `
            const s = document.getElementById('volumeRange');
            if(s) { s.value = ${val}; s.dispatchEvent(new Event('input', { bubbles: true })); s.dispatchEvent(new Event('change', { bubbles: true })); }
        `);
    }
}

function clickOptionLogic(group, val) {
    if (group === 'onDeath') appState.onDeath = val;
    if (group === 'onLeave') appState.onLeave = val;
    saveSettings();
    if (updateTrayMenu) updateTrayMenu();

    const ids = {
        'onDeath': { 'Quieten BGM': 'deathQuietenRadio', 'Stop BGM': 'deathStopRadio', 'Disable': 'deathDisableRadio' },
        'onLeave': { 'Stop BGM': 'leaveStopRadio', 'Disable': 'leaveDisableRadio' }
    };
    if (ids[group] && ids[group][val]) {
        runSafe('Radio', `const el = document.getElementById('${ids[group][val]}'); if(el) el.click();`);
    }
}

module.exports = { init, connectUserLogic, applyVolumeLogic, clickOptionLogic, setCustomAudioActive };