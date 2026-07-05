use librqbit::api::TorrentIdOrHash;
use librqbit::{AddTorrent, AddTorrentOptions, AddTorrentResponse, Session, SessionOptions, TorrentStatsState};
use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::collections::VecDeque;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::Mutex;

#[derive(Debug, Clone, Serialize)]
pub struct TorrentStatus {
    pub info_hash: String,
    pub name: String,
    pub slug: String,
    pub title: String,
    pub image: Option<String>,
    pub progress: f64,
    pub state: String,
    pub download_rate: i64,
    pub upload_rate: i64,
    pub total_download: i64,
    pub total_upload: i64,
    pub total_size: i64,
    pub num_peers: i64,
    pub num_seeds: i64,
    pub eta: i64,
    pub verified: bool,
    pub seeding_secs: i64,
    pub save_path: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct LibraryEntry {
    pub slug: String,
    pub title: String,
    pub image: Option<String>,
    pub size: i64,
    pub developer: Option<String>,
    pub genre: Option<String>,
    pub file_count: i64,
    pub total_size: Option<i64>,
}

#[derive(Debug, Clone, Serialize)]
pub struct TorrentFileInfo {
    pub index: usize,
    pub name: String,
    pub size: i64,
}

struct RateState {
    samples: VecDeque<(Instant, i64, i64)>,
    window: Duration,
}

impl RateState {
    fn new() -> Self {
        Self {
            samples: VecDeque::new(),
            window: Duration::from_secs(5),
        }
    }

    fn update(&mut self, down: i64, up: i64) -> (i64, i64) {
        let now = Instant::now();
        self.samples.push_back((now, down, up));

        let cutoff = now - self.window;
        while self.samples.len() > 1 && self.samples[1].0 < cutoff {
            self.samples.pop_front();
        }

        if self.samples.len() >= 2 {
            let (t1, d1, u1) = *self.samples.front().unwrap();
            let (t2, d2, u2) = *self.samples.back().unwrap();
            let elapsed = t2.duration_since(t1).as_secs_f64();
            if elapsed > 0.5 && d2 >= d1 && u2 >= u1 {
                let d = ((d2 - d1) as f64 / elapsed) as i64;
                let u = ((u2 - u1) as f64 / elapsed) as i64;
                return (d.max(0), u.max(0));
            }
        }
        (0, 0)
    }
}

struct EngineInner {
    slug_map: HashMap<String, String>,
    removed_slugs: Vec<String>,
    persisted_slugs: HashSet<String>,
    rate: RateState,
    seed_times: HashMap<String, Instant>,
    torrent_rates: HashMap<String, RateState>,
}

pub struct TorrentEngine {
    session: Arc<Session>,
    pub base_path: PathBuf,
    persist_path: PathBuf,
    inner: Mutex<EngineInner>,
}

fn state_to_string(state: TorrentStatsState, finished: bool) -> &'static str {
    match state {
        TorrentStatsState::Initializing => "queued",
        TorrentStatsState::Live if finished => "seeding",
        TorrentStatsState::Live => "downloading",
        TorrentStatsState::Paused => "paused",
        TorrentStatsState::Error => "error",
    }
}

impl TorrentEngine {
    fn save_persisted(&self, inner: &EngineInner) {
        save_library_file(&self.persist_path, &inner.persisted_slugs);
    }

    pub async fn new(base_path: &str, opts: SessionOptions) -> Result<Self, String> {
        let path = PathBuf::from(base_path);
        std::fs::create_dir_all(&path).map_err(|e| e.to_string())?;

        let session = Session::new_with_opts(path.clone(), opts)
            .await
            .map_err(|e| format!("Failed to create torrent session: {e}"))?;

        let persist_path = path.join(".library.json");
        let persisted_slugs = load_library_file(&persist_path);

        Ok(Self {
            session,
            base_path: path,
            persist_path,
            inner: Mutex::new(EngineInner {
                slug_map: HashMap::new(),
                removed_slugs: Vec::new(),
                persisted_slugs,
                rate: RateState::new(),
                seed_times: HashMap::new(),
                torrent_rates: HashMap::new(),
            }),
        })
    }

