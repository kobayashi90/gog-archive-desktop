mod api;
mod commands;
mod settings;
mod torrent;

use api::ApiClient;
use settings::Settings;
use std::sync::{Arc, Mutex};
use torrent::TorrentEngine;

pub struct AppState {
    pub api: ApiClient,
    pub settings: Arc<Mutex<Settings>>,
    pub engine: Arc<tokio::sync::Mutex<TorrentEngine>>,
}

fn activate_window() {
    if let Ok(output) = std::process::Command::new("kdotool")
        .args(["search", "--name", "GOG Archive Desktop", "windowactivate"])
        .output()
    {
        if !output.status.success() {
            eprintln!("kdotool windowactivate failed: {}", String::from_utf8_lossy(&output.stderr));
        }
    }
}

pub fn run() {
    let settings = Settings::load();

    let download_dir = if settings.download_dir.is_empty() {
        dirs::download_dir()
            .unwrap_or_else(|| std::path::PathBuf::from("."))
            .to_string_lossy()
            .to_string()
    } else {
        settings.download_dir.clone()
    };

    let opts = settings.to_session_options();

    let engine = {
        let rt = tokio::runtime::Runtime::new().expect("Failed to create Tokio runtime");
        let _guard = rt.enter();
        let engine = rt
            .block_on(TorrentEngine::new(&download_dir, opts))
            .expect("Failed to create torrent engine");
        std::mem::forget(rt);
        engine
    };
    let engine = Arc::new(tokio::sync::Mutex::new(engine));

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            use commands::collect_torrent_status;
            use std::time::Duration;
            use tauri::{Emitter, Manager};

            let icon_paths = [
                app.path().resource_dir().ok().map(|d| d.join("icons/icon.png")),
                Some(std::path::PathBuf::from("icons/icon.png")),
                Some(std::path::PathBuf::from("../icons/icon.png")),
            ];
            for p in icon_paths.into_iter().flatten() {
                if let Ok(bytes) = std::fs::read(&p) {
                    if let Ok(img) = tauri::image::Image::from_bytes(&bytes) {
                        if let Some(win) = app.get_webview_window("main") {
                            let _ = win.set_icon(img);
                        }
                    }
                    break;
                }
            }

            let tray_icon = {
                let mut tray_icon = None;
                if let Some(icon) = app.default_window_icon() {
                    tray_icon = Some(icon.clone());
                }
                if tray_icon.is_none() {
                    let tray_paths = [
                        app.path().resource_dir().ok().map(|d| d.join("icons/32x32.png")),
                        Some(std::path::PathBuf::from("icons/32x32.png")),
                        Some(std::path::PathBuf::from("../icons/32x32.png")),
                    ];
                    for p in tray_paths.into_iter().flatten() {
                        if let Ok(bytes) = std::fs::read(&p) {
                            if let Ok(img) = tauri::image::Image::from_bytes(&bytes) {
                                tray_icon = Some(img);
                                break;
                            }
                        }
                    }
                }
                tray_icon
            };

            use tauri::menu::{MenuBuilder, MenuItemBuilder};
            use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};

            let menu = MenuBuilder::new(app)
                .item(&MenuItemBuilder::with_id("show", "Open GOG Archive Desktop").build(app)?)
                .separator()
                .item(&MenuItemBuilder::with_id("downloads", "Downloads").build(app)?)
                .item(&MenuItemBuilder::with_id("settings", "Settings").build(app)?)
                .separator()
                .item(&MenuItemBuilder::with_id("pause_all", "Pause All").build(app)?)
                .item(&MenuItemBuilder::with_id("resume_all", "Resume All").build(app)?)
                .separator()
                .item(&MenuItemBuilder::with_id("quit", "Quit").build(app)?)
                .build()?;

            let tray = if let Some(icon) = tray_icon {
                TrayIconBuilder::with_id("gog-archive")
                    .icon(icon)
                    .menu(&menu)
                    .tooltip("GOG Archive Desktop")
                    .title("GOG Archive Desktop")
                    .on_menu_event(|app, event| {
                        match event.id.as_ref() {
                            "show" | "downloads" | "settings" => {
                                let _ = app.emit("tray-action", event.id.as_ref());
                                if let Some(window) = app.get_webview_window("main") {
                                    let _ = window.unminimize();
                                    let _ = window.show();
                                    activate_window();
                                }
                            }
                            "pause_all" | "resume_all" => {
                                let _ = app.emit("tray-action", event.id.as_ref());
                            }
                            "quit" => {
                                app.exit(0);
                            }
                            _ => {}
                        }
                    })
                    .on_tray_icon_event(|tray, event| {
                        if let TrayIconEvent::Click { button, button_state, .. } = event {
                            if button == MouseButton::Left && button_state == MouseButtonState::Up {
                                if let Some(window) = tray.app_handle().get_webview_window("main") {
                                    let _ = window.unminimize();
                                    let _ = window.show();
                                    activate_window();
                                }
                            }
                        }
                    })
                    .build(app)
                    .ok()
            } else {
                None
            };

            let handle = app.handle().clone();
            let tray_tooltip = tray.clone();
            std::thread::spawn(move || {
                fn fmt_bytes(b: f64) -> String {
                    let units = ["B/s", "KB/s", "MB/s", "GB/s"];
                    let mut i = 0;
                    let mut v = b;
                    while v >= 1024.0 && i < units.len() - 1 { v /= 1024.0; i += 1; }
                    format!("{:.2} {}", v, units[i])
                }
                let rt = tokio::runtime::Runtime::new()
                    .expect("Failed to create tokio runtime for status emitter");
                rt.block_on(async move {
                    loop {
                        tokio::time::sleep(Duration::from_millis(200)).await;
                        if let Ok(statuses) = collect_torrent_status(&handle.state::<AppState>()).await {
                            let _ = handle.emit("torrent-status", &statuses);

                            if let Some(ref tray) = tray_tooltip {
                                let active: Vec<_> = statuses.iter()
                                    .filter(|s| s.state == "downloading" || s.state == "metadata" || s.state == "checking")
                                    .collect();
                                let tooltip = if active.is_empty() {
                                    "GOG Archive Desktop".to_string()
                                } else {
                                    let total_rate: f64 = active.iter().map(|s| s.download_rate as f64).sum();
                                    let avg_progress: f64 = active.iter().map(|s| s.progress).sum::<f64>() / active.len() as f64;
                                    let count = active.len();
                                    if count == 1 {
                                        let s = &active[0];
                                        format!(
                                            "{} — {:.1}% — {}",
                                            &s.title,
                                            s.progress * 100.0,
                                            fmt_bytes(total_rate)
                                        )
                                    } else {
                                        format!(
                                            "{} downloads — {:.1}% avg — {}",
                                            count,
                                            avg_progress * 100.0,
                                            fmt_bytes(total_rate)
                                        )
                                    }
                                };
                                let _ = tray.set_tooltip(Some(&tooltip));
                                let _ = tray.set_title(Some(&tooltip));
                            }
                        }
                    }
                });
            });

            Ok(())
        })
        .manage(AppState {
            api: ApiClient::new(),
            settings: Arc::new(Mutex::new(settings)),
            engine,
        })
        .invoke_handler(tauri::generate_handler![
            commands::search_games,
            commands::get_game,
            commands::search_suggestions,
            commands::get_filters,
            commands::get_settings,
            commands::save_settings,
            commands::torrent_status_all,
            commands::torrent_preview,
            commands::torrent_add,
            commands::torrent_remove,
            commands::torrent_pause,
            commands::torrent_resume,
            commands::torrent_library,
            commands::torrent_library_delete,
            commands::check_download_dir,
            commands::delete_download_dir,
            commands::open_folder,
            commands::open_url,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
