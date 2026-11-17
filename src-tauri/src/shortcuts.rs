use crate::game_logic::{apply_volume_logic, emit_ui};
use crate::state::AppState;
use std::collections::HashSet;
use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{AppHandle, Manager};

#[derive(Clone, Copy, Debug)]
pub struct KeyEvent {
    pub vk: u32,
    pub extended: bool,
    pub down: bool,
    pub ctrl: bool,
    pub alt: bool,
    pub shift: bool,
    pub meta: bool,
}

#[derive(Clone, Copy, Debug, PartialEq)]
enum Action {
    Mute,
    VolUp,
    VolDown,
}

struct Shortcut {
    ctrl: bool,
    alt: bool,
    shift: bool,
    meta: bool,
    key: String,
    action: Action,
}

#[derive(Default)]
pub struct ShortcutState {
    // When set, the next non-modifier key press is sent to the UI instead of acting.
    pub capture: AtomicBool,
    list: Mutex<Vec<Shortcut>>,
    held: Mutex<HashSet<(u32, bool)>>,
}

pub fn key_name(vk: u32, extended: bool) -> Option<String> {
    let named = |s: &str| Some(s.to_string());
    match vk {
        0x41..=0x5A | 0x30..=0x39 => Some((vk as u8 as char).to_string()),
        0x70..=0x87 => Some(format!("F{}", vk - 0x70 + 1)),
        0x60..=0x69 => Some(format!("Numpad{}", vk - 0x60)),
        0x6A => named("NumpadMultiply"),
        0x6B => named("NumpadAdd"),
        0x6D => named("NumpadSubtract"),
        0x6E => named("NumpadDecimal"),
        0x6F => named("NumpadDivide"),
        // Numpad keys with NumLock off arrive as these same keys, just without the extended flag.
        0x26 => named(if extended { "Up" } else { "Numpad8" }),
        0x28 => named(if extended { "Down" } else { "Numpad2" }),
        0x25 => named(if extended { "Left" } else { "Numpad4" }),
        0x27 => named(if extended { "Right" } else { "Numpad6" }),
        0x24 => named(if extended { "Home" } else { "Numpad7" }),
        0x23 => named(if extended { "End" } else { "Numpad1" }),
        0x21 => named(if extended { "PageUp" } else { "Numpad9" }),
        0x22 => named(if extended { "PageDown" } else { "Numpad3" }),
        0x2D => named(if extended { "Insert" } else { "Numpad0" }),
        0x2E => named(if extended { "Delete" } else { "NumpadDecimal" }),
        0x0C => named("Numpad5"), // Numpad5 with NumLock off
        0x0D => named(if extended { "NumpadEnter" } else { "Return" }),
        0x1B => named("Esc"),
        0x08 => named("Backspace"),
        0x09 => named("Tab"),
        0x20 => named("Space"),
        0xBD => named("-"),
        0xBB => named("="),
        0xDB => named("["),
        0xDD => named("]"),
        0xDC => named("\\"),
        0xBA => named(";"),
        0xDE => named("'"),
        0xBC => named(","),
        0xBE => named("."),
        0xBF => named("/"),
        0xC0 => named("`"),
        _ => None,
    }
}

fn is_modifier_vk(vk: u32) -> bool {
    matches!(vk, 0x10 | 0x11 | 0x12 | 0xA0..=0xA5 | 0x5B | 0x5C)
}

fn parse_accelerator(accel: &str) -> Option<(bool, bool, bool, bool, String)> {
    if accel.trim().is_empty() {
        return None;
    }
    let (mut ctrl, mut alt, mut shift, mut meta) = (false, false, false, false);
    let mut key = None;
    for part in accel.split('+') {
        match part.trim() {
            "Ctrl" | "Control" => ctrl = true,
            "Alt" => alt = true,
            "Shift" => shift = true,
            "Win" | "Meta" => meta = true,
            other => key = Some(other.to_string()),
        }
    }
    Some((ctrl, alt, shift, meta, key?))
}

impl ShortcutState {
    fn replace(&self, shortcuts: Vec<Shortcut>) {
        *self.list.lock().unwrap() = shortcuts;
    }

    fn matches(&self, ev: &KeyEvent) -> Vec<Action> {
        let key_id = (ev.vk, ev.extended);
        let is_repeat = {
            let mut held = self.held.lock().unwrap();
            if !ev.down {
                held.remove(&key_id);
                return vec![];
            }
            !held.insert(key_id)
        };
        let Some(name) = key_name(ev.vk, ev.extended) else {
            return vec![];
        };
        let mut fired = vec![];
        for s in self.list.lock().unwrap().iter() {
            if s.key != name
                || s.ctrl != ev.ctrl
                || s.alt != ev.alt
                || s.shift != ev.shift
                || s.meta != ev.meta
            {
                continue;
            }
            // Holding volume keys keeps stepping, but holding mute must not keep toggling.
            if is_repeat && s.action == Action::Mute {
                continue;
            }
            fired.push(s.action);
        }
        fired
    }
}