    pub async fn preview_magnet(&self, magnet: &str) -> Result<Vec<TorrentFileInfo>, String> {
        let response = self.session.add_torrent(
                AddTorrent::from_url(magnet.to_string()),
                Some(AddTorrentOptions {
                    list_only: true,
                    ..Default::default()
                }),
            )
            .await
            .map_err(|e| format!("Failed to preview torrent: {e}"))?;

        let list = match response {
            AddTorrentResponse::ListOnly(list) => list,
            _ => return Err("Unexpected response type from torrent add".into()),
        };

        let files: Vec<TorrentFileInfo> = list.info
            .iter_file_details()
            .enumerate()
            .map(|(i, d)| TorrentFileInfo {
                index: i,
                name: d.filename.to_string(),
                size: d.len as i64,
            })
            .collect();

        Ok(files)
    }

    pub async fn add_magnet(&self, magnet: &str, slug: &str, selected_files: Option<Vec<usize>>) -> Result<(), String> {
        sanitize_slug(slug)?;
        let slug_path = self.base_path.join(slug);
        std::fs::create_dir_all(&slug_path).map_err(|e| e.to_string())?;
        check_path_under_base(&slug_path, &self.base_path)?;

        let only_files = selected_files.filter(|v| !v.is_empty());

        let response = self.session.add_torrent(
                AddTorrent::from_url(magnet.to_string()),
                Some(AddTorrentOptions {
                    output_folder: Some(slug_path.to_string_lossy().to_string()),
                    only_files,
                    ..Default::default()
                }),
            )
            .await
            .map_err(|e| format!("Failed to add torrent: {e}"))?;

        let handle = response
            .into_handle()
            .ok_or("Failed to get torrent handle")?;

        let info_hash = handle.info_hash().as_string();

        let mut inner = self.inner.lock().await;
        inner.slug_map.insert(slug.to_string(), info_hash);
        inner.persisted_slugs.insert(slug.to_string());
        self.save_persisted(&inner);

        Ok(())
    }

    pub async fn remove(&self, slug: &str) -> Result<(), String> {
        sanitize_slug(slug)?;
        let mut inner = self.inner.lock().await;

        if let Some(info_hash) = inner.slug_map.remove(slug) {
            if let Ok(hash) = TorrentIdOrHash::parse(&info_hash) {
                self.session
                    .delete(hash, false)
                    .await
                    .map_err(|e| e.to_string())?;
            }
        }

        if !inner.removed_slugs.contains(&slug.to_string()) {
            inner.removed_slugs.push(slug.to_string());
        }
        inner.persisted_slugs.insert(slug.to_string());
        self.save_persisted(&inner);

        Ok(())
    }

    pub async fn pause(&self, slug: &str) -> Result<(), String> {
        sanitize_slug(slug)?;
        let inner = self.inner.lock().await;
        if let Some(info_hash) = inner.slug_map.get(slug) {
            if let Ok(hash) = TorrentIdOrHash::parse(info_hash) {
                if let Some(handle) = self.session.get(hash) {
                    self.session
                        .pause(&handle)
                        .await
                        .map_err(|e| e.to_string())?;
                }
            }
        }
        Ok(())
    }

    pub async fn resume(&self, slug: &str) -> Result<(), String> {
        sanitize_slug(slug)?;
        let inner = self.inner.lock().await;
        if let Some(info_hash) = inner.slug_map.get(slug) {
            if let Ok(hash) = TorrentIdOrHash::parse(info_hash) {
                if let Some(handle) = self.session.get(hash) {
                    self.session
                        .unpause(&handle)
                        .await
                        .map_err(|e| e.to_string())?;
                }
            }
        }
        Ok(())
    }

