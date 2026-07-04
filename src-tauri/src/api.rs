use serde::{Deserialize, Serialize};
use std::collections::HashMap;

const BASE_URL: &str = "https://gog.squid.wtf/api";

#[derive(Debug, Clone, Serialize)]
pub struct Game {
    pub slug: String,
    pub title: String,
    pub image: Option<String>,
    pub magnet_link: Option<String>,
    pub files: String,
    pub file_count: i64,
    pub total_size: Option<i64>,
    pub description: Option<String>,
    pub genres: Option<String>,
    pub raw_genres: Option<String>,
    pub release_date: Option<String>,
    pub developer: Option<String>,
    pub publisher: Option<String>,
    pub gog_url: Option<String>,
    pub gogdb_url: Option<String>,
    pub pcgamingwiki_url: Option<String>,
    pub hardware: String,
    pub raw_tags: String,
    pub notes: Option<String>,
    pub rating: Option<f64>,
}

#[derive(Debug, Clone, Serialize)]
pub struct SearchResult {
    pub games: Vec<Game>,
    pub total: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct FilterOptions {
    pub genres: Vec<String>,
    pub tags: Vec<String>,
    pub developers: Vec<String>,
    pub publishers: Vec<String>,
    pub years: Vec<String>,
}

#[derive(Debug, Deserialize)]
struct ApiGame {
    slug: String,
    title: String,
    image: Option<String>,
    magnet_link: Option<String>,
    files: Option<HashMap<String, Vec<ApiFileEntry>>>,
    genres: Option<Vec<String>>,
    tags: Option<Vec<String>>,
    release_timestamp: Option<i64>,
    developer: Option<String>,
    publisher: Option<String>,
    gog_url: Option<String>,
    gogdb_url: Option<String>,
    pcgamingwiki_url: Option<String>,
    rating: Option<f64>,
}

#[derive(Debug, Serialize, Deserialize)]
struct ApiFileEntry {
    name: String,
    size: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ApiSearchResponse {
    games: Vec<ApiGame>,
    total: i64,
}

#[derive(Debug, Deserialize)]
struct ApiFiltersResponse {
    genres: Vec<String>,
    tags: Vec<String>,
    developers: Vec<String>,
    publishers: Vec<String>,
    years: Vec<String>,
}

#[derive(Clone)]
pub struct ApiClient {
    client: reqwest::Client,
}

impl ApiClient {
    pub fn new() -> Self {
        Self {
            client: reqwest::Client::builder()
                .user_agent("gog-archive/1.0")
                .timeout(std::time::Duration::from_secs(30))
                .build()
                .expect("Failed to create HTTP client"),
        }
    }

    pub async fn search_games(
        &self,
        query: &str,
        limit: i64,
        offset: i64,
        genre: Option<&str>,
        tag: Option<&str>,
        developer: Option<&str>,
        publisher: Option<&str>,
        year: Option<&str>,
        sort: &str,
        order: &str,
    ) -> Result<SearchResult, String> {
        let page = if limit > 0 { (offset / limit).max(0) + 1 } else { 1 };

        let mut query_params: Vec<(&str, String)> = Vec::new();
        query_params.push(("limit", limit.to_string()));
        query_params.push(("page", page.to_string()));

        if !query.is_empty() {
            query_params.push(("search", query.to_string()));
        }
        if let Some(g) = genre {
            for val in g.split("||") {
                let v = val.trim();
                if !v.is_empty() {
                    query_params.push(("genre", v.to_string()));
                }
            }
        }
        if let Some(t) = tag {
            for val in t.split("||") {
                let v = val.trim();
                if !v.is_empty() {
                    query_params.push(("tag", v.to_string()));
                }
            }
        }
        if let Some(d) = developer {
            for val in d.split("||") {
                let v = val.trim();
                if !v.is_empty() {
                    query_params.push(("developer", v.to_string()));
                }
            }
        }
        if let Some(p) = publisher {
            for val in p.split("||") {
                let v = val.trim();
                if !v.is_empty() {
                    query_params.push(("publisher", v.to_string()));
                }
            }
        }
        if let Some(y) = year {
            for val in y.split("||") {
                let v = val.trim();
                if !v.is_empty() {
                    query_params.push(("year", v.to_string()));
                }
            }
        }
        if !sort.is_empty() && sort != "popularity_ranking" {
            query_params.push(("sort", sort.to_string()));
            if !order.is_empty() {
                query_params.push(("order", order.to_string()));
            }
        }

        let url = format!("{}/games", BASE_URL);
        let resp = self
            .client
            .get(&url)
            .query(&query_params)
            .send()
            .await
            .map_err(|e| format!("API request failed: {e}"))?;

        if !resp.status().is_success() {
            return Err(format!("API returned {}", resp.status()));
        }

        let api_resp: ApiSearchResponse = resp
            .json()
            .await
            .map_err(|e| format!("Failed to parse API response: {e}"))?;

        let games: Vec<Game> = api_resp
            .games
            .into_iter()
            .map(convert_game)
            .collect();

        Ok(SearchResult {
            games,
            total: api_resp.total,
        })
    }

