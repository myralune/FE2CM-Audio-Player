use crate::config::Config;
use crate::state::AppState;
use log::LevelFilter;
use serde::Serialize;
use std::sync::Mutex;
use tauri::{AppHandle, Manager};
use tauri_plugin_log::{RotationStrategy, Target, TargetKind, TimezoneStrategy};

pub const ENABLED: bool = cfg!(feature = "diagnostics");
const LOG_FILE: &str = "fe2cm-debug";

// Reported so testers' files show what fe2.io itself was doing between snapshots.
pub const INIT_SCRIPT: &str = r#"(() => {
  if (window.top !== window || window.__fe2cmDiag) return;
  const D = window.__fe2cmDiag = { media: new Set(), events: [] };
  const push = (type, msg) => {
    D.events.push({ type, msg: String(msg).slice(0, 500) });
    if (D.events.length > 200) D.events.shift();
  };
  const track = (el) => {
    if (D.media.has(el)) return;
    D.media.add(el);
    if (D.media.size > 5) D.media.delete(D.media.values().next().value);
    el.addEventListener('error', () => push('media-error', (el.error && (el.error.code + ' ' + el.error.message)) + ' src=' + (el.currentSrc || el.src)));
  };
  const origPlay = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function () {
    track(this);
    const p = origPlay.apply(this, arguments);
    if (p && p.catch) p.catch((e) => push('play-rejected', (e && e.name) + ': ' + (e && e.message)));
    return p;
  };
  window.addEventListener('error', (e) => push('error', e.message + ' @' + e.filename + ':' + e.lineno));
  window.addEventListener('unhandledrejection', (e) => push('unhandledrejection', e.reason && (e.reason.stack || e.reason)));
  for (const level of ['error', 'warn']) {
    const orig = console[level];
    console[level] = function (...args) { push('console.' + level, args.join(' ')); return orig.apply(this, args); };
  }
})();"#;

const SNAPSHOT_SCRIPT: &str = r#"(() => {
  const D = window.__fe2cmDiag;
  const r = document.getElementById('volumeRange');
  const b = document.getElementById('bgmInfo');
  const media = new Set([...(D ? D.media : []), ...document.querySelectorAll('audio,video')]);
  return JSON.stringify({
    url: location.href,
    visibility: document.visibilityState,
    volumeRange: r ? r.value : null,
    bgmInfo: b ? b.textContent : null,
    media: [...media].map((m) => ({
      src: (m.currentSrc || m.src || '').split('/').pop().slice(0, 80),
      paused: m.paused, muted: m.muted, volume: Math.round(m.volume * 100),
      readyState: m.readyState, networkState: m.networkState,
      error: m.error ? m.error.code + ' ' + m.error.message : null,
    })),
    hooked: !!D,
    errorPage: location.protocol === 'chrome-error:'
      ? (document.title + ' | ' + (document.body ? document.body.innerText : '')).replace(/\s+/g, ' ').slice(0, 400)
      : null,
    events: D ? D.events.splice(0) : [],
  });
})()"#;

static LAST_PAGE: Mutex<String> = Mutex::new(String::new());
static LAST_NATIVE: Mutex<String> = Mutex::new(String::new());

pub fn log_plugin() -> tauri::plugin::TauriPlugin<tauri::Wry> {
    let builder = tauri_plugin_log::Builder::default().level(LevelFilter::Info);
    if !ENABLED {
        return builder.build();
    }
    builder
        .level_for("app_lib", LevelFilter::Debug)
        .level_for("ui", LevelFilter::Debug)
        .level_for("fe2", LevelFilter::Debug)
        .clear_targets()
        .targets([
            Target::new(TargetKind::LogDir { file_name: Some(LOG_FILE.into()) }),
            Target::new(TargetKind::Stdout),
        ])
        .max_file_size(5_000_000)
        .rotation_strategy(RotationStrategy::KeepSome(3))
        .timezone_strategy(TimezoneStrategy::UseLocal)
        .build()
}

// Lets a tester build point at a dead address to exercise the load-failure path.
pub fn fe2_url() -> String {
    const DEFAULT: &str = "https://fe2.io";
    if !ENABLED {
        return DEFAULT.into();
    }
    match std::env::var("FE2CM_FE2_URL") {
        Ok(url) if url.parse::<tauri::Url>().is_ok() => {
            log::warn!("fe2.io URL overridden by FE2CM_FE2_URL: {url}");
            url
        }
        _ => DEFAULT.into(),
    }
}