pub fn register(app: &AppHandle) {
    let state = app.state::<AppState>();
    let hotkeys = state.config.lock().unwrap().settings.hotkeys.clone();

    let mut list = vec![];
    for (accel, action) in [
        (&hotkeys.mute, Action::Mute),
        (&hotkeys.vol_up, Action::VolUp),
        (&hotkeys.vol_down, Action::VolDown),
    ] {
        if let Some((ctrl, alt, shift, meta, key)) = parse_accelerator(accel) {
            list.push(Shortcut {
                ctrl,
                alt,
                shift,
                meta,
                key,
                action,
            });
        }
    }
    state.shortcuts.replace(list);
}

fn run_action(app: &AppHandle, action: Action) {
    match action {
        Action::Mute => emit_ui(app, "toggle-mute", ()),
        Action::VolUp | Action::VolDown => {
            let current = app.state::<AppState>().config.lock().unwrap().volume as i32;
            let new = if action == Action::VolUp {
                (current + 10).min(100)
            } else {
                (current - 10).max(0)
            } as u8;
            apply_volume_logic(app, new);
            emit_ui(app, "update-volume", new);
            crate::overlay::notify(app, crate::overlay::volume_text(new));
        }
    }
}

fn handle_event(app: &AppHandle, ev: KeyEvent) {
    let state = app.state::<AppState>();

    if state.shortcuts.capture.load(Ordering::SeqCst) {
        if !ev.down || is_modifier_vk(ev.vk) {
            return;
        }
        let Some(name) = key_name(ev.vk, ev.extended) else {
            return;
        };
        let mut keys = vec![];
        if ev.ctrl {
            keys.push("Ctrl".to_string());
        }
        if ev.alt {
            keys.push("Alt".to_string());
        }
        if ev.shift {
            keys.push("Shift".to_string());
        }
        if ev.meta {
            keys.push("Win".to_string());
        }
        keys.push(name);
        emit_ui(app, "hotkey-captured", keys.join("+"));
        return;
    }

    for action in state.shortcuts.matches(&ev) {
        run_action(app, action);
    }
}

pub fn start(app: &AppHandle) {
    register(app);

    let (tx, rx) = std::sync::mpsc::channel::<KeyEvent>();
    let app = app.clone();
    std::thread::spawn(move || {
        for ev in rx {
            handle_event(&app, ev);
        }
    });

    #[cfg(windows)]
    hook::start(tx);
    #[cfg(not(windows))]
    drop(tx);
}

