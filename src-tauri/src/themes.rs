use crate::config::CustomTheme;
use crate::game_logic::emit_ui;
use crate::state::AppState;
use crate::tray;
use std::fs;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager, State};

pub const BUILT_IN: [(&str, &str); 2] = [("fe2", "Flood Escape"), ("legacy", "Legacy")];
pub const DEFAULT_THEME: &str = "fe2";

const MAX_CSS_BYTES: usize = 512 * 1024;
const MAX_NAME_CHARS: usize = 40;
const MAX_DESC_CHARS: usize = 120;

fn themes_dir(state: &AppState) -> PathBuf {
    state
        .config_path
        .parent()
        .map(|p| p.join("themes"))
        .unwrap_or_else(|| PathBuf::from("themes"))
}

// Ids become file names, so they're validated even though we generate them.
fn valid_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 32 && id.chars().all(|c| c.is_ascii_alphanumeric())
}

fn css_path(state: &AppState, id: &str) -> Option<PathBuf> {
    valid_id(id).then(|| themes_dir(state).join(format!("{id}.css")))
}

pub fn set_theme_logic(app: &AppHandle, theme: &str) {
    let state = app.state::<AppState>();
    let theme = {
        let mut config = state.config.lock().unwrap();
        let exists = BUILT_IN.iter().any(|(id, _)| *id == theme)
            || theme
                .strip_prefix("custom:")
                .is_some_and(|id| config.custom_themes.iter().any(|t| t.id == id));
        let theme = if exists { theme } else { DEFAULT_THEME };
        config.settings.theme = theme.to_string();
        if let Err(e) = config.save(&state.config_path) {
            log::warn!("failed to save theme: {e}");
        }
        theme.to_string()
    };
    tray::update_menu(app);
    emit_ui(app, "set-theme", theme);
}

#[tauri::command]
pub fn import_theme(
    app: AppHandle,
    state: State<AppState>,
    name: String,
    description: String,
    base: String,
    css: String,
) -> Result<CustomTheme, String> {
    let name = name.trim();
    let description = description.trim();
    if name.is_empty() {
        return Err("Give the theme a name.".into());
    }
    if name.chars().count() > MAX_NAME_CHARS {
        return Err(format!("Name must be {MAX_NAME_CHARS} characters or fewer."));
    }
    if description.chars().count() > MAX_DESC_CHARS {
        return Err(format!("Description must be {MAX_DESC_CHARS} characters or fewer."));
    }
    if !BUILT_IN.iter().any(|(id, _)| *id == base) {
        return Err("Unknown base theme.".into());
    }
    if css.trim().is_empty() {
        return Err("The theme file is empty.".into());
    }
    if css.len() > MAX_CSS_BYTES {
        return Err("Theme files must be 512 KB or smaller.".into());
    }

    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let theme = CustomTheme {
        id: format!("t{millis}"),
        name: name.to_string(),
        description: description.to_string(),
        base,
    };

    let dir = themes_dir(&state);
    fs::create_dir_all(&dir).map_err(|e| format!("Couldn't create the themes folder: {e}"))?;
    let path = css_path(&state, &theme.id).ok_or("Invalid theme id.")?;
    fs::write(&path, css).map_err(|e| format!("Couldn't save the theme file: {e}"))?;

    {
        let mut config = state.config.lock().unwrap();
        config.custom_themes.push(theme.clone());
        config.save(&state.config_path)?;
    }
    tray::update_menu(&app);
    Ok(theme)
}

#[tauri::command]
pub fn delete_theme(app: AppHandle, state: State<AppState>, id: String) -> Result<(), String> {
    let was_active = {
        let mut config = state.config.lock().unwrap();
        config.custom_themes.retain(|t| t.id != id);
        let was_active = config.settings.theme == format!("custom:{id}");
        if was_active {
            config.settings.theme = DEFAULT_THEME.to_string();
        }
        config.save(&state.config_path)?;
        was_active
    };
    if let Some(path) = css_path(&state, &id) {
        let _ = fs::remove_file(path);
    }
    tray::update_menu(&app);
    if was_active {
        emit_ui(&app, "set-theme", DEFAULT_THEME);
    }
    Ok(())
}

#[tauri::command]
pub fn get_theme_css(state: State<AppState>, id: String) -> Result<String, String> {
    let path = css_path(&state, &id).ok_or("Invalid theme id.")?;
    fs::read_to_string(path).map_err(|e| format!("Couldn't read the theme file: {e}"))
}
