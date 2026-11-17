use crate::config::{Config, Settings};
use crate::game_logic::{self, main_window, set_connection_status};
use crate::shortcuts;
use crate::state::AppState;
use std::sync::atomic::Ordering;
use tauri::{AppHandle, LogicalSize, State};

// --- Window ---

#[tauri::command]
pub fn app_close(window: tauri::WebviewWindow) {
    let _ = window.close();
}

#[tauri::command]
pub fn app_minimize(window: tauri::WebviewWindow) {
    let _ = window.minimize();
}

#[tauri::command]
pub fn fit_window(app: AppHandle, state: State<AppState>, width: f64, height: f64) {
    if width < 1.0 || height < 1.0 {
        return;
    }
    *state.base_content_size.lock().unwrap() = (width, height);
    crate::aspect::set_ratio(width, height);
    if let Some(w) = main_window(&app) {
        crate::aspect::apply_min_size(&w, width, height);
        // Keeping the current width preserves the user's zoom level.
        let scale = w.scale_factor().unwrap_or(1.0);
        let current_width = w
            .inner_size()
            .map(|s| s.width as f64 / scale)
            .unwrap_or(width);
        let new_width = if current_width >= 1.0 { current_width } else { width };
        let new_height = new_width * height / width;
        let _ = w.set_size(LogicalSize::new(new_width.round(), new_height.round()));
    }
}

// --- Config / state ---

#[tauri::command]
pub fn get_config(state: State<AppState>) -> Config {
    state.config.lock().unwrap().clone()
}

// fe2.io can finish loading before the UI starts listening, so the UI asks on startup.
#[tauri::command]
pub fn ui_ready(state: State<AppState>) -> String {
    state.connection_status.lock().unwrap().clone()
}

#[tauri::command]
pub fn save_advanced_settings(
    app: AppHandle,
    state: State<AppState>,
    settings: Settings,
) -> Result<(), String> {
    let always_on_top = settings.always_on_top;
    let (result, theme_changed) = {
        let mut config = state.config.lock().unwrap();
        let theme_changed = config.settings.theme != settings.theme;
        config.settings = settings;
        (config.save(&state.config_path), theme_changed)
    };
    if theme_changed {
        crate::tray::update_menu(&app);
    }
    if let Some(w) = main_window(&app) {
        let _ = w.set_always_on_top(always_on_top);
    }
    shortcuts::register(&app);
    result
}

// --- Connection ---

#[tauri::command]
pub fn connect_user(app: AppHandle, state: State<AppState>, username: String) {
    state.user_disconnected.store(false, Ordering::SeqCst);
    game_logic::connect_user_logic(&app, &username);
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(50));
        set_connection_status(&app, "connected");
    });
}

#[tauri::command]
pub fn disconnect_game(app: AppHandle, state: State<AppState>) {
    state.user_disconnected.store(true, Ordering::SeqCst);
    game_logic::save_config(&app);
    game_logic::reload_fe2(&app);
}

#[tauri::command]
pub fn refresh_fe2(app: AppHandle, state: State<AppState>) {
    state.force_reconnect.store(true, Ordering::SeqCst);
    game_logic::reload_fe2(&app);
}

// --- Audio ---

#[tauri::command]
pub fn set_volume(app: AppHandle, value: u8) {
    game_logic::apply_volume_logic(&app, value);
}

#[tauri::command]
pub fn click_option(app: AppHandle, group: String, value: String) {
    game_logic::click_option_logic(&app, &group, &value);
}

#[tauri::command]
pub fn set_custom_audio_active(state: State<AppState>, active: bool) {
    state.custom_audio_active.store(active, Ordering::Relaxed);
}

#[tauri::command]
pub fn set_site_mute(app: AppHandle, mute: bool) {
    game_logic::set_site_mute(&app, mute);
}

#[tauri::command]
pub fn set_site_volume(app: AppHandle, value: u8) {
    game_logic::set_site_volume(&app, value.min(100));
}

// --- Hotkey capture ---

#[tauri::command]
pub fn start_hotkey_capture(state: State<AppState>) {
    state.shortcuts.capture.store(true, Ordering::SeqCst);
}

#[tauri::command]
pub fn stop_hotkey_capture(state: State<AppState>) {
    state.shortcuts.capture.store(false, Ordering::SeqCst);
}