    pub async fn status_all(&self) -> Vec<TorrentStatus> {
        let mut inner = self.inner.lock().await;

        // Build owned inverse lookup from slug_map (before any mutable access to inner)
        let hash_to_slug: HashMap<String, String> = inner
            .slug_map
            .iter()
            .map(|(k, v)| (v.clone(), k.clone()))
            .collect();

        // Collect raw stats from all torrents (closure is Fn, use interior mutability)
        use std::cell::RefCell;
        let raw = RefCell::new(
            Vec::<(String, Option<String>, String, i64, i64, i64, TorrentStatsState, bool, i64)>::new(),
        );

        let base = self.base_path.clone();
        self.session.with_torrents(|iter| {
            for (_, handle) in iter {
                let stats = handle.stats();
                let info_hash = handle.info_hash().as_string();
                let name = handle.name();
                let save_path = base.to_string_lossy().to_string();
                let num_peers = stats.live.as_ref()
                    .map(|l| l.snapshot.peer_stats.live as i64)
                    .unwrap_or(0);
                raw.borrow_mut().push((
                    info_hash,
                    name,
                    save_path,
                    stats.progress_bytes as i64,
                    stats.uploaded_bytes as i64,
                    stats.total_bytes as i64,
                    stats.state,
                    stats.finished,
                    num_peers,
                ));
            }
        });
        let raw = raw.into_inner();

        // Compute aggregate totals for rate calculation
        let total_progress: i64 = raw.iter().map(|r| r.3).sum();
        let total_uploaded: i64 = raw.iter().map(|r| r.4).sum();
        let (dlr, ulr) = inner.rate.update(total_progress, total_uploaded);

        let mut results = Vec::new();
        for (info_hash, name, save_path, progress_bytes, uploaded_bytes, total_bytes, state, finished, num_peers) in raw {
            let state_str = state_to_string(state, finished);
            let progress = if total_bytes > 0 {
                (progress_bytes as f64 / total_bytes as f64).min(1.0)
            } else {
                0.0
            };
            let remaining = if total_bytes > 0 {
                (total_bytes - progress_bytes).max(0)
            } else {
                0
            };
            let slug = hash_to_slug
                .get(&info_hash)
                .cloned()
                .unwrap_or_else(|| {
                    let n = name.as_deref().unwrap_or("unknown");
                    slug_from_name(n)
                });
            let name_display = name
                .as_deref()
                .map(slug_to_title)
                .unwrap_or_else(|| slug_to_title(&slug));

            // Per-torrent download rate for ETA
            let tdlr = if !finished {
                let t_rate = inner.torrent_rates.entry(slug.clone()).or_insert_with(RateState::new);
                let (d, _) = t_rate.update(progress_bytes, uploaded_bytes);
                d
            } else {
                inner.torrent_rates.remove(&slug);
                0
            };
            let eta = if tdlr > 0 { remaining / tdlr } else { 0 };

            let now = Instant::now();
            let seeding_secs = if finished {
                match inner.seed_times.entry(slug.clone()) {
                    std::collections::hash_map::Entry::Occupied(e) => {
                        now.duration_since(*e.get()).as_secs() as i64
                    }
                    std::collections::hash_map::Entry::Vacant(e) => {
                        e.insert(now);
                        0
                    }
                }
            } else {
                inner.seed_times.remove(&slug);
                0
            };

            results.push(TorrentStatus {
                info_hash,
                name: name_display,
                slug,
                title: String::new(),
                image: None,
                progress,
                state: state_str.to_string(),
                download_rate: dlr,
                upload_rate: ulr,
                total_download: progress_bytes,
                total_upload: uploaded_bytes,
                total_size: total_bytes,
                num_peers,
                num_seeds: 0,
                eta,
                seeding_secs,
                save_path,
                verified: false,
            });
        }

        results
    }

