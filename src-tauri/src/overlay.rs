use crate::game_logic::{apply_volume_logic, click_option_logic, emit_ui, reload_fe2};
use crate::state::AppState;
use serde::Serialize;
use std::sync::atomic::{AtomicU8, AtomicU64, Ordering};
use std::time::Duration;
use tauri::{AppHandle, Manager, State, WebviewUrl, WebviewWindowBuilder};

pub const OVERLAY_LABEL: &str = "overlay";
const WIDTH: f64 = 580.0;
const HEIGHT: f64 = 120.0;
const TOAST_MS: u64 = 1800;
const CLOSE_ANIMATION_MS: u64 = 110;

const HIDDEN: u8 = 0;
const TOAST: u8 = 1;
const MENU: u8 = 2;

static MODE: AtomicU8 = AtomicU8::new(HIDDEN);
// Bumped on every show so a stale hide timer can tell it's been superseded.
static SHOW_TOKEN: AtomicU64 = AtomicU64::new(0);

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct OverlayState {
    volume: u8,
    on_death: String,
    on_leave: String,
    theme: String,
}

#[derive(Serialize, Clone)]
struct Toast {
    text: String,
    theme: String,
}

fn overlay_window(app: &AppHandle) -> Option<tauri::WebviewWindow> {
    app.get_webview_window(OVERLAY_LABEL)
}

fn base_theme(config: &crate::config::Config) -> String {
    let theme = &config.settings.theme;
    match theme.strip_prefix("custom:") {
        Some(id) => config
            .custom_themes
            .iter()
            .find(|t| t.id == id)
            .map(|t| t.base.clone())
            .unwrap_or_else(|| "fe2".into()),
        None => theme.clone(),
    }
}

pub fn snapshot(app: &AppHandle) -> OverlayState {
    let config = app.state::<AppState>().config.lock().unwrap().clone();
    OverlayState {
        volume: config.volume,
        theme: base_theme(&config),
        on_death: config.on_death,
        on_leave: config.on_leave,
    }
}

pub fn broadcast_state(app: &AppHandle) {
    emit_ui(app, "overlay-state", snapshot(app));
}

pub fn create(app: &AppHandle) -> tauri::Result<()> {
    let window = WebviewWindowBuilder::new(app, OVERLAY_LABEL, WebviewUrl::App("overlay.html".into()))
        .title("FE2CM Quick Menu")
        .inner_size(WIDTH, HEIGHT)
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .resizable(false)
        .focused(false)
        .visible(false)
        .build()?;
    platform::prepare(&window);

    let handle = app.clone();
    std::thread::spawn(move || platform::watch_top_edge(handle));
    Ok(())
}

fn hide_after(app: &AppHandle, token: u64, delay_ms: u64) {
    let app = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(delay_ms));
        if SHOW_TOKEN.load(Ordering::SeqCst) != token || MODE.load(Ordering::SeqCst) == MENU {
            return;
        }
        MODE.store(HIDDEN, Ordering::SeqCst);
        if let Some(w) = overlay_window(&app) {
            platform::hide(&w);
        }
    });
}

fn open_menu(app: &AppHandle) {
    MODE.store(MENU, Ordering::SeqCst);
    SHOW_TOKEN.fetch_add(1, Ordering::SeqCst);
    if let Some(w) = overlay_window(app) {
        let _ = w.set_ignore_cursor_events(false);
        platform::show_on_cursor_monitor(&w);
        emit_ui(app, "overlay-open", snapshot(app));
    }
}

fn close_menu(app: &AppHandle) {
    if MODE.swap(HIDDEN, Ordering::SeqCst) != MENU {
        return;
    }
    let token = SHOW_TOKEN.fetch_add(1, Ordering::SeqCst) + 1;
    emit_ui(app, "overlay-close", ());
    hide_after(app, token, CLOSE_ANIMATION_MS);
}

pub fn notify(app: &AppHandle, text: impl Into<String>) {
    let (enabled, theme) = {
        let state = app.state::<AppState>();
        let config = state.config.lock().unwrap();
        (config.settings.notifications, base_theme(&config))
    };
    // The open menu already shows the new values.
    if !enabled || MODE.load(Ordering::SeqCst) == MENU {
        return;
    }
    MODE.store(TOAST, Ordering::SeqCst);
    let token = SHOW_TOKEN.fetch_add(1, Ordering::SeqCst) + 1;
    if let Some(w) = overlay_window(app) {
        // Toasts must never block clicks in the game underneath.
        let _ = w.set_ignore_cursor_events(true);
        platform::show_on_cursor_monitor(&w);
        emit_ui(app, "overlay-toast", Toast { text: text.into(), theme });
    }
    hide_after(app, token, TOAST_MS);
}

