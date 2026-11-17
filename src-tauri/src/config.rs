use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;

#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(default, rename_all = "camelCase")]
pub struct Hotkeys {
    pub mute: String,
    pub vol_up: String,
    pub vol_down: String,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(default, rename_all = "camelCase")]
pub struct Settings {
    pub auto_connect: bool,
    pub always_on_top: bool,
    pub start_minimized: bool,
    pub minimize_on_close: bool,
    pub hotkeys: Hotkeys,
    // "fe2", "legacy" or "custom:<id>".
    pub theme: String,
    pub quick_bar: bool,
    pub notifications: bool,
}

impl Default for Settings {
    fn default() -> Self {
        Settings {
            auto_connect: true,
            always_on_top: false,
            start_minimized: false,
            minimize_on_close: true,
            hotkeys: Hotkeys::default(),
            theme: String::from("fe2"),
            quick_bar: true,
            notifications: true,
        }
    }
}

// The CSS lives in `<config dir>/themes/<id>.css`.
#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(default, rename_all = "camelCase")]
pub struct CustomTheme {
    pub id: String,
    pub name: String,
    pub description: String,
    pub base: String,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(default, rename_all = "camelCase")]
pub struct Config {
    pub username: String,
    pub volume: u8,
    pub previous_volume: u8,
    pub on_death: String,
    pub on_leave: String,
    pub settings: Settings,
    // Kept outside `settings` so the UI's settings saves never overwrite it.
    pub custom_themes: Vec<CustomTheme>,
}

impl Default for Config {
    fn default() -> Self {
        Config {
            username: String::new(),
            volume: 70,
            previous_volume: 70,
            on_death: String::from("Quieten BGM"),
            on_leave: String::from("Stop BGM"),
            settings: Settings::default(),
            custom_themes: Vec::new(),
        }
    }
}

impl Config {
    pub fn load(path: &Path) -> Config {
        let text = match fs::read_to_string(path) {
            Ok(t) => t,
            Err(_) => return Config::default(),
        };
        let mut config: Config = serde_json::from_str(&text).unwrap_or_default();
        if config.previous_volume == 0 {
            config.previous_volume = 70;
        }
        config
    }

    pub fn save(&self, path: &Path) -> Result<(), String> {
        if let Some(dir) = path.parent() {
            fs::create_dir_all(dir).map_err(|e| e.to_string())?;
        }
        let text = serde_json::to_string_pretty(self).map_err(|e| e.to_string())?;
        fs::write(path, text).map_err(|e| e.to_string())
    }
}