#[tauri::command]
pub fn debug_log(level: String, message: String) {
    let level = match level.as_str() {
        "error" => log::Level::Error,
        "warn" => log::Level::Warn,
        "debug" => log::Level::Debug,
        _ => log::Level::Info,
    };
    log::log!(target: "ui", level, "{message}");
}

#[derive(Serialize)]
pub struct BuildInfo {
    version: String,
    diagnostics: bool,
}

#[tauri::command]
pub fn build_info(app: AppHandle) -> BuildInfo {
    BuildInfo { version: app.package_info().version.to_string(), diagnostics: ENABLED }
}

// Testers send these files around, so the Roblox username stays out of them.
fn redacted_config(config: &Config) -> String {
    let mut value = serde_json::to_value(config).unwrap_or_default();
    if let Some(user) = value.get_mut("username") {
        if user.as_str().is_some_and(|u| !u.is_empty()) {
            *user = "<set>".into();
        }
    }
    serde_json::to_string(&value).unwrap_or_default()
}

fn os_version() -> String {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        if let Ok(out) = std::process::Command::new("cmd")
            .args(["/C", "ver"])
            .creation_flags(CREATE_NO_WINDOW)
            .output()
        {
            return String::from_utf8_lossy(&out.stdout).trim().to_string();
        }
    }
    std::env::consts::OS.to_string()
}

fn environment_summary(app: &AppHandle) -> String {
    let mut s = format!(
        "app: v{} (diagnostics build)\nos: {}\nwebview2 runtime: {}\n",
        app.package_info().version,
        os_version(),
        crate::webview::runtime_version(),
    );
    // These override the browser args the fe2.io webview is created with, autoplay policy included.
    for var in [
        "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS",
        "WEBVIEW2_BROWSER_EXECUTABLE_FOLDER",
        "WEBVIEW2_RELEASE_CHANNEL_PREFERENCE",
        "WEBVIEW2_USER_DATA_FOLDER",
    ] {
        if let Ok(v) = std::env::var(var) {
            s.push_str(&format!("env {var}={v}\n"));
        }
    }
    s
}

pub fn log_startup(app: &AppHandle) {
    if !ENABLED {
        return;
    }
    for line in environment_summary(app).lines() {
        log::info!("{line}");
    }
    let config = app.state::<AppState>().config.lock().unwrap().clone();
    log::info!("config at startup: {}", redacted_config(&config));
}

fn handle_snapshot(json: String) {
    let Ok(text) = serde_json::from_str::<String>(&json) else { return };
    let Ok(mut value) = serde_json::from_str::<serde_json::Value>(&text) else { return };
    if let Some(events) = value.get_mut("events").map(serde_json::Value::take) {
        for e in events.as_array().into_iter().flatten() {
            let kind = e.get("type").and_then(|v| v.as_str()).unwrap_or("?");
            let msg = e.get("msg").and_then(|v| v.as_str()).unwrap_or("");
            log::warn!(target: "fe2", "{kind}: {msg}");
        }
    }
    if let Some(obj) = value.as_object_mut() {
        obj.remove("events");
    }
    let state = value.to_string();
    let mut last = LAST_PAGE.lock().unwrap();
    if *last != state {
        log::info!(target: "fe2", "page state: {state}");
        *last = state;
    }
}

pub fn start(app: &AppHandle) {
    if !ENABLED {
        return;
    }
    let app = app.clone();
    std::thread::spawn(move || loop {
        std::thread::sleep(std::time::Duration::from_secs(2));
        let Some(w) = crate::game_logic::fe2_window(&app) else { continue };
        crate::webview::eval_with_result(&w, SNAPSHOT_SCRIPT, handle_snapshot);
        crate::webview::audio_flags(&w, |muted, playing| {
            let state = format!("webview muted={muted} playing_audio={playing}");
            let mut last = LAST_NATIVE.lock().unwrap();
            if *last != state {
                log::info!(target: "fe2", "{state}");
                *last = state;
            }
        });
    });
}

pub fn fe2_visible(app: &AppHandle) -> bool {
    crate::game_logic::fe2_window(app)
        .and_then(|w| w.is_visible().ok())
        .unwrap_or(false)
}