pub fn volume_text(volume: u8) -> String {
    if volume == 0 { "Muted".into() } else { format!("Volume {volume}%") }
}

// --- Commands used by the quick menu ---

#[tauri::command]
pub fn get_overlay_state(app: AppHandle) -> OverlayState {
    snapshot(&app)
}

#[tauri::command]
pub fn quick_set_volume(app: AppHandle, value: u8) {
    let value = value.min(100);
    apply_volume_logic(&app, value);
    emit_ui(&app, "update-volume", value);
}

#[tauri::command]
pub fn quick_click_option(app: AppHandle, group: String, value: String) {
    click_option_logic(&app, &group, &value);
    let config = app.state::<AppState>().config.lock().unwrap().clone();
    emit_ui(&app, "restore-state", config);
}

#[tauri::command]
pub fn quick_toggle_mute(app: AppHandle) {
    emit_ui(&app, "toggle-mute", ());
}

#[tauri::command]
pub fn quick_refresh(app: AppHandle, state: State<AppState>) {
    state.force_reconnect.store(true, Ordering::SeqCst);
    emit_ui(&app, "start-loading", ());
    reload_fe2(&app);
}

#[tauri::command]
pub fn show_notification(app: AppHandle, text: String) {
    notify(&app, text);
}

#[cfg(windows)]
mod platform {
    use super::{close_menu, open_menu, MENU, MODE};
    use crate::state::AppState;
    use std::sync::atomic::Ordering;
    use std::time::{Duration, Instant};
    use tauri::{AppHandle, Manager};
    use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, POINT, RECT, WPARAM};
    use windows::Win32::Graphics::Gdi::{GetMonitorInfoW, MONITORINFO, MONITOR_DEFAULTTONEAREST, MonitorFromPoint};
    use windows::Win32::UI::Input::KeyboardAndMouse::{GetAsyncKeyState, VK_LBUTTON};
    use windows::Win32::UI::Shell::{DefSubclassProc, SetWindowSubclass};
    use windows::Win32::UI::WindowsAndMessaging::{
        GWL_EXSTYLE, GetCursorPos, GetWindowLongPtrW, GetWindowRect, HWND_TOPMOST, MA_NOACTIVATE,
        SW_HIDE, SWP_NOACTIVATE, SWP_NOSIZE, SWP_SHOWWINDOW, SetWindowLongPtrW, SetWindowPos,
        ShowWindow, WM_MOUSEACTIVATE, WS_EX_NOACTIVATE, WS_EX_TOOLWINDOW,
    };

    const POLL: Duration = Duration::from_millis(10);
    const CLOSE_DELAY: Duration = Duration::from_millis(60);
    const LEAVE_MARGIN: i32 = 4;

    fn hwnd_of(window: &tauri::WebviewWindow) -> Option<HWND> {
        window.hwnd().ok().map(|h| HWND(h.0 as _))
    }

    pub fn prepare(window: &tauri::WebviewWindow) {
        let Some(hwnd) = hwnd_of(window) else { return };
        unsafe {
            // Clicking the menu must not pull focus away from Roblox.
            let ex = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
            SetWindowLongPtrW(hwnd, GWL_EXSTYLE, ex | (WS_EX_NOACTIVATE.0 | WS_EX_TOOLWINDOW.0) as isize);
            let _ = SetWindowSubclass(hwnd, Some(no_activate_proc), 0xF2C0, 0);
        }
    }

    // WebView2's child window can still activate the top-level window on click without this.
    unsafe extern "system" fn no_activate_proc(
        hwnd: HWND,
        msg: u32,
        wparam: WPARAM,
        lparam: LPARAM,
        _id: usize,
        _data: usize,
    ) -> LRESULT {
        if msg == WM_MOUSEACTIVATE {
            return LRESULT(MA_NOACTIVATE as isize);
        }
        unsafe { DefSubclassProc(hwnd, msg, wparam, lparam) }
    }

    fn cursor() -> Option<POINT> {
        let mut pt = POINT::default();
        unsafe { GetCursorPos(&mut pt).ok().map(|_| pt) }
    }

    fn monitor_rect(pt: POINT) -> Option<RECT> {
        unsafe {
            let monitor = MonitorFromPoint(pt, MONITOR_DEFAULTTONEAREST);
            let mut info = MONITORINFO { cbSize: size_of::<MONITORINFO>() as u32, ..Default::default() };
            GetMonitorInfoW(monitor, &mut info).as_bool().then_some(info.rcMonitor)
        }
    }

    fn window_rect(hwnd: HWND) -> Option<RECT> {
        let mut rect = RECT::default();
        unsafe { GetWindowRect(hwnd, &mut rect).ok().map(|_| rect) }
    }

    fn left_button_down() -> bool {
        unsafe { (GetAsyncKeyState(VK_LBUTTON.0 as i32) as u16 & 0x8000) != 0 }
    }

    pub fn show_on_cursor_monitor(window: &tauri::WebviewWindow) {
        let Some(hwnd) = hwnd_of(window) else { return };
        let Some(monitor) = cursor().and_then(monitor_rect) else { return };
        // Positioned twice because moving to a monitor with another DPI resizes the window.
        for _ in 0..2 {
            let Some(rect) = window_rect(hwnd) else { return };
            let width = rect.right - rect.left;
            let x = monitor.left + (monitor.right - monitor.left - width) / 2;
            unsafe {
                let _ = SetWindowPos(hwnd, Some(HWND_TOPMOST), x, monitor.top, 0, 0, SWP_NOSIZE | SWP_NOACTIVATE | SWP_SHOWWINDOW);
            }
        }
    }

    pub fn hide(window: &tauri::WebviewWindow) {
        if let Some(hwnd) = hwnd_of(window) {
            unsafe {
                let _ = ShowWindow(hwnd, SW_HIDE);
            }
        }
    }

    pub fn watch_top_edge(app: AppHandle) {
        let mut away_since: Option<Instant> = None;

        loop {
            std::thread::sleep(POLL);
            let enabled = app.state::<AppState>().config.lock().unwrap().settings.quick_bar;
            let menu_open = MODE.load(Ordering::SeqCst) == MENU;
            if !enabled {
                if menu_open {
                    close_menu(&app);
                }
                std::thread::sleep(Duration::from_millis(300));
                continue;
            }
            let (Some(pt), Some(window)) = (cursor(), app.get_webview_window(super::OVERLAY_LABEL)) else {
                continue;
            };
            let Some(hwnd) = hwnd_of(&window) else { continue };

            if !menu_open {
                let (Some(monitor), Some(rect)) = (monitor_rect(pt), window_rect(hwnd)) else { continue };
                let half_width = (rect.right - rect.left) / 2;
                let center = (monitor.left + monitor.right) / 2;
                let on_edge = pt.y <= monitor.top + 1 && (pt.x - center).abs() <= half_width;
                // Ignore drags (e.g. moving a window) that pass over the edge.
                if on_edge && !left_button_down() {
                    away_since = None;
                    open_menu(&app);
                }
            } else {
                let Some(rect) = window_rect(hwnd) else { continue };
                let inside = pt.x >= rect.left - LEAVE_MARGIN
                    && pt.x <= rect.right + LEAVE_MARGIN
                    && pt.y >= rect.top - LEAVE_MARGIN
                    && pt.y <= rect.bottom + LEAVE_MARGIN;
                // Keep it open while the volume slider is being dragged outside the menu.
                if inside || left_button_down() {
                    away_since = None;
                } else if away_since.get_or_insert_with(Instant::now).elapsed() >= CLOSE_DELAY {
                    away_since = None;
                    close_menu(&app);
                }
            }
        }
    }
}

#[cfg(not(windows))]
mod platform {
    use tauri::AppHandle;
    pub fn prepare(_window: &tauri::WebviewWindow) {}
    pub fn show_on_cursor_monitor(window: &tauri::WebviewWindow) {
        let _ = window.show();
    }
    pub fn hide(window: &tauri::WebviewWindow) {
        let _ = window.hide();
    }
    pub fn watch_top_edge(_app: AppHandle) {}
}
