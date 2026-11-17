use crate::config::Config;
use crate::shortcuts::ShortcutState;
use std::path::PathBuf;
use std::sync::Mutex;
use std::sync::atomic::AtomicBool;
use tauri::tray::TrayIcon;

pub struct AppState {
    pub config: Mutex<Config>,
    pub config_path: PathBuf,

    /// While custom audio plays, FE2's own volume is held at 0 and must not be touched.
    pub custom_audio_active: AtomicBool,
    pub force_reconnect: AtomicBool,
    pub user_disconnected: AtomicBool,
    pub is_quitting: AtomicBool,
    pub has_shown_minimize_alert: AtomicBool,
    pub polling_started: AtomicBool,

    /// Logical content size the UI was laid out at; drives zoom and aspect ratio.
    pub base_content_size: Mutex<(f64, f64)>,
    /// Last status sent to the UI ("show-login" / "connected" / ""), so a UI that
    /// loads after fe2.io can ask for it via `ui_ready`.
    pub connection_status: Mutex<String>,

    pub tray: Mutex<Option<TrayIcon>>,
    pub shortcuts: ShortcutState,
}

impl AppState {
    pub fn new(config: Config, config_path: PathBuf) -> Self {
        AppState {
            config: Mutex::new(config),
            config_path,
            custom_audio_active: AtomicBool::new(false),
            force_reconnect: AtomicBool::new(false),
            user_disconnected: AtomicBool::new(false),
            is_quitting: AtomicBool::new(false),
            has_shown_minimize_alert: AtomicBool::new(false),
            polling_started: AtomicBool::new(false),
            base_content_size: Mutex::new((400.0, 580.0)),
            connection_status: Mutex::new(String::new()),
            tray: Mutex::new(None),
            shortcuts: ShortcutState::default(),
        }
    }
}
