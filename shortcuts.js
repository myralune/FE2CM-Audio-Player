const { uIOhook, UiohookKey } = require('uiohook-napi');
const { appState } = require('./config');
const { applyVolumeLogic } = require('./game-logic');

let uiWindow = null;
let registeredShortcuts = [];
let hookStarted = false;

// Map from accelerator string tokens to uiohook keycodes
const keyMap = {
    // Letters
    'A': UiohookKey.A, 'B': UiohookKey.B, 'C': UiohookKey.C, 'D': UiohookKey.D,
    'E': UiohookKey.E, 'F': UiohookKey.F, 'G': UiohookKey.G, 'H': UiohookKey.H,
    'I': UiohookKey.I, 'J': UiohookKey.J, 'K': UiohookKey.K, 'L': UiohookKey.L,
    'M': UiohookKey.M, 'N': UiohookKey.N, 'O': UiohookKey.O, 'P': UiohookKey.P,
    'Q': UiohookKey.Q, 'R': UiohookKey.R, 'S': UiohookKey.S, 'T': UiohookKey.T,
    'U': UiohookKey.U, 'V': UiohookKey.V, 'W': UiohookKey.W, 'X': UiohookKey.X,
    'Y': UiohookKey.Y, 'Z': UiohookKey.Z,
    // Digits
    '0': UiohookKey[0], '1': UiohookKey[1], '2': UiohookKey[2], '3': UiohookKey[3],
    '4': UiohookKey[4], '5': UiohookKey[5], '6': UiohookKey[6], '7': UiohookKey[7],
    '8': UiohookKey[8], '9': UiohookKey[9],
    // Function keys
    'F1': UiohookKey.F1, 'F2': UiohookKey.F2, 'F3': UiohookKey.F3, 'F4': UiohookKey.F4,
    'F5': UiohookKey.F5, 'F6': UiohookKey.F6, 'F7': UiohookKey.F7, 'F8': UiohookKey.F8,
    'F9': UiohookKey.F9, 'F10': UiohookKey.F10, 'F11': UiohookKey.F11, 'F12': UiohookKey.F12,
    'F13': UiohookKey.F13, 'F14': UiohookKey.F14, 'F15': UiohookKey.F15, 'F16': UiohookKey.F16,
    'F17': UiohookKey.F17, 'F18': UiohookKey.F18, 'F19': UiohookKey.F19, 'F20': UiohookKey.F20,
    'F21': UiohookKey.F21, 'F22': UiohookKey.F22, 'F23': UiohookKey.F23, 'F24': UiohookKey.F24,
    // Navigation / special
    'Up': UiohookKey.ArrowUp, 'Down': UiohookKey.ArrowDown,
    'Left': UiohookKey.ArrowLeft, 'Right': UiohookKey.ArrowRight,
    'Return': UiohookKey.Enter, 'Esc': UiohookKey.Escape,
    'Backspace': UiohookKey.Backspace, 'Delete': UiohookKey.Delete,
    'Tab': UiohookKey.Tab, 'Space': UiohookKey.Space,
    'Home': UiohookKey.Home, 'End': UiohookKey.End,
    'PageUp': UiohookKey.PageUp, 'PageDown': UiohookKey.PageDown,
    'Insert': UiohookKey.Insert,
    // Punctuation
    '-': UiohookKey.Minus, '=': UiohookKey.Equal,
    '[': UiohookKey.BracketLeft, ']': UiohookKey.BracketRight,
    '\\': UiohookKey.Backslash, ';': UiohookKey.Semicolon,
    '\'': UiohookKey.Quote, ',': UiohookKey.Comma,
    '.': UiohookKey.Period, '/': UiohookKey.Slash,
    '`': UiohookKey.Backquote,
    // Numpad (NumLock ON keycodes)
    'Numpad0': UiohookKey.Numpad0, 'Numpad1': UiohookKey.Numpad1,
    'Numpad2': UiohookKey.Numpad2, 'Numpad3': UiohookKey.Numpad3,
    'Numpad4': UiohookKey.Numpad4, 'Numpad5': UiohookKey.Numpad5,
    'Numpad6': UiohookKey.Numpad6, 'Numpad7': UiohookKey.Numpad7,
    'Numpad8': UiohookKey.Numpad8, 'Numpad9': UiohookKey.Numpad9,
    'NumpadMultiply': UiohookKey.NumpadMultiply, 'NumpadAdd': UiohookKey.NumpadAdd,
    'NumpadSubtract': UiohookKey.NumpadSubtract, 'NumpadDecimal': UiohookKey.NumpadDecimal,
    'NumpadDivide': UiohookKey.NumpadDivide, 'NumpadEnter': UiohookKey.NumpadEnter,
};

// When NumLock is OFF, numpad keys report with 0xEE00 prefix keycodes.
const numpadAltKeycodes = {
    'Numpad0': UiohookKey.NumpadInsert,
    'Numpad1': UiohookKey.NumpadEnd,
    'Numpad2': UiohookKey.NumpadArrowDown,
    'Numpad3': UiohookKey.NumpadPageDown,
    'Numpad4': UiohookKey.NumpadArrowLeft,
    'Numpad5': 0xEE00 | UiohookKey.Numpad5, // No named key for Numpad5 without NumLock
    'Numpad6': UiohookKey.NumpadArrowRight,
    'Numpad7': UiohookKey.NumpadHome,
    'Numpad8': UiohookKey.NumpadArrowUp,
    'Numpad9': UiohookKey.NumpadPageUp,
    'NumpadDecimal': UiohookKey.NumpadDelete,
};

