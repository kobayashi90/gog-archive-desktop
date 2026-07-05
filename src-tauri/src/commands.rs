use crate::api;
use crate::torrent::{TorrentPreview, TorrentStatus, LibraryEntry};
use crate::AppState;
use std::process::Command;
use tauri::State;

// ── Game Search ──

#[tauri::command]
pub async fn search_games(
    state: State<'_, AppState>,
    query: String,
    limit: Option<i64>,
    offset: Option<i64>,
    genre: Option<String>,
    tag: Option<String>,
    developer: Option<String>,
    publisher: Option<String>,
    year: Option<String>,
    sort: Option<String>,
    order: Option<String>,
) -> Result<api::SearchResult, String> {
    let limit = limit.unwrap_or(48);
    let offset = offset.unwrap_or(0);
    let sort = sort.unwrap_or_else(|| "popularity_ranking".to_string());
    let order = order.unwrap_or_else(|| "ASC".to_string());

    state.api.search_games(
        &query, limit, offset,
        genre.as_deref(), tag.as_deref(),
        developer.as_deref(), publisher.as_deref(), year.as_deref(),
        &sort, &order,
    ).await
}

#[tauri::command]
pub async fn get_game(state: State<'_, AppState>, slug: String) -> Result<Option<api::Game>, String> {
    state.api.get_game(&slug).await
}

#[tauri::command]
pub async fn search_suggestions(
    state: State<'_, AppState>,
    query: String,
) -> Result<Vec<api::Game>, String> {
    state.api.search_suggestions(&query, 8).await
}

#[tauri::command]
pub async fn get_filters(
    state: State<'_, AppState>,
) -> Result<api::FilterOptions, String> {
    state.api.get_filters().await
}

// ── Settings ──

#[tauri::command]
pub fn get_settings(state: State<'_, AppState>) -> Result<crate::settings::Settings, String> {
    let settings = state.settings.lock().map_err(|e| e.to_string())?;
    Ok(settings.clone())
}

#[tauri::command]
pub async fn save_settings(
    state: State<'_, AppState>,
    settings: crate::settings::Settings,
) -> Result<(), String> {
    let new_dir = settings.download_dir.clone();
    let old_dir = {
        let s = state.settings.lock().map_err(|e| e.to_string())?;
        s.download_dir.clone()
    };
    let down_limit = settings.download_rate_limit;
    let up_limit = settings.upload_rate_limit;

    settings.save()?;
    {
        let mut s = state.settings.lock().map_err(|e| e.to_string())?;
        *s = settings;
    }

    let mut engine = state.engine.lock().await;
    engine.update_limits(down_limit, up_limit);

    if !new_dir.is_empty() && new_dir != old_dir {
        if engine.base_path.to_string_lossy() != new_dir.as_str() {
            std::fs::create_dir_all(&new_dir).map_err(|e| e.to_string())?;
            engine.base_path = std::path::PathBuf::from(&new_dir);
        }
    }

    Ok(())
}

// ── Torrent Operations ──

pub async fn collect_torrent_status(state: &AppState) -> Result<Vec<TorrentStatus>, String> {
    let engine = state.engine.lock().await;
    let mut results = engine.status_all().await;

    let mut finished: Vec<String> = Vec::new();
    for status in &results {
        if status.state == "seeding" && status.progress >= 1.0 {
            finished.push(status.slug.clone());
        }
    }

    for slug in &finished {
        let _ = engine.remove(slug).await;
    }
    results.retain(|s| !finished.contains(&s.slug));

    for status in &mut results {
        if let Ok(Some(game)) = state.api.get_game(&status.slug).await {
            status.title = game.title;
            status.image = game.image;
            if status.state == "seeding" && status.progress >= 1.0 {
                if let Some(expected) = game.total_size {
                    let ratio = if expected > 0 {
                        status.total_size as f64 / expected as f64
                    } else {
                        0.0
                    };
                    status.verified = ratio > 0.8 && ratio < 1.5;
                }
            }
        }
    }

    Ok(results)
}