#[cfg(feature = "diagnostics")]
pub fn on_menu(app: &AppHandle, action: &str) {
    use crate::game_logic::{fe2_window, main_window};
    log::info!("debug menu: {action}");
    match action {
        "show-fe2" => toggle_fe2(app),
        "devtools-fe2" => {
            if let Some(w) = fe2_window(app) {
                w.open_devtools();
            }
        }
        "devtools-main" => {
            if let Some(w) = main_window(app) {
                w.open_devtools();
            }
        }
        "report" => match save_report(app) {
            Ok(path) => {
                reveal(&path);
                use tauri_plugin_dialog::{DialogExt, MessageDialogKind};
                app.dialog()
                    .message(format!(
                        "Debug report saved:\n\n{}\n\nPlease send this file to the developer.",
                        path.display()
                    ))
                    .title("FE2CM Debug Report")
                    .kind(MessageDialogKind::Info)
                    .show(|_| {});
            }
            Err(e) => log::error!("failed to save debug report: {e}"),
        },
        "logs" => {
            if let Ok(dir) = app.path().app_log_dir() {
                let _ = std::process::Command::new("explorer").arg(dir).spawn();
            }
        }
        _ => {}
    }
}

#[cfg(not(feature = "diagnostics"))]
pub fn on_menu(_app: &AppHandle, _action: &str) {}

#[cfg(feature = "diagnostics")]
fn toggle_fe2(app: &AppHandle) {
    if fe2_visible(app) {
        crate::game_logic::hide_fe2_window(app);
    } else {
        crate::game_logic::show_fe2_window(app);
    }
}

#[cfg(feature = "diagnostics")]
fn reveal(path: &std::path::Path) {
    let _ = std::process::Command::new("explorer")
        .arg(format!("/select,{}", path.display()))
        .spawn();
}

// UTC, so it needs no timezone crate; the log lines themselves are in local time.
#[cfg(feature = "diagnostics")]
fn utc_stamp() -> String {
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    let (days, rem) = (secs.div_euclid(86_400), secs.rem_euclid(86_400));
    // Howard Hinnant's civil_from_days.
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = yoe + era * 400 + i64::from(m <= 2);
    format!(
        "{y:04}-{m:02}-{d:02}_{:02}-{:02}-{:02}",
        rem / 3600,
        rem % 3600 / 60,
        rem % 60
    )
}

#[cfg(feature = "diagnostics")]
fn save_report(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    use std::sync::atomic::Ordering;

    let log_dir = app.path().app_log_dir().map_err(|e| e.to_string())?;
    let out_dir = app.path().desktop_dir().unwrap_or_else(|_| log_dir.clone());
    let stamp = utc_stamp();
    let path = out_dir.join(format!("fe2cm-debug-report-{stamp}.txt"));

    let state = app.state::<AppState>();
    let config = state.config.lock().unwrap().clone();
    let mut s = format!("=== FE2CM debug report ({stamp} UTC) ===\n");
    s.push_str(&environment_summary(app));
    s.push_str(&format!(
        "\n=== state ===\nconnection: {}\ncustom audio active: {}\nuser disconnected: {}\nfe2.io window visible: {}\nconfig: {}\nlast page state: {}\nlast {}\n",
        state.connection_status.lock().unwrap(),
        state.custom_audio_active.load(Ordering::Relaxed),
        state.user_disconnected.load(Ordering::Relaxed),
        fe2_visible(app),
        redacted_config(&config),
        LAST_PAGE.lock().unwrap(),
        LAST_NATIVE.lock().unwrap(),
    ));

    let mut logs: Vec<_> = std::fs::read_dir(&log_dir)
        .map(|rd| rd.flatten().map(|e| e.path()).collect())
        .unwrap_or_default();
    logs.retain(|p| p.extension().is_some_and(|e| e == "log"));
    logs.sort_by_key(|p| std::fs::metadata(p).and_then(|m| m.modified()).ok());
    for log in logs {
        s.push_str(&format!("\n=== {} ===\n", log.file_name().unwrap_or_default().to_string_lossy()));
        s.push_str(&std::fs::read_to_string(&log).unwrap_or_else(|e| format!("<unreadable: {e}>")));
    }

    std::fs::write(&path, s).map_err(|e| e.to_string())?;
    log::info!("debug report saved to {}", path.display());
    Ok(path)
}
