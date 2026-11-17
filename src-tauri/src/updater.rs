//! Auto-update (port of updater.js) on top of tauri-plugin-updater.
//!
//! Disabled until `plugins.updater.pubkey` is set in tauri.conf.json - Tauri
//! refuses unsigned updates, so there is nothing safe to check against yet.

use crate::game_logic::main_window;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
use tauri_plugin_updater::UpdaterExt;

fn pubkey_configured(app: &AppHandle) -> bool {
    app.config()
        .plugins
        .0
        .get("updater")
        .and_then(|c| c.get("pubkey"))
        .and_then(|k| k.as_str())
        .is_some_and(|k| !k.trim().is_empty())
}

fn create_progress_window(app: &AppHandle) -> Option<WebviewWindow> {
    let mut builder =
        WebviewWindowBuilder::new(app, "update-progress", WebviewUrl::App("progress.html".into()))
            .title("Downloading update")
            .inner_size(350.0, 120.0)
            .resizable(false)
            .minimizable(false)
            .maximizable(false)
            .closable(false)
            .decorations(false)
            .always_on_top(true)
            .center();
    if let Some(main) = main_window(app) {
        builder = builder.parent(&main).ok()?;
    }
    builder.build().ok()
}

pub fn check_on_startup(app: &AppHandle) {
    if !pubkey_configured(app) {
        log::info!("Updater disabled: no pubkey in tauri.conf.json");
        return;
    }
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        if let Err(e) = run(&app).await {
            // Matches the Electron app's startup check: failures are only logged.
            log::warn!("Update check failed: {e}");
        }
    });
}

async fn run(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let Some(update) = app.updater()?.check().await? else {
        return Ok(());
    };

    let wants_update = app
        .dialog()
        .message(format!(
            "A new version (v{}) is available.\n\nWould you like to download and install it?",
            update.version
        ))
        .title("Update Available")
        .kind(MessageDialogKind::Info)
        .buttons(MessageDialogButtons::OkCancelCustom("Update".into(), "Later".into()))
        .blocking_show();
    if !wants_update {
        return Ok(());
    }

    let progress = create_progress_window(app);
    let downloaded = Arc::new(Mutex::new(0u64));
    let last_pct = Arc::new(Mutex::new(-1i64));

    let bytes = {
        let progress = progress.clone();
        update
            .download(
                move |chunk, total| {
                    let mut done = downloaded.lock().unwrap();
                    *done += chunk as u64;
                    let Some(total) = total.filter(|t| *t > 0) else {
                        return;
                    };
                    let pct = (*done as f64 / total as f64 * 100.0).round() as i64;
                    let mut last = last_pct.lock().unwrap();
                    if pct != *last {
                        *last = pct;
                        if let Some(w) = &progress {
                            let _ = w.eval(format!(
                                "document.getElementById('bar').style.width='{pct}%';\
                                 document.getElementById('pct').innerText='{pct}%';"
                            ));
                        }
                    }
                },
                || {},
            )
            .await
    };
    if let Some(w) = progress {
        let _ = w.destroy();
    }

    let bytes = match bytes {
        Ok(b) => b,
        Err(e) => {
            app.dialog()
                .message(format!("Failed to download update.\n\n{e}"))
                .title("Update Failed")
                .kind(MessageDialogKind::Error)
                .blocking_show();
            return Ok(());
        }
    };

    let restart = app
        .dialog()
        .message("Update has been downloaded.\n\nThe application will restart to apply the update.")
        .title("Update Ready")
        .kind(MessageDialogKind::Info)
        .buttons(MessageDialogButtons::OkCancelCustom(
            "Restart Now".into(),
            "Later".into(),
        ))
        .blocking_show();
    if restart {
        // On Windows the installer takes over and closes the app.
        update.install(bytes)?;
        app.restart();
    }
    Ok(())
}
