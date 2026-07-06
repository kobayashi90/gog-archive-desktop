<script>
  import { onMount } from "svelte";
  import { invoke } from "@tauri-apps/api/core";
  import { showConfirm, showToast } from "./stores.js";

  let { game, onclose, onnavigateTo, onfilterGenre, onfilterTag, onfilterDeveloper, onfilterPublisher, onfilterYear } = $props();

  let installing = $state(false);
  let addStatus = $state(null);
  let addError = $state(null);
  let navigateTimer = $state(null);
  let showAllFiles = $state(false);
  let files = $state([]);
  let totalFiles = $state(0);
  let genres = $state([]);
  let tags = $state([]);
  let imageError = $state(false);
  let torrentFiles = $state([]);
  let selectedFiles = $state(new Set());
  let previewing = $state(false);
  let showFileSelector = $state(false);
  let freeBytes = $state(0);

  let skipFileSelector = $state(false);

  let selectedTotal = $derived(
    freeBytes > 0 && torrentFiles.length > 0
      ? torrentFiles.filter(f => selectedFiles.has(f.index)).reduce((a, f) => a + f.size, 0)
      : 0
  );
  let notEnoughSpace = $derived(selectedTotal > freeBytes);

  onMount(() => {
    parseFiles();
    parseGenres();
    parseTags();
    invoke("get_settings").then(s => { skipFileSelector = s.skip_file_selector; }).catch(() => {});
  });

  function parseFiles() {
    if (game.files) {
      try {
        const parsed = typeof game.files === "string" ? JSON.parse(game.files) : game.files;
        const gameFiles = parsed.game || [];
        const goodies = parsed.goodie || [];
        const mapped = [
          ...gameFiles.map((f) => ({ ...f, type: "game" })),
          ...goodies.map((f) => ({ ...f, type: "goodie" })),
        ];
        files = mapped;
        totalFiles = mapped.length;
      } catch (e) {
        files = [];
      }
    }
  }

  function parseGenres() {
    if (!game.raw_genres) return;
    try {
      genres = JSON.parse(game.raw_genres);
    } catch (e) {
      genres = [];
    }
  }

  function parseTags() {
    if (!game.raw_tags) return;
    try {
      tags = JSON.parse(game.raw_tags);
    } catch (e) {
      tags = [];
    }
  }

  function formatSize(size) {
    if (!size) return "\u2014";
    const units = ["B", "KB", "MB", "GB", "TB"];
    let i = 0, v = size;
    while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
    return v.toFixed(v >= 10 ? 0 : 1) + " " + units[i];
  }

  function fmtSizeStr(s) {
    if (!s) return "";
    if (typeof s === "number") {
      const n = s;
      if (n < 1024) return n.toFixed(1) + " B";
      if (n < 1024 ** 2) return (n / 1024).toFixed(1) + " KB";
      if (n < 1024 ** 3) return (n / 1024 ** 2).toFixed(1) + " MB";
      return (n / 1024 ** 3).toFixed(2) + " GB";
    }
    return s;
  }

  function fmtRating(r) {
    if (!r) return "";
    const full = Math.round(r);
    return "\u2605".repeat(full) + "\u2606".repeat(5 - full);
  }

  function fmtYear(ts) {
    if (!ts) return "";
    const d = new Date(ts * 1000);
    return d.getFullYear();
  }

  async function download() {
    if (!game.magnet_link) return;
    try {
      const exists = await invoke("check_download_dir", { slug: game.slug });
      if (exists) {
        const confirmed = await new Promise((resolve) => {
          showConfirm(
            `Delete existing folder for "${game.title}"?`,
            `A download folder for this game already exists. Delete it and start fresh, or cancel?`,
            () => resolve(true),
            () => resolve(false),
            "Delete folder",
          );
        });
        if (!confirmed) return;
        await invoke("delete_download_dir", { slug: game.slug });
      }
    } catch (e) {
      showToast(`Failed to prepare download: ${e}`, "error");
      return;
    }
    if (skipFileSelector) {
      installing = true;
      addStatus = null;
      addError = null;
      try {
        await invoke("torrent_add", { magnet: game.magnet_link, slug: game.slug });
        addStatus = "success";
        navigateTimer = setTimeout(() => {
          onnavigateTo?.("queue");
          onclose?.();
        }, 1500);
      } catch (e) {
        addStatus = "error";
        addError = String(e);
        console.error(e);
      }
      installing = false;
      return;
    }
    previewing = true;
    showFileSelector = false;
    addStatus = null;
    try {
      const preview = await invoke("torrent_preview", { magnet: game.magnet_link });
      torrentFiles = preview.files;
      freeBytes = preview.free_bytes;
      selectedFiles = new Set(torrentFiles.map((f) => f.index));
      showFileSelector = true;
    } catch (e) {
      showToast(`Failed to read torrent files: ${e}`, "error");
    }
    previewing = false;
  }

  function toggleFile(idx) {
    const next = new Set(selectedFiles);
    if (next.has(idx)) { next.delete(idx); } else { next.add(idx); }
    selectedFiles = next;
  }

  function toggleAll() {
    if (selectedFiles.size === torrentFiles.length) {
      selectedFiles = new Set();
    } else {
      selectedFiles = new Set(torrentFiles.map((f) => f.index));
    }
  }

  async function startDownload() {
    if (selectedFiles.size === 0) return;
    installing = true;
    addStatus = null;
    try {
      await invoke("torrent_add", {
        magnet: game.magnet_link,
        slug: game.slug,
        selectedFiles: Array.from(selectedFiles),
      });
      addStatus = "success";
      navigateTimer = setTimeout(() => {
        onnavigateTo?.("queue");
        onclose?.();
      }, 1500);
    } catch (e) {
      addStatus = "error";
      addError = String(e);
      console.error(e);
    }
    installing = false;
  }

  function close() {
    clearTimeout(navigateTimer);
    onclose?.();
  }

  function handleOverlayClick(e) {
    if (e.target === e.currentTarget || e.target.classList.contains('modal-backdrop')) close();
  }

  function handleKeydown(e) { if (e.key === "Escape") close(); }

  function visibleFiles() {
    if (showAllFiles || files.length <= 8) return files;
    return files.slice(0, 8);
  }

  function hiddenFiles() {
    if (showAllFiles || files.length <= 8) return [];
    return files.slice(8);
  }

  function handleImageError() { imageError = true; }

  let letter = $derived(game.title ? game.title[0].toUpperCase() : "?");
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="modal-backdrop" onclick={handleOverlayClick} role="presentation">
  <div class="modal-content" role="dialog">
    <button class="modal-close" onclick={close} aria-label="Close">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
      </svg>
    </button>
    <div class="modal-scroll">
    <div class="detail-header">
      <div class="detail-cover" class:no-image={!game.image || imageError}>
        {#if game.image && !imageError}
          <img src={game.image} alt={game.title} onerror={handleImageError} />
        {/if}
        <div class="cover-letter">{letter}</div>
      </div>
      <div class="detail-info">
        <h2>{game.title}</h2>
        <div class="dev-pub">
          {#if game.developer}
            <button type="button" class="dev-link" onclick={() => onfilterDeveloper?.(game.developer)}>{game.developer}</button>
          {/if}
          {#if game.developer && game.publisher} &middot; {/if}
          {#if game.publisher}
            <button type="button" class="pub-link" onclick={() => onfilterPublisher?.(game.publisher)}>{game.publisher}</button>
          {/if}
          {#if game.release_date}
            &middot; <button type="button" class="year-link" onclick={() => onfilterYear?.(game.release_date.slice(0, 4))}>{game.release_date.slice(0, 4)}</button>
          {/if}
        </div>
        <div class="detail-rating">
          <span class="stars">{fmtRating(game.rating)}</span>
          <span class="rating-num">{game.rating ? game.rating.toFixed(1) + '/5' : 'No ratings'}</span>
        </div>
        {#if genres.length > 0 || tags.length > 0}
          <div class="tag-group">
            {#each genres as g}
              <button type="button" class="tag genre" onclick={() => onfilterGenre?.(g)}>{g}</button>
            {/each}
            {#each tags as t}
              <button type="button" class="tag tag-item" onclick={(e) => { e.stopPropagation(); onfilterTag?.(t); }}>{t}</button>
            {/each}
          </div>
        {/if}
      </div>
    </div>

    <div class="detail-body">
      {#if game.magnet_link}
        <div class="detail-section">
          <h3>Torrent</h3>
          {#if addStatus === "success"}
            <div class="add-status success">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>
              Added &mdash; switching to Downloads...
            </div>
          {:else if addStatus === "error"}
            <div class="add-status error">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
              <div>
                Failed to add torrent
                {#if addError}
                  <div class="error-detail">{addError}</div>
                {/if}
              </div>
            </div>
            <button class="download-torrent-btn" onclick={startDownload}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
              Retry
            </button>
          {:else if showFileSelector}
            <div class="torrent-file-select">
              <div class="file-select-header">
                <label class="toggle-all">
                  <input type="checkbox" checked={selectedFiles.size === torrentFiles.length} onchange={toggleAll} />
                  {selectedFiles.size}/{torrentFiles.length} files selected
                </label>
                <span class="total-size">{formatSize(torrentFiles.reduce((a, f) => a + f.size, 0))}</span>
              </div>
              <div class="torrent-files-list">
                {#each torrentFiles as f}
                  <label class="torrent-file-item" class:selected={selectedFiles.has(f.index)}>
                    <input type="checkbox" checked={selectedFiles.has(f.index)} onchange={() => toggleFile(f.index)} />
                    <span class="file-name">{f.name}</span>
                    <span class="file-size">{formatSize(f.size)}</span>
                  </label>
                {/each}
              </div>
              {#if freeBytes > 0}
                {#if selectedTotal > freeBytes}
                  <div class="disk-warning">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                    Not enough disk space — need {formatSize(selectedTotal)}, only {formatSize(freeBytes)} free
                  </div>
                {/if}
              {/if}
              <div class="file-select-actions">
                <button class="download-torrent-btn" onclick={startDownload} disabled={installing || selectedFiles.size === 0 || notEnoughSpace}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
                    <polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
                  </svg>
                  {installing ? "Adding..." : `Download selected (${selectedFiles.size})`}
                </button>
                <button class="cancel-select-btn" onclick={() => { showFileSelector = false; }}>Cancel</button>
              </div>
            </div>
          {:else if previewing}
            <div class="add-status">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="spin"><path d="M21 12a9 9 0 11-6.219-8.56"/></svg>
              Reading torrent files...
            </div>
          {:else}
            <button class="download-torrent-btn" onclick={download} disabled={installing}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
                <polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
              </svg>
              Download via Torrent
            </button>
          {/if}
        </div>
      {:else}
        <div class="detail-section">
          <h3>Torrent</h3>
          <p class="no-downloads">No torrent available</p>
        </div>
      {/if}

      {#if files.length > 0}
        <div class="detail-section">
          <h3>Files{totalFiles > 1 ? ` (${totalFiles})` : ''}</h3>
          <div class="files-list">
            {#each visibleFiles() as f}
              <div class="file-item">
                <span class="name" title={f.name}>{f.name?.length > 65 ? f.name.slice(0, 65) + '...' : f.name || '\u2014'}</span>
                {#if f.type === "goodie"}
                  <span class="goodie-tag">(extra)</span>
                {/if}
                <span class="file-right">
                  <span class="size">{fmtSizeStr(f.size)}</span>
                </span>
              </div>
            {/each}
          </div>
          {#if hiddenFiles().length > 0}
            <div id="filesExtra" class="files-extra" class:open={showAllFiles}>
              {#each hiddenFiles() as f}
                <div class="file-item">
                  <span class="name" title={f.name}>{f.name?.length > 65 ? f.name.slice(0, 65) + '...' : f.name || '\u2014'}</span>
                  {#if f.type === "goodie"}
                    <span class="goodie-tag">(extra)</span>
                  {/if}
                  <span class="file-right">
                    <span class="size">{fmtSizeStr(f.size)}</span>
                  </span>
                </div>
              {/each}
            </div>
            <button class="files-toggle" onclick={() => (showAllFiles = !showAllFiles)}>
              {showAllFiles ? 'Show less' : `Show all ${totalFiles} files`}
            </button>
          {/if}
        </div>
      {/if}

      {#if game.gog_url || game.gogdb_url || game.pcgamingwiki_url}
        <div class="detail-section links-section">
          <div class="link-group">
            {#if game.gog_url}
              <button type="button" class="ext-link" onclick={() => invoke("open_url", { url: game.gog_url })}>GOG</button>
            {/if}
            {#if game.gogdb_url}
              <button type="button" class="ext-link" onclick={() => invoke("open_url", { url: game.gogdb_url })}>GOGDB</button>
            {/if}
            {#if game.pcgamingwiki_url}
              <button type="button" class="ext-link" onclick={() => invoke("open_url", { url: game.pcgamingwiki_url })}>PCGamingWiki</button>
            {/if}
          </div>
        </div>
      {/if}
    </div>
    </div>
  </div>
</div>

<style>
  .modal-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0,0,0,.85);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 80px 40px;
  }

  .modal-content {
    position: relative;
    width: 100%;
    max-width: 860px;
    margin: 0 auto;
    background: #000;
    border: 1px solid var(--border);
    border-radius: 16px;
    box-shadow: var(--shadow);
    animation: modalIn .3s cubic-bezier(.22,1,.36,1);
    overflow: hidden;
  }

  .modal-scroll {
    max-height: calc(100vh - 280px);
    overflow-x: hidden;
    overflow-y: auto;
  }

  @keyframes modalIn {
    from { opacity: 0; transform: scale(.95) translateY(10px); }
    to { opacity: 1; transform: scale(1) translateY(0); }
  }

  .modal-close {
    position: absolute;
    top: 14px;
    right: 14px;
    z-index: 10;
    width: 36px;
    height: 36px;
    display: flex;
    align-items: center;
    justify-content: center;
    border: 1px solid var(--border);
    border-radius: 50%;
    background: rgba(0,0,0,.85);
    color: var(--text-muted);
    cursor: pointer;
    transition: all .2s;
  }

  .modal-close:hover {
    background: var(--surface-hover);
    color: var(--text);
    border-color: var(--border-hover);
  }

  .detail-header {
    display: flex;
    gap: 20px;
    padding: 24px 32px 16px;
  }

  .detail-cover {
    flex-shrink: 0;
    width: 180px;
    border-radius: 10px;
    overflow: hidden;
  }

  .detail-cover img {
    width: 100%;
    height: auto;
    display: block;
    border-radius: 10px;
  }

  .cover-letter {
    display: none;
    align-items: center;
    justify-content: center;
    aspect-ratio: 3/4;
    font-size: 3rem;
    font-weight: 700;
    color: var(--text-muted);
    background: linear-gradient(135deg, #1a1a2e, #2d1b4e);
    border-radius: 10px;
  }

  .no-image .cover-letter {
    display: flex;
  }

  .no-image img {
    display: none;
  }

  .detail-info {
    flex: 1;
    min-width: 0;
  }

  .detail-info h2 {
    font-size: 1.35rem;
    font-weight: 700;
    margin-bottom: 2px;
    line-height: 1.3;
  }

  .dev-pub {
    font-size: .85rem;
    color: var(--text-muted);
    margin-bottom: 6px;
  }

  .dev-link {
    color: var(--accent2);
    cursor: pointer;
    border-bottom: 1px dashed transparent;
    transition: all .15s;
  }

  .dev-link:hover {
    border-bottom-color: var(--accent2);
  }

  .pub-link {
    color: var(--text-muted);
    cursor: pointer;
    border-bottom: 1px dashed transparent;
    transition: all .15s;
  }

  .pub-link:hover {
    border-bottom-color: var(--text-muted);
    color: var(--text);
  }

  .year-link {
    color: var(--text-muted);
    cursor: pointer;
    border-bottom: 1px dashed transparent;
    transition: all .15s;
  }

  .year-link:hover {
    border-bottom-color: var(--text-muted);
    color: var(--text);
  }

  .detail-rating {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-bottom: 8px;
  }

  .stars {
    color: #ffc107;
    font-size: .85rem;
    letter-spacing: 1px;
  }

  .rating-num {
    font-size: .82rem;
    color: var(--text-muted);
  }

  .tag-group {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }

  .tag {
    padding: 3px 9px;
    border-radius: 12px;
    font-size: .7rem;
    font-weight: 500;
    cursor: pointer;
    transition: all .2s;
    background: rgba(124,92,255,.12);
    border: 1px solid rgba(124,92,255,.2);
    color: #b3a0ff;
  }

  .tag:hover {
    background: rgba(124,92,255,.25);
    border-color: var(--accent);
    color: #c4b5ff;
  }

  .tag.genre {
    background: rgba(0,212,170,.1);
    border-color: rgba(0,212,170,.2);
    color: #5eebcb;
  }

  .tag.genre:hover {
    background: rgba(0,212,170,.2);
    border-color: var(--accent2);
  }

  .detail-body {
    padding: 0 32px 4px;
  }

  .detail-section {
    margin-bottom: 16px;
  }

  .detail-section h3 {
    font-size: .7rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: .08em;
    color: var(--text-muted);
    margin-bottom: 8px;
    padding-bottom: 6px;
    border-bottom: 1px solid var(--border);
  }

  .download-torrent-btn {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 10px 20px;
    border: 1px solid #f59e0b33;
    border-radius: 8px;
    background: rgba(245,158,11,.1);
    color: #fbbf24;
    font-size: .85rem;
    font-weight: 600;
    cursor: pointer;
    transition: all .2s;
  }

  .download-torrent-btn:hover:not(:disabled) {
    background: rgba(245,158,11,.2);
    border-color: #f59e0b66;
    color: #fcd34d;
  }

  .download-torrent-btn:disabled {
    opacity: .6;
    cursor: default;
  }

  .no-downloads {
    color: var(--text-muted);
    font-size: .82rem;
    font-style: italic;
  }

  .add-status {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    font-size: .85rem;
    font-weight: 600;
    margin-bottom: 8px;
  }

  .add-status.success {
    color: var(--accent2, #00d4aa);
  }

  .add-status.error {
    color: #ef4444;
  }

  .error-detail {
    font-size: .78em;
    opacity: .75;
    margin-top: 2px;
    word-break: break-word;
  }

  .files-list {
    display: grid;
    gap: 2px;
  }

  .file-item {
    display: flex;
    align-items: center;
    padding: 4px 8px;
    border-radius: 5px;
    background: rgba(255,255,255,.03);
    border: 1px solid var(--border);
    font-size: .73rem;
    gap: 6px;
  }

  .file-right {
    margin-left: auto;
    display: flex;
    align-items: center;
    gap: 6px;
    flex-shrink: 0;
  }

  .file-item .name {
    color: var(--text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
    max-width: 100%;
  }

  .file-item .size {
    color: var(--text-muted);
    white-space: nowrap;
    flex-shrink: 0;
    font-variant-numeric: tabular-nums;
  }

  .goodie-tag {
    color: var(--accent2);
    font-size: .68rem;
    flex-shrink: 0;
  }

  .files-toggle {
    margin-top: 4px;
    padding: 4px 12px;
    border: 1px solid var(--border);
    border-radius: 5px;
    background: transparent;
    color: var(--text-muted);
    font-size: .73rem;
    cursor: pointer;
    transition: all .2s;
  }

  .files-toggle:hover {
    border-color: var(--text-muted);
    color: var(--text);
    background: rgba(255,255,255,.06);
  }

  .files-extra {
    display: none;
  }

  .files-extra.open {
    display: grid;
    gap: 2px;
  }

  .torrent-file-select {
    border: 1px solid var(--border);
    border-radius: 8px;
    overflow: hidden;
  }

  .file-select-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 10px;
    background: rgba(255,255,255,.04);
    border-bottom: 1px solid var(--border);
    font-size: .78rem;
  }

  .toggle-all {
    display: flex;
    align-items: center;
    gap: 6px;
    cursor: pointer;
    color: var(--text);
    user-select: none;
  }

  .toggle-all input {
    accent-color: var(--accent);
  }

  .total-size {
    color: var(--text-muted);
  }

  .torrent-files-list {
    max-height: 280px;
    overflow-y: auto;
  }

  .torrent-file-item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 5px 10px;
    font-size: .78rem;
    cursor: pointer;
    transition: background .1s;
    user-select: none;
  }

  .torrent-file-item:hover {
    background: rgba(255,255,255,.04);
  }

  .torrent-file-item.selected {
    background: rgba(124,92,255,.08);
  }

  .torrent-file-item input {
    accent-color: var(--accent);
  }

  .torrent-file-item .file-name {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .torrent-file-item .file-size {
    color: var(--text-muted);
    flex-shrink: 0;
    font-variant-numeric: tabular-nums;
  }

  .disk-warning {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 8px 10px;
    background: rgba(220,38,38,.12);
    color: #f87171;
    font-size: .78rem;
    border-bottom: 1px solid rgba(220,38,38,.25);
  }

  .disk-warning svg {
    flex-shrink: 0;
  }

  .file-select-actions {
    display: flex;
    gap: 8px;
    padding: 8px 10px;
    border-top: 1px solid var(--border);
    background: rgba(255,255,255,.02);
  }

  .cancel-select-btn {
    padding: 8px 16px;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: transparent;
    color: var(--text-muted);
    font-size: .82rem;
    cursor: pointer;
    transition: all .2s;
  }

  .cancel-select-btn:hover {
    border-color: var(--text-muted);
    color: var(--text);
    background: rgba(255,255,255,.05);
  }

  .spin {
    animation: spin 1s linear infinite;
  }

  @keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }

  .links-section {
    padding-top: 0;
  }

  .link-group {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  .ext-link {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 5px 10px;
    border: 1px solid var(--border);
    border-radius: 5px;
    background: none;
    font: inherit;
    cursor: pointer;
    color: var(--text);
    text-decoration: none;
    font-size: .75rem;
    transition: all .2s;
  }

  .ext-link:hover {
    border-color: var(--text-muted);
    background: rgba(255,255,255,.05);
  }
</style>