    pub async fn library(&self) -> Vec<LibraryEntry> {
        let inner = self.inner.lock().await;

        let mut seen = HashSet::new();
        let mut results = Vec::new();

        // Active torrents (slug_map)
        for slug in inner.slug_map.keys() {
            if sanitize_slug(slug).is_err() {
                continue;
            }
            let path = self.base_path.join(slug);
            let size = if path.is_dir() { dir_size(&path) } else { 0 };
            let title = slug_to_title(slug);
            seen.insert(slug.clone());
            results.push(LibraryEntry {
                slug: slug.clone(),
                title,
                image: None,
                size,
                developer: None,
                genre: None,
                file_count: 0,
                total_size: None,
            });
        }

        // Torrents removed this session (removed_slugs)
        for slug in &inner.removed_slugs {
            if sanitize_slug(slug).is_err() {
                continue;
            }
            if seen.contains(slug) {
                continue;
            }
            let path = self.base_path.join(slug);
            let size = if path.is_dir() { dir_size(&path) } else { 0 };
            let title = slug_to_title(slug);
            seen.insert(slug.clone());
            results.push(LibraryEntry {
                slug: slug.clone(),
                title,
                image: None,
                size,
                developer: None,
                genre: None,
                file_count: 0,
                total_size: None,
            });
        }

        // Persisted slugs (survived restart, not active or removed this session)
        for slug in &inner.persisted_slugs {
            if sanitize_slug(slug).is_err() {
                continue;
            }
            if seen.contains(slug) {
                continue;
            }
            let path = self.base_path.join(slug);
            if !path.is_dir() {
                continue;
            }
            let size = dir_size(&path);
            let title = slug_to_title(slug);
            seen.insert(slug.clone());
            results.push(LibraryEntry {
                slug: slug.clone(),
                title,
                image: None,
                size,
                developer: None,
                genre: None,
                file_count: 0,
                total_size: None,
            });
        }

        results.sort_by(|a, b| a.title.to_lowercase().cmp(&b.title.to_lowercase()));
        results
    }

    pub async fn get_save_path(&self, slug: &str) -> Option<PathBuf> {
        sanitize_slug(slug).ok()?;
        let inner = self.inner.lock().await;
        let base = self.base_path.clone();
        drop(inner);

        let direct = base.join(slug);
        if direct.is_dir() {
            return Some(direct);
        }

        let slug_owned = slug.to_string();
        if let Ok(entries) = std::fs::read_dir(&base) {
            let target = slug_owned.replace('_', " ").to_lowercase();
            for entry in entries.flatten() {
                let path = entry.path();
                if !path.is_dir() {
                    continue;
                }
                let name = path
                    .file_name()
                    .and_then(|n| n.to_str())
                    .unwrap_or("")
                    .to_lowercase();
                if sanitize_slug(&name.replace(' ', "_")).is_err() {
                    continue;
                }
                if name == target || name.contains(&target) || target.contains(&name) {
                    return Some(path);
                }
            }
        }

        None
    }

    pub fn download_dir_exists(&self, slug: &str) -> bool {
        if sanitize_slug(slug).is_err() {
            return false;
        }
        let path = self.base_path.join(slug);
        path.is_dir()
    }

    pub fn delete_download_dir(&self, slug: &str) -> Result<(), String> {
        sanitize_slug(slug)?;
        let path = self.base_path.join(slug);
        check_path_under_base(&path, &self.base_path)?;
        if path.is_dir() {
            std::fs::remove_dir_all(&path).map_err(|e| e.to_string())
        } else {
            Ok(())
        }
    }

    pub fn update_limits(&self, down_limit: i64, up_limit: i64) {
        use std::num::NonZeroU32;
        self.session.ratelimits.set_download_bps(
            if down_limit > 0 { NonZeroU32::new((down_limit * 1024) as u32) } else { None },
        );
        self.session.ratelimits.set_upload_bps(
            if up_limit > 0 { NonZeroU32::new((up_limit * 1024) as u32) } else { None },
        );
    }

