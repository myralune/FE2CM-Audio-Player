use std::sync::atomic::Ordering;
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder, WindowEvent};
use tauri::webview::PageLoadEvent;
use tauri_plugin_dialog::{DialogExt, MessageDialogKind};

mod aspect;
mod commands;
mod config;
mod diag;
mod game_logic;
mod overlay;
mod shortcuts;
mod state;
mod themes;
mod tray;
mod updater;
mod webview;

use game_logic::{FE2_LABEL, MAIN_LABEL};
use state::AppState;

fn on_main_close_requested(window: &tauri::Window, api: &tauri::CloseRequestApi) {
    let app = window.app_handle();
    let state = app.state::<AppState>();
    if state.is_quitting.load(Ordering::SeqCst) {
        return;
    }
    if !state.config.lock().unwrap().settings.minimize_on_close {
        tray::quit(app);
        return;
    }
    api.prevent_close();

    if state.has_shown_minimize_alert.load(Ordering::SeqCst) {
        let _ = window.hide();
        return;
    }
    let app = app.clone();
    let win = window.clone();
    app.dialog()
        .message("App minimized to Tray.\n\nYou can change this behavior in Settings.")
        .title("FE2CM Audio Player")
        .kind(MessageDialogKind::Info)
        .show(move |_| {
            let _ = win.hide();
            app.state::<AppState>()
                .has_shown_minimize_alert
                .store(true, Ordering::SeqCst);
        });
}

// The aspect ratio is enforced while dragging, in `aspect`.
fn on_main_resized(window: &tauri::Window, size: tauri::PhysicalSize<u32>) {
    if size.width == 0 || size.height == 0 {
        return; // minimized
    }
    let app = window.app_handle();
    let (base_w, _) = *app.state::<AppState>().base_content_size.lock().unwrap();
    let scale = window.scale_factor().unwrap_or(1.0);
    let width = size.width as f64 / scale;

    if let Some(w) = app.get_webview_window(MAIN_LABEL) {
        let _ = w.set_zoom(width / base_w);
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            tray::show_main(app);
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            if cfg!(debug_assertions) || diag::ENABLED {
                app.handle().plugin(diag::log_plugin())?;
            }

            let config_path = app.path().app_config_dir()?.join("fe2-config.json");
            let config = config::Config::load(&config_path);
            let settings = config.settings.clone();
            app.manage(AppState::new(config, config_path));
            diag::log_startup(app.handle());

            // Hidden background webview that hosts the real fe2.io page.
            let handle = app.handle().clone();
            let fe2_dir = app.path().app_data_dir()?.join("fe2-webview");
            let mut fe2 = WebviewWindowBuilder::new(
                app,
                FE2_LABEL,
                WebviewUrl::External(diag::fe2_url().parse().unwrap()),
            )
            .title("fe2.io")
            .visible(false)
            .skip_taskbar(true)
            .additional_browser_args(
                "--autoplay-policy=no-user-gesture-required --disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection",
            )
            .data_directory(fe2_dir)
            .on_page_load(move |_window, payload| {
                log::info!("fe2.io page load {:?}: {}", payload.event(), payload.url());
                if payload.event() == PageLoadEvent::Finished {
                    game_logic::on_fe2_loaded(&handle);
                }
            });
            if diag::ENABLED {
                fe2 = fe2.initialization_script(diag::INIT_SCRIPT);
            }
            let fe2 = fe2.build()?;
            webview::on_navigation_completed(&fe2, |ok, status, http| {
                if ok {
                    log::info!("fe2.io navigation completed: http {http}");
                } else {
                    log::warn!(
                        "fe2.io navigation failed: {} ({status}), http {http}",
                        webview::web_error_name(status)
                    );
                }
            });
            diag::start(app.handle());

            if let Some(main) = app.get_webview_window(MAIN_LABEL) {
                let (base_w, base_h) = *app.state::<AppState>().base_content_size.lock().unwrap();
                aspect::set_ratio(base_w, base_h);
                aspect::apply_min_size(&main, base_w, base_h);
                aspect::install(&main);
                let _ = main.set_always_on_top(settings.always_on_top);
                if diag::ENABLED {
                    let _ = main.set_title("FE2CM Audio Player (Debug)");
                }
                if !settings.start_minimized {
                    let _ = main.show();
                }
            }

            tray::create(app.handle())?;
            overlay::create(app.handle())?;
            shortcuts::start(app.handle());
            // A tester build must not replace itself with the normal release.
            if !diag::ENABLED {
                updater::check_on_startup(app.handle());
            }

            Ok(())
        })
        .on_window_event(|window, event| {
            // Destroying the fe2.io window would break the app, so the debug "show" view only hides.
            if window.label() == FE2_LABEL {
                if let WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    let _ = window.hide();
                    let _ = window.set_skip_taskbar(true);
                    tray::update_menu(window.app_handle());
                }
                return;
            }
            if window.label() != MAIN_LABEL {
                return;
            }
            match event {
                WindowEvent::CloseRequested { api, .. } => on_main_close_requested(window, api),
                WindowEvent::Resized(size) => on_main_resized(window, *size),
                _ => {}
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::app_close,
            commands::app_minimize,
            commands::fit_window,
            commands::get_config,
            commands::ui_ready,
            commands::save_advanced_settings,
            commands::connect_user,
            commands::disconnect_game,
            commands::refresh_fe2,
            commands::show_fe2_window,
            commands::set_volume,
            commands::click_option,
            commands::set_custom_audio_active,
            commands::set_site_mute,
            commands::set_site_volume,
            commands::start_hotkey_capture,
            commands::stop_hotkey_capture,
            themes::import_theme,
            themes::delete_theme,
            themes::get_theme_css,
            overlay::get_overlay_state,
            overlay::quick_set_volume,
            overlay::quick_click_option,
            overlay::quick_toggle_mute,
            overlay::quick_refresh,
            overlay::show_notification,
            diag::debug_log,
            diag::build_info,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