#[tauri::command]
pub async fn torrent_status_all(state: State<'_, AppState>) -> Result<Vec<TorrentStatus>, String> {
    collect_torrent_status(&state).await
}

#[tauri::command]
pub async fn torrent_preview(
    state: State<'_, AppState>,
    magnet: String,
) -> Result<TorrentPreview, String> {
    let engine = state.engine.lock().await;
    engine.preview_magnet(&magnet).await
}

#[tauri::command]
pub async fn torrent_add(
    state: State<'_, AppState>,
    magnet: String,
    slug: String,
    selected_files: Option<Vec<usize>>,
) -> Result<(), String> {
    let engine = state.engine.lock().await;
    engine.add_magnet(&magnet, &slug, selected_files).await
}

#[tauri::command]
pub async fn torrent_remove(state: State<'_, AppState>, slug: String) -> Result<(), String> {
    let engine = state.engine.lock().await;
    engine.remove(&slug).await
}

#[tauri::command]
pub async fn torrent_pause(state: State<'_, AppState>, slug: String) -> Result<(), String> {
    let engine = state.engine.lock().await;
    engine.pause(&slug).await
}

#[tauri::command]
pub async fn torrent_resume(state: State<'_, AppState>, slug: String) -> Result<(), String> {
    let engine = state.engine.lock().await;
    engine.resume(&slug).await
}

#[tauri::command]
pub async fn torrent_library(state: State<'_, AppState>) -> Result<Vec<LibraryEntry>, String> {
    let engine = state.engine.lock().await;
    let mut results = engine.library().await;

    for entry in &mut results {
        // First try direct slug match
        if let Ok(Some(game)) = state.api.get_game(&entry.slug).await {
            entry.title = game.title;
            entry.image = game.image;
            entry.developer = game.developer;
            entry.genre = game.genres;
            entry.file_count = game.file_count;
            entry.total_size = game.total_size;
            continue;
        }
        // Fallback: match directory name against game titles
        if let Ok(matches) = state.api.search_games_by_title(&entry.slug, 1).await {
            if let Some(game) = matches.into_iter().nth(0) {
                entry.slug = game.slug;
                entry.title = game.title;
                entry.image = game.image;
                entry.developer = game.developer;
                entry.genre = game.genres;
                entry.file_count = game.file_count;
                entry.total_size = game.total_size;
            }
        }
    }

    Ok(results)
}

#[tauri::command]
pub async fn torrent_library_delete(state: State<'_, AppState>, slug: String) -> Result<(), String> {
    let engine = state.engine.lock().await;
    engine.library_delete(&slug).await
}

#[tauri::command]
pub async fn check_download_dir(state: State<'_, AppState>, slug: String) -> Result<bool, String> {
    let engine = state.engine.lock().await;
    Ok(engine.download_dir_exists(&slug))
}

#[tauri::command]
pub async fn delete_download_dir(state: State<'_, AppState>, slug: String) -> Result<(), String> {
    let engine = state.engine.lock().await;
    engine.delete_download_dir(&slug)
}

#[tauri::command]
pub async fn open_folder(state: State<'_, AppState>, slug: String) -> Result<(), String> {
    let engine = state.engine.lock().await;
    let dir = engine.get_save_path(&slug).await
        .ok_or_else(|| format!("Folder not found: {slug}"))?;

    #[cfg(target_os = "linux")]
    {
        Command::new("xdg-open")
            .arg(&dir)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg(&dir)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "windows")]
    {
        Command::new("explorer")
            .arg(&dir)
            .spawn()
            .map_err(|e| e.to_string())?;
    }

    Ok(())
}

#[tauri::command]
pub fn open_url(url: String) -> Result<(), String> {
    #[cfg(target_os = "linux")]
    {
        Command::new("xdg-open")
            .arg(&url)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg(&url)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "windows")]
    {
        Command::new("cmd")
            .args(["/c", "start", &url])
            .spawn()
            .map_err(|e| e.to_string())?;
    }

    Ok(())
}