function parseAccelerator(accel) {
    if (!accel || accel.trim() === '') return null;

    const parts = accel.split('+');
    const modifiers = { ctrl: false, alt: false, shift: false, meta: false };
    let primaryKeycode = null;
    let altKeycode = null;
    let primaryKeyName = null;

    for (const part of parts) {
        const p = part.trim();
        if (p === 'Ctrl' || p === 'Control') {
            modifiers.ctrl = true;
        } else if (p === 'Alt') {
            modifiers.alt = true;
        } else if (p === 'Shift') {
            modifiers.shift = true;
        } else if (p === 'Win' || p === 'Meta') {
            modifiers.meta = true;
        } else {
            primaryKeycode = keyMap[p];
            primaryKeyName = p;
            if (primaryKeycode === undefined) {
                console.log('Unknown key in shortcut:', p);
                return null;
            }
        }
    }

    if (primaryKeycode === null) return null;

    // Add alternate keycode for numpad keys (NumLock OFF equivalents)
    if (primaryKeyName && numpadAltKeycodes[primaryKeyName] !== undefined) {
        altKeycode = numpadAltKeycodes[primaryKeyName];
    }

    return { modifiers, primaryKeycode, altKeycode };
}

// Reverse map: keycode -> accelerator key name
const reverseKeyMap = {};
for (const [name, code] of Object.entries(keyMap)) {
    reverseKeyMap[code] = name;
}

// Also map NumLock-OFF numpad keycodes to their NumLock-ON names
const numpadOffToName = {
    [UiohookKey.NumpadInsert]: 'Numpad0',
    [UiohookKey.NumpadEnd]: 'Numpad1',
    [UiohookKey.NumpadArrowDown]: 'Numpad2',
    [UiohookKey.NumpadPageDown]: 'Numpad3',
    [UiohookKey.NumpadArrowLeft]: 'Numpad4',
    [0xEE00 | UiohookKey.Numpad5]: 'Numpad5',
    [UiohookKey.NumpadArrowRight]: 'Numpad6',
    [UiohookKey.NumpadHome]: 'Numpad7',
    [UiohookKey.NumpadArrowUp]: 'Numpad8',
    [UiohookKey.NumpadPageUp]: 'Numpad9',
    [UiohookKey.NumpadDelete]: 'NumpadDecimal',
};

// Modifier keycodes to ignore when capturing
const modifierKeycodes = new Set([
    UiohookKey.Ctrl, UiohookKey.CtrlRight,
    UiohookKey.Alt, UiohookKey.AltRight,
    UiohookKey.Shift, UiohookKey.ShiftRight,
    UiohookKey.Meta, UiohookKey.MetaRight,
]);

let captureMode = false;

function startCapture() {
    captureMode = true;
}

function stopCapture() {
    captureMode = false;
}

function init(window) {
    uiWindow = window;

    if (!hookStarted) {
        uIOhook.on('keydown', onKeyDown);
        uIOhook.start();
        hookStarted = true;
    }
}

function stop() {
    if (hookStarted) {
        uIOhook.stop();
        hookStarted = false;
    }
}

const COOLDOWN_MS = 300;

function onKeyDown(e) {
    // Capture mode: send key combo to renderer for hotkey input fields
    if (captureMode) {
        if (modifierKeycodes.has(e.keycode)) return;

        const keyName = reverseKeyMap[e.keycode] || numpadOffToName[e.keycode];
        if (!keyName) return;

        const keys = [];
        if (e.ctrlKey) keys.push('Ctrl');
        if (e.altKey) keys.push('Alt');
        if (e.shiftKey) keys.push('Shift');
        if (e.metaKey) keys.push('Win');
        keys.push(keyName);

        const accel = keys.join('+');
        if (uiWindow) uiWindow.webContents.send('hotkey-captured', accel);
        return;
    }

    for (const shortcut of registeredShortcuts) {
        const keyMatches = e.keycode === shortcut.primaryKeycode ||
            (shortcut.altKeycode !== null && e.keycode === shortcut.altKeycode);
        if (!keyMatches) continue;
        if (e.ctrlKey !== shortcut.modifiers.ctrl) continue;
        if (e.altKey !== shortcut.modifiers.alt) continue;
        if (e.shiftKey !== shortcut.modifiers.shift) continue;
        if (e.metaKey !== shortcut.modifiers.meta) continue;

        const now = Date.now();
        if (now - shortcut.lastFired < COOLDOWN_MS) continue;
        shortcut.lastFired = now;

        shortcut.callback();
    }
}

function registerShortcuts() {
    registeredShortcuts = [];

    if (!appState.settings || !appState.settings.hotkeys) return;
    const k = appState.settings.hotkeys;

    const reg = (accel, callback) => {
        const parsed = parseAccelerator(accel);
        if (parsed) {
            registeredShortcuts.push({
                ...parsed,
                callback,
                lastFired: 0,
            });
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

module.exports = { init, stop, registerShortcuts, startCapture, stopCapture };
