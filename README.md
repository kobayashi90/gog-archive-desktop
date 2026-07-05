# GOG Archive Desktop

A cross-platform desktop application for browsing, searching, and downloading games from the GOG catalog via BitTorrent. Built with [Tauri 2](https://v2.tauri.app/) and [Svelte 4](https://svelte.dev/).

> In cooperation with [Privateers.Wiki](https://privateers.wiki)

## Features

### Browse & Discover
- Browse the full GOG game catalog with grid view (responsive: 6/4/2 columns)
- Full-text search with 300ms debounce for instant results
- Advanced multi-criteria filtering: genre, tags, developer, publisher, year
- Autocomplete suggestions while typing
- Sort by popularity (default), name, date, rating
- Smart pagination with page range preview
- Clickable metadata (developer, publisher, year, genres, tags) for one-click filtering

### Game Details
- Rich game detail modal with cover art, rating, developer, publisher, year
- Genre and tag badges (clickable to filter)
- Torrent file selection — preview contents and choose specific files before downloading
- File listing with size breakdown and "Show all N files" expansion
- External links: GOG page, GOGDB, PCGamingWiki
- Pre-download conflict detection — warns if download folder already exists

### Download Management
- Full BitTorrent client built in (powered by librqbit)
- Per-torrent progress bar with ETA
- Pause / Resume individual torrents or all at once
- File selection before download (choose which files to include)
- Download speed smoothed over a 5-second rolling window (like Steam)
- Persistent bottom bar showing active download, aggregate speed, and resume/pause

### Library
- Persistent library tracking across restarts
- Per-game disk usage display ("X GB on disk")
- Open game folder in file manager
- Delete from library (removes torrent + all files on disk)
- Download verification — checks downloaded size against expected archive size

### Settings
- Configurable download directory (native folder picker)
- Download and upload speed limits (kB/s)
- DHT and LSD enable/disable
- SOCKS5 proxy support
- Listen port configuration (0 = random)
- Maximum peers per torrent
- Seed ratio and seed time limits (auto-stop seeding)

### System Integration
- Custom frameless window with dark titlebar
- System tray with quick-access menu
- Tray tooltip with live download progress and speed
- Toast notifications (success, error, info)
- Confirmation dialogs for destructive actions
- Cross-platform: Linux, Windows, macOS

## Screenshots

*(add screenshots here)*

## Installation

### Linux
Download the `.deb` (Debian/Ubuntu) or `.rpm` (Fedora/RHEL) from the [releases page](https://github.com/kobayashi90/gog-archive-desktop/releases).

```bash
# Debian / Ubuntu
sudo dpkg -i GOG.Archive.Desktop_*.amd64.deb

# Fedora / RHEL
sudo rpm -i GOG.Archive.Desktop-*.x86_64.rpm
```

An AppImage build is also available for other distributions.

**Requirements**: glibc >= 2.35 (Ubuntu 22.04+, Debian 12+, Fedora 37+).

### Windows
Download the `.msi` or `.exe` installer from the [releases page](https://github.com/kobayashi90/gog-archive-desktop/releases).

## Build from Source

### Prerequisites
- [Node.js](https://nodejs.org/) 24+
- [pnpm](https://pnpm.io/)
- [Rust](https://www.rust-lang.org/) (stable)
- [Tauri 2 system dependencies](https://v2.tauri.app/start/prerequisites/)

#### Linux dependencies (Debian/Ubuntu)
```bash
sudo apt-get install -y \
  libwebkit2gtk-4.1-dev \
  build-essential \
  libssl-dev \
  libgtk-3-dev \
  libayatana-appindicator3-dev \
  librsvg2-dev \
  libjavascriptcoregtk-4.1-dev \
  libsoup-3.0-dev
```

### Build
```bash
git clone https://github.com/kobayashi90/gog-archive-desktop.git
cd gog-archive-desktop
pnpm install
pnpm tauri build
```

Build artifacts will be in `src-tauri/target/release/bundle/`.

## Configuration

Settings are stored in `~/.config/gog-archive/config.json` and can also be edited manually. Default location:

| Platform | Config Path |
|----------|------------|
| Linux    | `~/.config/gog-archive/config.json` |
| macOS    | `~/Library/Application Support/gog-archive/config.json` |
| Windows  | `%APPDATA%/gog-archive/config.json` |

## Technology Stack

| Layer | Technology |
|-------|-----------|
| Desktop Shell | [Tauri 2](https://v2.tauri.app/) |
| Frontend | [Svelte 4](https://svelte.dev/) |
| Backend | [Rust](https://www.rust-lang.org/) |
| BitTorrent | [librqbit](https://github.com/ikatson/rqbit) (rqbit) |
| API Client | [reqwest](https://docs.rs/reqwest/) |
| Build | [Vite](https://vitejs.dev/) + [pnpm](https://pnpm.io/) |

### API
Game metadata is sourced from `https://gog.squid.wtf/api`:
- `GET /api/games` — search and paginate the catalog
- `GET /api/games/{slug}` — full game details
- `GET /api/filters` — available filter facets (genres, tags, developers, publishers, years)

## Credits

- Built in cooperation with [Privateers.Wiki](https://privateers.wiki)
- Game catalog API by [squid.wtf](https://squid.wtf)
- BitTorrent engine by [ikatson/rqbit](https://github.com/ikatson/rqbit)

## License

MIT