    pub async fn library_delete(&self, slug: &str) -> Result<(), String> {
        sanitize_slug(slug)?;
        let mut inner = self.inner.lock().await;

        if let Some(info_hash) = inner.slug_map.remove(slug) {
            if let Ok(hash) = TorrentIdOrHash::parse(&info_hash) {
                self.session
                    .delete(hash, true)
                    .await
                    .map_err(|e| e.to_string())?;
            }
        }

        inner.removed_slugs.retain(|s| s != slug);
        inner.persisted_slugs.remove(slug);
        self.save_persisted(&inner);
        drop(inner);

        let base = self.base_path.clone();
        let slug_owned = slug.to_string();
        tokio::task::spawn_blocking(move || -> Result<(), String> {
            let slug_path = base.join(&slug_owned);
            if slug_path.exists() {
                return std::fs::remove_dir_all(&slug_path).map_err(|e| e.to_string());
            }
            if let Ok(entries) = std::fs::read_dir(&base) {
                let target = slug_owned.replace('_', " ").to_lowercase();
                for entry in entries.flatten() {
                    let p = entry.path();
                    if p.is_dir() {
                        let name = p
                            .file_name()
                            .and_then(|n| n.to_str())
                            .unwrap_or("")
                            .to_lowercase();
                        if sanitize_slug(&name.replace(' ', "_")).is_err() {
                            continue;
                        }
                        if name == target
                            || name.contains(&target)
                            || target.contains(&name)
                        {
                            return std::fs::remove_dir_all(&p).map_err(|e| e.to_string());
                        }
                    }
                }
            }
            Ok(())
        })
        .await
        .map_err(|e| e.to_string())?
    }
}

fn load_library_file(path: &std::path::Path) -> HashSet<String> {
    if let Ok(content) = std::fs::read_to_string(path) {
        if let Ok(set) = serde_json::from_str::<HashSet<String>>(&content) {
            return set;
        }
    }
    HashSet::new()
}

fn save_library_file(path: &std::path::Path, slugs: &HashSet<String>) {
    if let Ok(content) = serde_json::to_string(slugs) {
        let _ = std::fs::write(path, &content);
    }
}

fn sanitize_slug(slug: &str) -> Result<(), String> {
    if slug.is_empty() {
        return Err("Slug is empty".into());
    }
    if slug.contains('/') || slug.contains('\\') || slug.contains("..") || slug.contains('\0') {
        return Err(format!("Invalid slug: '{slug}' — path traversal detected"));
    }
    if !slug.chars().all(|c| c.is_alphanumeric() || c == '_' || c == '-') {
        return Err(format!("Invalid slug: '{slug}' — only alphanumeric, hyphens, and underscores allowed"));
    }
    Ok(())
}

fn check_path_under_base(path: &std::path::Path, base: &std::path::Path) -> Result<(), String> {
    let canon = path.canonicalize().map_err(|e| format!("Cannot resolve path: {e}"))?;
    let canon_base = base.canonicalize().map_err(|e| format!("Cannot resolve base: {e}"))?;
    if !canon.starts_with(&canon_base) {
        return Err(format!("Path {canon:?} is outside base directory {canon_base:?}"));
    }
    Ok(())
}

fn slug_from_name(name: &str) -> String {
    name.to_lowercase().replace(' ', "_")
}

fn slug_to_title(slug: &str) -> String {
    slug.replace('_', " ")
}

fn dir_size(path: &std::path::Path) -> i64 {
    let mut total = 0i64;
    if let Ok(entries) = std::fs::read_dir(path) {
        for entry in entries.flatten() {
            let p = entry.path();
            if p.is_dir() {
                total += dir_size(&p);
            } else if let Ok(meta) = std::fs::metadata(&p) {
                total += meta.len() as i64;
            }
            }
    }
    total
}
