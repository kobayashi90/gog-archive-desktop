<script>
  import { onMount } from "svelte";
  import { invoke } from "./ipc.js";
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
    if (!size) return "—";
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
    return "★".repeat(full) + "☆".repeat(5 - full);
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
    if (e.target === e.currentTarget) close();
  }

  function handleKeydown(e) { if (e.key === "Escape") close(); }

  // span[role=button] keyboard activation (site markup parity)
  function activate(fn) {
    return (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fn(); }
    };
  }

  // Site contract (DetailModal.svelte): main list = 5 game + 5 goodie rows
  // (per-group cap only when >8 files total), remainder lives in files-extra
  // revealed by .open — the toggle must never disappear while hidden rows exist.
  let gameFiles = $derived(files.filter((f) => f.type === "game"));
  let goodieFiles = $derived(files.filter((f) => f.type === "goodie"));
  let listCap = $derived(files.length > 8 ? 5 : files.length);

  function visibleFiles() {
    if (files.length <= 8) return files;
    return [...gameFiles.slice(0, listCap), ...goodieFiles.slice(0, listCap)];
  }

  function hiddenFiles() {
    if (files.length <= 8) return [];
    return [...gameFiles.slice(listCap), ...goodieFiles.slice(listCap)];
  }

  // Site middle-truncation (format.ts truncateName): keeps both ends so the
  // extension/gog-id tail stays readable.
  function truncateName(name, max = 65) {
    if (!name) return "—";
    if (name.length <= max) return name;
    const half = (max - 3) / 2;
    return name.slice(0, half) + "..." + name.slice(-half);
  }

  function handleImageError() { imageError = true; }

  let letter = $derived(game.title ? game.title[0].toUpperCase() : "?");
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="modal" role="presentation">
  <div class="modal-backdrop" onclick={handleOverlayClick} role="presentation"></div>
  <div class="modal-content detail" role="dialog" aria-modal="true" aria-label={game.title}>
    <button class="modal-close" onclick={close} aria-label="Close">
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
      </svg>
    </button>
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
            <span class="dev-link" role="button" tabindex="0" onclick={() => onfilterDeveloper?.(game.developer)} onkeydown={activate(() => onfilterDeveloper?.(game.developer))}>{game.developer}</span>
          {/if}
          {#if game.developer && game.publisher} &middot; {/if}
          {#if game.publisher}
            <span class="pub-link" role="button" tabindex="0" onclick={() => onfilterPublisher?.(game.publisher)} onkeydown={activate(() => onfilterPublisher?.(game.publisher))}>{game.publisher}</span>
          {/if}
          {#if game.release_date}
            &middot; <span class="year-link" role="button" tabindex="0" onclick={() => onfilterYear?.(game.release_date.slice(0, 4))} onkeydown={activate(() => onfilterYear?.(game.release_date.slice(0, 4)))}>{game.release_date.slice(0, 4)}</span>
          {/if}
        </div>
        <div class="detail-rating">
          <span class="stars">{fmtRating(game.rating)}</span>
          <span class="rating-num">{game.rating ? game.rating.toFixed(1) + '/5' : 'No ratings'}</span>
        </div>
        {#if genres.length > 0 || tags.length > 0}
          <div class="tag-group">
            {#each genres as g}
              <span class="tag genre" role="button" tabindex="0" onclick={() => onfilterGenre?.(g)} onkeydown={activate(() => onfilterGenre?.(g))}>{g}</span>
            {/each}
            {#each tags as t}
              <span class="tag tag-item" role="button" tabindex="0" onclick={(e) => { e.stopPropagation(); onfilterTag?.(t); }} onkeydown={activate(() => onfilterTag?.(t))}>{t}</span>
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
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
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
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
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
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
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
                <span class="name" title={f.name}>{truncateName(f.name)}{#if f.type === "goodie"} <span class="file-extra-mark">(extra)</span>{/if}</span>
                <span class="size">{fmtSizeStr(f.size)}</span>
              </div>
            {/each}
          </div>
          {#if files.length > 8}
            <div id="filesExtra" class="files-extra" class:open={showAllFiles}>
              {#each hiddenFiles() as f}
                <div class="file-item">
                  <span class="name" title={f.name}>{truncateName(f.name)}{#if f.type === "goodie"} <span class="file-extra-mark">(extra)</span>{/if}</span>
                  <span class="size">{fmtSizeStr(f.size)}</span>
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

<style>
  /* ---------- Dialog mechanics (redesign Modal.svelte parity) ----------
     The dialog box itself scrolls (.modal-content caps at the viewport and
     overflows internally); the outer .modal is the fixed flex layer. App
     chrome adaptation: top pad clears the 30px titlebar, bottom clears the
     status bar — the site has no such chrome. */
  .modal {
    position: fixed;
    inset: 0;
    z-index: 200;
    display: flex;
    justify-content: center;
    padding: 54px 24px 48px;
    overflow-y: auto;
  }

  .modal-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(8, 8, 10, .78);
    backdrop-filter: blur(6px);
  }

  .modal-content {
    position: relative;
    width: 100%;
    max-width: 860px;
    margin: 0 auto;
    background: var(--deep);
    border: 1px solid var(--line-soft);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow);
    animation: modalIn .3s cubic-bezier(.22, 1, .36, 1);
    align-self: flex-start;
    max-height: calc(100vh - 102px);
    overflow-y: auto;
  }

  .modal-content::-webkit-scrollbar {
    width: 6px;
  }
  .modal-content::-webkit-scrollbar-track {
    background: transparent;
  }
  .modal-content::-webkit-scrollbar-thumb {
    background: rgba(255, 255, 255, .22);
    border-radius: 3px;
  }
  .modal-content::-webkit-scrollbar-thumb:hover {
    background: rgba(255, 255, 255, .35);
  }

  @keyframes modalIn {
    from { opacity: 0; transform: scale(.97) translateY(10px); }
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
    border: 1px solid var(--line);
    border-radius: var(--radius-sm);
    background: var(--shelf);
    color: var(--mist);
    cursor: pointer;
    transition: all .15s;
  }

  .modal-close:hover {
    background: var(--trench);
    color: var(--foam);
    border-color: var(--lure-mid);
  }

  /* ---------- Detail dialog (redesign DetailModal.svelte parity) ---------- */
  .detail-header {
    display: flex;
    gap: 20px;
    padding: 24px 32px 16px;
  }

  .detail-cover {
    flex-shrink: 0;
    width: 180px;
    border-radius: var(--radius);
    overflow: hidden;
    border: 1px solid var(--line);
    box-shadow: 0 12px 32px rgba(0, 0, 0, .5);
    align-self: flex-start;
  }

  .detail-cover img {
    width: 100%;
    height: auto;
    display: block;
    border-radius: var(--radius);
  }

  .cover-letter {
    display: none;
    align-items: center;
    justify-content: center;
    aspect-ratio: 3/4;
    font-family: var(--font-display);
    font-size: 3rem;
    font-weight: 700;
    color: var(--mist);
    background: var(--shelf);
    border-radius: var(--radius);
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
    font-family: var(--font-display);
    font-size: 1.5rem;
    font-weight: 700;
    margin-bottom: 3px;
    line-height: 1.25;
    padding-right: 40px;
    letter-spacing: -.01em;
    color: var(--foam);
  }

  .dev-pub {
    font-size: .85rem;
    color: var(--dim);
    margin-bottom: 6px;
  }

  .dev-pub span {
    color: var(--mist);
  }

  .dev-pub .pub-link,
  .dev-pub .year-link {
    color: var(--dim);
  }

  .pub-link,
  .dev-link,
  .year-link {
    cursor: pointer;
    border-bottom: 1px dashed transparent;
    transition: all .15s;
  }

  .dev-link:hover {
    border-bottom-color: var(--mist);
    color: var(--foam);
  }

  .pub-link:hover,
  .year-link:hover {
    border-bottom-color: var(--dim);
    color: var(--foam);
  }

  .detail-rating {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-bottom: 8px;
  }

  .detail-rating .stars {
    color: var(--foam);
    font-size: .85rem;
    letter-spacing: 1px;
  }

  .detail-rating .rating-num {
    font-size: .78rem;
    color: var(--dim);
    font-variant-numeric: tabular-nums;
  }

  .tag-group {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }

  .tag {
    padding: 3px 9px;
    border-radius: 999px;
    font-size: .7rem;
    font-weight: 500;
    cursor: pointer;
    transition: all .15s;
    background: transparent;
    border: 1px solid var(--line);
    color: var(--mist);
  }

  .tag:hover {
    background: var(--lure-dim);
    border-color: var(--lure-mid);
    color: var(--foam);
  }

  .tag.genre {
    background: var(--lure-dim);
    border-color: rgba(255, 255, 255, .14);
    color: var(--foam);
  }

  .tag.genre:hover {
    background: var(--lure-mid);
    border-color: var(--lure-mid);
  }

  .detail-body {
    padding: 0 32px 28px;
  }

  .detail-section {
    margin-bottom: 16px;
  }

  /* section headers — clean uppercase eyebrow */
  .detail-section h3 {
    font-size: .7rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: .06em;
    color: var(--dim);
    margin-bottom: 10px;
    padding-bottom: 8px;
    border-bottom: 1px solid var(--line-soft);
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }

  .section-summary {
    font-size: .64rem;
    font-weight: 500;
    text-transform: none;
    letter-spacing: normal;
    color: var(--dim);
    background: var(--shelf);
    border: 1px solid var(--line-soft);
    padding: 1px 8px;
    border-radius: 999px;
  }

  /* App primary action — the site's .magnet-link treatment */
  .download-torrent-btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 7px 14px;
    border: 1px solid var(--lure);
    border-radius: var(--radius-sm);
    background: var(--lure);
    color: var(--abyss);
    font-size: .78rem;
    font-weight: 600;
    transition: all .15s;
  }

  .download-torrent-btn svg {
    flex-shrink: 0;
    width: 12px;
    height: 12px;
  }

  .download-torrent-btn:hover:not(:disabled) {
    background: var(--pulse);
    box-shadow: 0 4px 18px var(--lure-glow);
  }

  .download-torrent-btn:disabled {
    opacity: .6;
    cursor: default;
  }

  .no-downloads {
    color: var(--dim);
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
    color: var(--success);
  }

  .add-status.error {
    color: var(--danger);
  }

  .error-detail {
    font-size: .78em;
    opacity: .75;
    margin-top: 2px;
    word-break: break-word;
  }

  /* Files: clean rows (site panel treatment) */
  .files-list {
    display: grid;
    gap: 2px;
    border: 1px solid var(--line);
    border-radius: var(--radius-sm);
    background: var(--shelf);
    padding: 4px;
  }

  .file-item {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 4px 10px;
    border-radius: 6px;
    background: transparent;
    border: 1px solid transparent;
    font-size: .74rem;
    gap: 10px;
    min-width: 0;
  }

  .file-item:nth-child(even) {
    background: rgba(255, 255, 255, .02);
  }

  .file-item .name {
    color: var(--mist);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
    font-variant-numeric: tabular-nums;
  }

  .file-item .size {
    color: var(--dim);
    white-space: nowrap;
    flex-shrink: 0;
    font-variant-numeric: tabular-nums;
  }

  .file-extra-mark {
    color: var(--dim);
    font-size: .68rem;
    font-style: italic;
    flex-shrink: 0;
  }

  .files-toggle {
    margin-top: 8px;
    padding: 4px 12px;
    border: 1px solid var(--line);
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--dim);
    font-size: .72rem;
    font-weight: 500;
    cursor: pointer;
    transition: all .15s;
  }

  .files-toggle:hover {
    border-color: var(--lure-mid);
    color: var(--foam);
    background: var(--lure-dim);
  }

  .files-extra {
    display: none;
  }

  .files-extra.open {
    display: grid;
    gap: 2px;
    border: 1px solid var(--line);
    border-top: none;
    border-radius: 0 0 var(--radius-sm) var(--radius-sm);
    background: var(--shelf);
    padding: 4px;
  }

  .files-list:has(+ .files-extra.open) {
    border-radius: var(--radius-sm) var(--radius-sm) 0 0;
    border-bottom: none;
  }

  /* ---------- App-specific: torrent file selector (site panel language) ---------- */
  .torrent-file-select {
    border: 1px solid var(--line);
    border-radius: var(--radius-sm);
    background: var(--shelf);
    overflow: hidden;
  }

  .file-select-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 7px 12px;
    background: var(--trench);
    border-bottom: 1px solid var(--line-soft);
    font-size: .74rem;
  }

  .toggle-all {
    display: flex;
    align-items: center;
    gap: 6px;
    cursor: pointer;
    color: var(--foam);
    font-weight: 600;
    user-select: none;
  }

  .toggle-all input {
    accent-color: var(--lure);
  }

  .total-size {
    color: var(--dim);
  }

  .torrent-files-list {
    max-height: 280px;
    overflow-y: auto;
  }

  .torrent-files-list::-webkit-scrollbar {
    width: 6px;
  }
  .torrent-files-list::-webkit-scrollbar-track {
    background: transparent;
  }
  .torrent-files-list::-webkit-scrollbar-thumb {
    background: rgba(255, 255, 255, .22);
    border-radius: 3px;
  }

  .torrent-file-item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 10px;
    font-size: .74rem;
    cursor: pointer;
    transition: background .1s;
    user-select: none;
  }

  .torrent-file-item:hover {
    background: rgba(255, 255, 255, .04);
  }

  .torrent-file-item.selected {
    background: rgba(255, 255, 255, .06);
  }

  .torrent-file-item input {
    accent-color: var(--lure);
  }

  .torrent-file-item .file-name {
    flex: 1;
    min-width: 0;
    color: var(--mist);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .torrent-file-item .file-size {
    color: var(--dim);
    flex-shrink: 0;
    font-variant-numeric: tabular-nums;
  }

  .disk-warning {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 8px 10px;
    background: rgba(239, 68, 68, .1);
    color: var(--danger);
    font-size: .78rem;
    border-bottom: 1px solid rgba(239, 68, 68, .2);
  }

  .disk-warning svg {
    flex-shrink: 0;
  }

  .file-select-actions {
    display: flex;
    gap: 8px;
    padding: 8px 12px;
    border-top: 1px solid var(--line-soft);
    background: rgba(255, 255, 255, .02);
  }

  .cancel-select-btn {
    padding: 6px 14px;
    border: 1px solid var(--line);
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--dim);
    font-size: .76rem;
    font-weight: 500;
    cursor: pointer;
    transition: all .15s;
  }

  .cancel-select-btn:hover {
    border-color: var(--lure-mid);
    color: var(--foam);
    background: var(--lure-dim);
  }

  .spin {
    animation: spin 1s linear infinite;
  }

  @keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }

  /* ---------- Links (redesign parity) ---------- */
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
    border: 1px solid var(--line);
    border-radius: var(--radius-sm);
    color: var(--mist);
    text-decoration: none;
    font-size: .74rem;
    font-weight: 500;
    transition: all .15s;
  }

  .ext-link:hover {
    border-color: var(--lure-mid);
    background: var(--lure-dim);
    color: var(--foam);
  }
</style>
