use librqbit::{
    limits::LimitsConfig, ConnectionOptions, DhtSessionConfig, ListenerMode, ListenerOptions,
    SessionOptions,
};
use serde::{Deserialize, Serialize};
use std::fs;
use std::net::SocketAddr;
use std::num::NonZeroU32;
use std::path::PathBuf;
use std::str::FromStr;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Settings {
    pub download_dir: String,
    pub dht: bool,
    pub lsd: bool,
    pub accent_color: String,
    pub download_rate_limit: i64,
    pub upload_rate_limit: i64,
    pub proxy_url: String,
    pub max_peers: i64,
    pub listen_port: i64,
    pub seed_ratio: f64,
    pub seed_hours: i64,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            download_dir: dirs::download_dir()
                .unwrap_or_else(|| PathBuf::from("."))
                .to_string_lossy()
                .to_string(),
            dht: true,
            lsd: true,
            accent_color: "#4fc3f7".to_string(),
            download_rate_limit: 0,
            upload_rate_limit: 0,
            proxy_url: String::new(),
            max_peers: 0,
            listen_port: 0,
            seed_ratio: 0.0,
            seed_hours: 0,
        }
    }
}

impl Settings {
    fn config_path() -> PathBuf {
        dirs::config_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join("gog-archive")
            .join("config.json")
    }

    pub fn load() -> Self {
        let path = Self::config_path();
        if !path.exists() {
            let default = Self::default();
            let _ = default.save();
            return default;
        }
        match fs::read_to_string(&path) {
            Ok(content) => serde_json::from_str(&content).unwrap_or_default(),
            Err(_) => Self::default(),
        }
    }

    pub fn save(&self) -> Result<(), String> {
        let path = Self::config_path();
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let content = serde_json::to_string_pretty(self).map_err(|e| e.to_string())?;
        fs::write(&path, content).map_err(|e| e.to_string())
    }

    pub fn to_session_options(&self) -> SessionOptions {
        let listen_port = if self.listen_port > 0 {
            self.listen_port as u16
        } else {
            0
        };
        SessionOptions {
            dht: if self.dht {
                Some(DhtSessionConfig::default())
            } else {
                None
            },
            disable_local_service_discovery: !self.lsd,
            listen: Some(ListenerOptions {
                listen_addr: SocketAddr::from_str(&format!("0.0.0.0:{listen_port}"))
                    .unwrap_or_else(|_| SocketAddr::from_str("0.0.0.0:0").unwrap()),
                mode: ListenerMode::TcpOnly,
                enable_upnp_port_forwarding: false,
                utp_opts: None,
                announce_port: None,
                ipv4_only: false,
                max_pending_incoming_handshake_checks: 100,
            }),
            connect: if self.proxy_url.is_empty() {
                None
            } else {
                Some(ConnectionOptions {
                    proxy_url: Some(self.proxy_url.clone()),
                    enable_tcp: true,
                    peer_opts: None,
                })
            },
            ratelimits: LimitsConfig {
                upload_bps: NonZeroU32::new((self.upload_rate_limit * 1024) as u32),
                download_bps: NonZeroU32::new((self.download_rate_limit * 1024) as u32),
            },
            peer_limit: if self.max_peers > 0 {
                Some(self.max_peers as usize)
            } else {
                None
            },
            ..Default::default()
        }
    }
}
