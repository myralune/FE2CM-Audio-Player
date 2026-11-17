use crate::state::AppState;
use crate::tray;
use std::sync::atomic::Ordering;
use tauri::{AppHandle, Emitter, Manager, WebviewWindow};

pub const FE2_LABEL: &str = "fe2";
pub const MAIN_LABEL: &str = "main";

pub fn fe2_window(app: &AppHandle) -> Option<WebviewWindow> {
    app.get_webview_window(FE2_LABEL)
}

pub fn main_window(app: &AppHandle) -> Option<WebviewWindow> {
    app.get_webview_window(MAIN_LABEL)
}

// Emitted globally because JS `listen()` without a target ignores label-targeted events.
pub fn emit_ui<S: serde::Serialize + Clone>(app: &AppHandle, event: &str, payload: S) {
    let _ = app.emit(event, payload);
}

pub fn set_connection_status(app: &AppHandle, status: &str) {
    *app.state::<AppState>().connection_status.lock().unwrap() = status.to_string();
    emit_ui(app, "connection-status", status.to_string());
}

pub fn save_config(app: &AppHandle) {
    let state = app.state::<AppState>();
    let config = state.config.lock().unwrap();
    if let Err(e) = config.save(&state.config_path) {
        log::warn!("failed to save config: {e}");
    }
}

fn run_safe(app: &AppHandle, js: &str) {
    if let Some(w) = fe2_window(app) {
        if let Err(e) = w.eval(format!("try {{ {js} }} catch (e) {{}}")) {
            log::debug!("fe2 eval ignored error: {e}");
        }
    }
}

pub fn connect_user_logic(app: &AppHandle, username: &str) {
    {
        let state = app.state::<AppState>();
        state.config.lock().unwrap().username = username.to_string();
    }
    save_config(app);

    let name_js = serde_json::to_string(username).unwrap_or_else(|_| "\"\"".into());
    run_safe(
        app,
        &format!(
            r#"const input = document.querySelector('input[type="text"]');
            if (input) {{
                input.value = {name_js};
                input.dispatchEvent(new Event('input', {{ bubbles: true }}));
                const b = Array.from(document.querySelectorAll('button'))
                    .find(x => x.innerText.includes('Connect'));
                if (b) b.click();
            }}"#
        ),
    );
}

pub fn apply_volume_logic(app: &AppHandle, val: u8) {
    let val = val.min(100);
    let state = app.state::<AppState>();
    {
        let mut config = state.config.lock().unwrap();
        config.volume = val;
        if val > 0 {
            config.previous_volume = val;
        }
    }
    save_config(app);

    // Don't touch FE2's volume when custom audio is active - it's held at 0.
    if !state.custom_audio_active.load(Ordering::Relaxed) {
        set_site_volume(app, val);
    }
    crate::overlay::broadcast_state(app);
}

pub fn set_site_volume(app: &AppHandle, val: u8) {
    run_safe(
        app,
        &format!(
            r#"const s = document.getElementById('volumeRange');
            if (s) {{ s.value = {val};
                s.dispatchEvent(new Event('input', {{ bubbles: true }}));
                s.dispatchEvent(new Event('change', {{ bubbles: true }})); }}"#
        ),
    );
}

fn radio_id(group: &str, val: &str) -> Option<&'static str> {
    match (group, val) {
        ("onDeath", "Quieten BGM") => Some("deathQuietenRadio"),
        ("onDeath", "Stop BGM") => Some("deathStopRadio"),
        ("onDeath", "Disable") => Some("deathDisableRadio"),
        ("onLeave", "Stop BGM") => Some("leaveStopRadio"),
        ("onLeave", "Disable") => Some("leaveDisableRadio"),
        _ => None,
    }
}

pub fn click_option_logic(app: &AppHandle, group: &str, val: &str) {
    {
        let state = app.state::<AppState>();
        let mut config = state.config.lock().unwrap();
        match group {
            "onDeath" => config.on_death = val.to_string(),
            "onLeave" => config.on_leave = val.to_string(),
            _ => {}
        }
    }
    save_config(app);
    tray::update_menu(app);
    crate::overlay::broadcast_state(app);

    if let Some(id) = radio_id(group, val) {
        run_safe(
            app,
            &format!("const el = document.getElementById('{id}'); if (el) el.click();"),
        );
    }
}

pub fn reload_fe2(app: &AppHandle) {
    if let Some(w) = fe2_window(app) {
        let _ = w.reload();
    }
}

pub fn set_site_mute(app: &AppHandle, mute: bool) {
    let Some(w) = fe2_window(app) else { return };
    #[cfg(windows)]
    crate::webview::set_muted(&w, mute);
    #[cfg(not(windows))]
    {
        let _ = w.eval(format!(
            "document.querySelectorAll('audio,video').forEach(e => e.muted = {mute});"
        ));
    }
}

const POLL_SCRIPT: &str = "(function(){ const l = document.getElementById('bgmInfo'); return l ? l.textContent : ''; })()";

pub fn start_audio_polling(app: &AppHandle) {
    let state = app.state::<AppState>();
    if state.polling_started.swap(true, Ordering::SeqCst) {
        return;
    }
    let app = app.clone();
    std::thread::spawn(move || {
        loop {
            std::thread::sleep(std::time::Duration::from_millis(500));
            let Some(w) = fe2_window(&app) else { continue };
            let app2 = app.clone();
            crate::webview::eval_with_result(&w, POLL_SCRIPT, move |json| {
                if let Ok(text) = serde_json::from_str::<String>(&json) {
                    emit_ui(&app2, "game-audio-state", text);
                }
            });
        }
    });
}

// Runs on every fe2.io load, including refreshes and disconnects.
pub fn on_fe2_loaded(app: &AppHandle) {
    let state = app.state::<AppState>();
    let config = state.config.lock().unwrap().clone();
    emit_ui(app, "restore-state", config.clone());

    start_audio_polling(app);

    let should_connect = !config.username.is_empty()
        && (config.settings.auto_connect || state.force_reconnect.load(Ordering::SeqCst))
        && !state.user_disconnected.load(Ordering::SeqCst);

    if should_connect {
        log::info!("Connecting with saved username");
        emit_ui(app, "start-loading", ());
        connect_user_logic(app, &config.username);

        let app = app.clone();
        std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_millis(50));
            apply_volume_logic(&app, config.volume);
            click_option_logic(&app, "onDeath", &config.on_death);
            click_option_logic(&app, "onLeave", &config.on_leave);
            set_connection_status(&app, "connected");
            app.state::<AppState>()
                .force_reconnect
                .store(false, Ordering::SeqCst);
        });
    } else {
        log::info!("Showing login screen");
        set_connection_status(app, "show-login");
    }
}
