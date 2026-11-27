use crate::game_logic::{
    apply_volume_logic, click_option_logic, emit_ui, main_window, reload_fe2,
};
use crate::state::AppState;
use crate::themes;
use std::sync::atomic::Ordering;
use tauri::image::Image;
use tauri::menu::{CheckMenuItem, Menu, MenuEvent, MenuItem, PredefinedMenuItem, Submenu};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager};

const ICON: &[u8] = include_bytes!("../icons/icon.ico");

pub fn show_main(app: &AppHandle) {
    if let Some(w) = main_window(app) {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}

pub fn toggle_main(app: &AppHandle) {
    if let Some(w) = main_window(app) {
        if w.is_visible().unwrap_or(false) {
            let _ = w.hide();
        } else {
            show_main(app);
        }
    }
}

pub fn quit(app: &AppHandle) {
    app.state::<AppState>().is_quitting.store(true, Ordering::SeqCst);
    app.exit(0);
}

fn build_menu(app: &AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
    let (on_death, on_leave, current_theme, custom_themes) = {
        let config = app.state::<AppState>().config.lock().unwrap().clone();
        (config.on_death, config.on_leave, config.settings.theme, config.custom_themes)
    };

    let title = MenuItem::with_id(app, "title", "FE2CM Audio Player", false, None::<&str>)?;
    let toggle = MenuItem::with_id(app, "toggle", "Toggle Visibility", true, None::<&str>)?;
    let refresh = MenuItem::with_id(app, "refresh", "Refresh FE2IO", true, None::<&str>)?;

    let volume = Submenu::with_items(
        app,
        "Volume",
        true,
        &[
            &MenuItem::with_id(app, "vol:0", "Mute", true, None::<&str>)?,
            &MenuItem::with_id(app, "vol:25", "25%", true, None::<&str>)?,
            &MenuItem::with_id(app, "vol:50", "50%", true, None::<&str>)?,
            &MenuItem::with_id(app, "vol:75", "75%", true, None::<&str>)?,
            &MenuItem::with_id(app, "vol:100", "100%", true, None::<&str>)?,
        ],
    )?;

    let radio = |prefix: &str, label: &str, current: &str| {
        CheckMenuItem::with_id(
            app,
            format!("{prefix}:{label}"),
            label,
            true,
            current == label,
            None::<&str>,
        )
    };
    let death = Submenu::with_items(
        app,
        "On Death",
        true,
        &[
            &radio("onDeath", "Quieten BGM", &on_death)?,
            &radio("onDeath", "Stop BGM", &on_death)?,
            &radio("onDeath", "Disable", &on_death)?,
        ],
    )?;
    let leave = Submenu::with_items(
        app,
        "Leaving Game",
        true,
        &[
            &radio("onLeave", "Stop BGM", &on_leave)?,
            &radio("onLeave", "Disable", &on_leave)?,
        ],
    )?;
    // Always reachable, so a broken custom theme can be swapped for a built-in one.
    let theme = Submenu::with_id(app, "theme", "Theme", true)?;
    for (id, label) in themes::BUILT_IN {
        theme.append(&CheckMenuItem::with_id(
            app,
            format!("theme:{id}"),
            label,
            true,
            current_theme == id,
            None::<&str>,
        )?)?;
    }
    if !custom_themes.is_empty() {
        theme.append(&PredefinedMenuItem::separator(app)?)?;
        for t in &custom_themes {
            let id = format!("custom:{}", t.id);
            theme.append(&CheckMenuItem::with_id(
                app,
                format!("theme:{id}"),
                &t.name,
                true,
                current_theme == id,
                None::<&str>,
            )?)?;
        }
    }

    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let sep = || PredefinedMenuItem::separator(app);

    let menu = Menu::with_items(
        app,
        &[
            &title,
            &sep()?,
            &toggle,
            &refresh,
            &sep()?,
            &volume,
            &death,
            &leave,
            &sep()?,
            &theme,
            &sep()?,
            &quit,
        ],
    )?;
    if crate::diag::ENABLED {
        let item = |id: &str, label: &str| MenuItem::with_id(app, id, label, true, None::<&str>);
        let debug = Submenu::with_items(
            app,
            "Debug",
            true,
            &[
                &CheckMenuItem::with_id(
                    app,
                    "dbg:show-fe2",
                    "Show fe2.io Window",
                    true,
                    crate::diag::fe2_visible(app),
                    None::<&str>,
                )?,
                &item("dbg:devtools-fe2", "fe2.io DevTools")?,
                &item("dbg:devtools-main", "App DevTools")?,
                &sep()?,
                &item("dbg:report", "Save Debug Report")?,
                &item("dbg:logs", "Open Log Folder")?,
            ],
        )?;
        // Sits just above Quit.
        let quit_pos = menu.items()?.len() - 1;
        menu.insert_items(&[&debug, &sep()?], quit_pos)?;
    }
    Ok(menu)
}

fn on_menu_event(app: &AppHandle, event: MenuEvent) {
    let id = event.id().as_ref();
    log::info!("tray: {id}");
    if let Some(action) = id.strip_prefix("dbg:") {
        crate::diag::on_menu(app, action);
        return;
    }
    match id {
        "toggle" => toggle_main(app),
        "refresh" => {
            app.state::<AppState>().force_reconnect.store(true, Ordering::SeqCst);
            reload_fe2(app);
            crate::overlay::notify(app, "Refreshing FE2.IO");
        }
        "quit" => quit(app),
        _ => {
            if let Some(theme) = id.strip_prefix("theme:") {
                themes::set_theme_logic(app, theme);
            } else if let Some(v) = id.strip_prefix("vol:").and_then(|v| v.parse::<u8>().ok()) {
                apply_volume_logic(app, v);
                emit_ui(app, "update-volume", v);
                crate::overlay::notify(app, crate::overlay::volume_text(v));
            } else if let Some((group, val)) = id.split_once(':') {
                if group == "onDeath" || group == "onLeave" {
                    click_option_logic(app, group, val);
                    let config = app.state::<AppState>().config.lock().unwrap().clone();
                    emit_ui(app, "restore-state", config);
                    let label = if group == "onDeath" { "On Death" } else { "Leaving Game" };
                    crate::overlay::notify(app, format!("{label}: {val}"));
                }
            }
        }
    }
}

pub fn create(app: &AppHandle) -> tauri::Result<()> {
    let tray = TrayIconBuilder::with_id("main")
        .icon(Image::from_bytes(ICON)?)
        .tooltip(if crate::diag::ENABLED { "FE2CM Audio Player (Debug)" } else { "FE2CM Audio Player" })
        .menu(&build_menu(app)?)
        .show_menu_on_left_click(false)
        .on_menu_event(on_menu_event)
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                toggle_main(tray.app_handle());
            }
        })
        .build(app)?;
    *app.state::<AppState>().tray.lock().unwrap() = Some(tray);
    Ok(())
}

// Rebuilt because tray check items don't follow config changes on their own.
pub fn update_menu(app: &AppHandle) {
    let state = app.state::<AppState>();
    let guard = state.tray.lock().unwrap();
    if let Some(tray) = guard.as_ref() {
        match build_menu(app) {
            Ok(menu) => {
                let _ = tray.set_menu(Some(menu));
            }
            Err(e) => log::warn!("failed to rebuild tray menu: {e}"),
        }
    }
}