    pub async fn get_game(&self, slug: &str) -> Result<Option<Game>, String> {
        let url = format!("{BASE_URL}/games/{slug}");
        let resp = self
            .client
            .get(&url)
            .send()
            .await
            .map_err(|e| format!("API request failed: {e}"))?;

        if resp.status() == reqwest::StatusCode::NOT_FOUND {
            return Ok(None);
        }
        if !resp.status().is_success() {
            return Err(format!("API returned {}", resp.status()));
        }

        let api_game: ApiGame = resp
            .json()
            .await
            .map_err(|e| format!("Failed to parse API response: {e}"))?;

        Ok(Some(convert_game(api_game)))
    }

    pub async fn search_games_by_title(&self, title: &str, limit: i64) -> Result<Vec<Game>, String> {
        let result = self
            .search_games(title, limit, 0, None, None, None, None, None, "title", "ASC")
            .await?;
        Ok(result.games)
    }

    pub async fn search_suggestions(&self, query: &str, limit: i64) -> Result<Vec<Game>, String> {
        let result = self
            .search_games(query, limit, 0, None, None, None, None, None, "title", "ASC")
            .await?;
        Ok(result.games)
    }

    pub async fn get_filters(&self) -> Result<FilterOptions, String> {
        let url = format!("{BASE_URL}/filters");
        let resp = self
            .client
            .get(&url)
            .send()
            .await
            .map_err(|e| format!("API request failed: {e}"))?;

        if !resp.status().is_success() {
            return Err(format!("API returned {}", resp.status()));
        }

        let filters: ApiFiltersResponse = resp
            .json()
            .await
            .map_err(|e| format!("Failed to parse filters: {e}"))?;

        Ok(FilterOptions {
            genres: filters.genres,
            tags: filters.tags,
            developers: filters.developers,
            publishers: filters.publishers,
            years: filters.years,
        })
    }
}

fn convert_game(api: ApiGame) -> Game {
    let (file_count, total_size) = compute_file_info(&api.files);
    let genres = api.genres.as_ref().map(|v| v.join(", "));
    let raw_genres = api.genres.as_ref().map(|v| serde_json::to_string(v).unwrap_or_default());
    let release_date = api.release_timestamp.and_then(format_timestamp);
    let hardware = api.tags.as_ref().map(|v| v.join(", ")).unwrap_or_default();
    let raw_tags = api.tags.map(|v| serde_json::to_string(&v).unwrap_or_default()).unwrap_or_default();
    let files = api.files.map(|v| serde_json::to_string(&v).unwrap_or_default()).unwrap_or_default();

    Game {
        slug: api.slug,
        title: api.title,
        image: api.image,
        magnet_link: api.magnet_link,
        files,
        file_count,
        total_size,
        description: None,
        genres,
        raw_genres,
        release_date,
        developer: api.developer,
        publisher: api.publisher,
        gog_url: api.gog_url,
        gogdb_url: api.gogdb_url,
        pcgamingwiki_url: api.pcgamingwiki_url,
        hardware,
        raw_tags,
        notes: None,
        rating: api.rating,
    }
}

fn compute_file_info(files: &Option<HashMap<String, Vec<ApiFileEntry>>>) -> (i64, Option<i64>) {
    let map = match files {
        Some(m) if !m.is_empty() => m,
        _ => return (0, None),
    };

    let mut count: i64 = 0;
    let mut total_bytes: f64 = 0.0;

    for (_category, entries) in map {
        for entry in entries {
            count += 1;
            if let Some(ref size_str) = entry.size {
                let size_str = size_str.trim();
                let (num_str, unit) = if let Some(idx) = size_str.rfind(' ') {
                    size_str.split_at(idx)
                } else {
                    (size_str, "")
                };
                let num: f64 = num_str.trim().parse().unwrap_or(0.0);
                let unit = unit.trim().to_lowercase();
                let bytes = match unit.as_str() {
                    "tb" => num * 1_099_511_627_776.0,
                    "gb" => num * 1_073_741_824.0,
                    "mb" => num * 1_048_576.0,
                    "kb" => num * 1_024.0,
                    _ => num,
                };
                total_bytes += bytes;
            }
        }
    }

    (count, Some(total_bytes as i64))
}

fn format_timestamp(ts: i64) -> Option<String> {
    if ts == 0 {
        return None;
    }
    use chrono::TimeZone;
    chrono::Utc
        .timestamp_opt(ts, 0)
        .single()
        .map(|dt| dt.format("%Y-%m-%d").to_string())
}