#[cfg(windows)]
mod hook {
    // Raw Input instead of a low-level hook, which has callback timeouts and adds input latency.
    use super::KeyEvent;
    use std::sync::OnceLock;
    use std::sync::mpsc::Sender;
    use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, WPARAM};
    use windows::Win32::System::LibraryLoader::GetModuleHandleW;
    use windows::Win32::UI::Input::KeyboardAndMouse::{
        GetAsyncKeyState, VK_CONTROL, VK_LWIN, VK_MENU, VK_RWIN, VK_SHIFT,
    };
    use windows::Win32::UI::Input::{
        GetRawInputData, HRAWINPUT, RAWINPUT, RAWINPUTDEVICE, RAWINPUTHEADER, RID_INPUT,
        RIDEV_INPUTSINK, RIM_TYPEKEYBOARD, RegisterRawInputDevices,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        CreateWindowExW, DefWindowProcW, DispatchMessageW, GetMessageW, HWND_MESSAGE, MSG,
        RegisterClassW, TranslateMessage, WINDOW_EX_STYLE, WINDOW_STYLE, WM_INPUT, WNDCLASSW,
    };
    use windows::core::w;

    static SENDER: OnceLock<Sender<KeyEvent>> = OnceLock::new();

    const RI_KEY_BREAK: u16 = 0x01;
    const RI_KEY_E0: u16 = 0x02;

    fn is_down(vk: u16) -> bool {
        unsafe { (GetAsyncKeyState(vk as i32) as u16) & 0x8000 != 0 }
    }

    fn read_key(lparam: LPARAM) -> Option<KeyEvent> {
        unsafe {
            let handle = HRAWINPUT(lparam.0 as _);
            let mut size = 0u32;
            let header = size_of::<RAWINPUTHEADER>() as u32;
            GetRawInputData(handle, RID_INPUT, None, &mut size, header);
            if size == 0 {
                return None;
            }
            // RAWINPUT is 8-byte aligned; back the buffer with u64s.
            let mut buf = vec![0u64; (size as usize).div_ceil(8)];
            let read = GetRawInputData(
                handle,
                RID_INPUT,
                Some(buf.as_mut_ptr().cast()),
                &mut size,
                header,
            );
            if read == u32::MAX {
                return None;
            }
            let raw = &*(buf.as_ptr() as *const RAWINPUT);
            if raw.header.dwType != RIM_TYPEKEYBOARD.0 {
                return None;
            }
            let kb = raw.data.keyboard;
            Some(KeyEvent {
                vk: kb.VKey as u32,
                extended: kb.Flags & RI_KEY_E0 != 0,
                down: kb.Flags & RI_KEY_BREAK == 0,
                ctrl: is_down(VK_CONTROL.0),
                alt: is_down(VK_MENU.0),
                shift: is_down(VK_SHIFT.0),
                meta: is_down(VK_LWIN.0) || is_down(VK_RWIN.0),
            })
        }
    }

    unsafe extern "system" fn wndproc(
        hwnd: HWND,
        msg: u32,
        wparam: WPARAM,
        lparam: LPARAM,
    ) -> LRESULT {
        if msg == WM_INPUT {
            if let (Some(tx), Some(ev)) = (SENDER.get(), read_key(lparam)) {
                let _ = tx.send(ev);
            }
        }
        unsafe { DefWindowProcW(hwnd, msg, wparam, lparam) }
    }

    pub fn start(tx: Sender<KeyEvent>) {
        if SENDER.set(tx).is_err() {
            return;
        }
        std::thread::spawn(|| unsafe {
            let Ok(module) = GetModuleHandleW(None) else {
                return;
            };
            let class = WNDCLASSW {
                lpfnWndProc: Some(wndproc),
                hInstance: module.into(),
                lpszClassName: w!("FE2CMHotkeyWindow"),
                ..Default::default()
            };
            RegisterClassW(&class);
            let hwnd = match CreateWindowExW(
                WINDOW_EX_STYLE(0),
                class.lpszClassName,
                w!(""),
                WINDOW_STYLE(0),
                0,
                0,
                0,
                0,
                Some(HWND_MESSAGE),
                None,
                Some(module.into()),
                None,
            ) {
                Ok(h) => h,
                Err(e) => {
                    log::error!("hotkey window creation failed: {e}");
                    return;
                }
            };
            let device = RAWINPUTDEVICE {
                usUsagePage: 0x01, // generic desktop
                usUsage: 0x06,     // keyboard
                dwFlags: RIDEV_INPUTSINK, // receive input even when not focused
                hwndTarget: hwnd,
            };
            if let Err(e) = RegisterRawInputDevices(&[device], size_of::<RAWINPUTDEVICE>() as u32) {
                log::error!("raw input registration failed: {e}");
                return;
            }
            let mut msg = MSG::default();
            while GetMessageW(&mut msg, None, 0, 0).0 > 0 {
                let _ = TranslateMessage(&msg);
                DispatchMessageW(&msg);
            }
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ev(vk: u32, extended: bool, ctrl: bool) -> KeyEvent {
        KeyEvent {
            vk,
            extended,
            down: true,
            ctrl,
            alt: false,
            shift: false,
            meta: false,
        }
    }

    fn shortcut(accel: &str, action: Action) -> Shortcut {
        let (ctrl, alt, shift, meta, key) = parse_accelerator(accel).unwrap();
        Shortcut {
            ctrl,
            alt,
            shift,
            meta,
            key,
            action,
        }
    }

    #[test]
    fn parses_accelerators() {
        assert!(parse_accelerator("").is_none());
        assert!(parse_accelerator("Ctrl+Shift").is_none());
        let (c, a, s, m, k) = parse_accelerator("Ctrl+Alt+M").unwrap();
        assert!(c && a && !s && !m);
        assert_eq!(k, "M");
    }

    #[test]
    fn names_keys() {
        assert_eq!(key_name(0x4D, false).unwrap(), "M");
        assert_eq!(key_name(0x70, false).unwrap(), "F1");
        assert_eq!(key_name(0x26, true).unwrap(), "Up");
        // NumLock off: numpad 8 arrives as non-extended VK_UP
        assert_eq!(key_name(0x26, false).unwrap(), "Numpad8");
        assert_eq!(key_name(0x68, false).unwrap(), "Numpad8");
        assert_eq!(key_name(0x0D, true).unwrap(), "NumpadEnter");
        assert!(key_name(0xFF, false).is_none());
    }

    #[test]
    fn matches_rapid_presses_and_ignores_held_mute() {
        let state = ShortcutState::default();
        state.replace(vec![
            shortcut("Ctrl+M", Action::Mute),
            shortcut("Numpad8", Action::VolUp),
        ]);
        let up = |vk, ctrl| KeyEvent { down: false, ..ev(vk, false, ctrl) };

        assert!(state.matches(&ev(0x4D, false, false)).is_empty());
        state.matches(&up(0x4D, false));

        assert_eq!(state.matches(&ev(0x4D, false, true)), vec![Action::Mute]);
        assert!(state.matches(&ev(0x4D, false, true)).is_empty());
        state.matches(&up(0x4D, true));
        assert_eq!(state.matches(&ev(0x4D, false, true)), vec![Action::Mute]);

        assert_eq!(state.matches(&ev(0x68, false, false)), vec![Action::VolUp]);
        assert_eq!(state.matches(&ev(0x68, false, false)), vec![Action::VolUp]);
        // Numpad8 with NumLock off arrives as a non-extended VK_UP.
        assert_eq!(state.matches(&ev(0x26, false, false)), vec![Action::VolUp]);
    }
}
