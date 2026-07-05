<script>
  import { invoke } from "@tauri-apps/api/core";
  import { showConfirm } from "./stores.js";
  import { showToast } from "./stores.js";

  let { torrentStatuses, onviewGame } = $props();

  let torrents = $derived(torrentStatuses);
  let removing = $state(null);

  function fmt(bytes) {
    if (bytes <= 0) return "\u2014";
    const units = ["B", "KB", "MB", "GB", "TB"];
    let i = 0, v = bytes;
    while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
    return v.toFixed(v >= 10 ? 0 : 1) + " " + units[i];
  }

  function fmtEta(secs) {
    if (secs <= 0 || !isFinite(secs)) return "\u2014";
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = Math.floor(secs % 60);
    if (h > 0) return `${h}h ${m}m`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
  }

  function fmtSpeed(bytes) {
    if (bytes <= 0) return "\u2014";
    const units = ["B", "KB", "MB", "GB", "TB"];
    let i = 0, v = bytes;
    while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
    return v.toFixed(2) + " " + units[i] + "/s";
  }

  async function pauseAll() {
    const active = torrents.filter((t) => t.state === "downloading" || t.state === "metadata" || t.state === "checking");
    for (const t of active) {
      try { await invoke("torrent_pause", { slug: t.slug }); } catch (e) {}
    }
  }

  async function resumeAll() {
    const paused = torrents.filter((t) => t.state === "paused" || t.state === "error" || t.state === "stopped");
    for (const t of paused) {
      try { await invoke("torrent_resume", { slug: t.slug }); } catch (e) {}
    }
  }

  async function pause(slug) { await invoke("torrent_pause", { slug }); }
  async function resume(slug) { await invoke("torrent_resume", { slug }); }
  function confirmRemove(t) {
    showConfirm(
      `Remove "${t.title || t.name}"?`,
      `This will remove the torrent from the download queue. The downloaded files will not be deleted.`,
      () => doRemove(t),
    );
  }

  async function doRemove(t) {
    removing = t.slug;
    try {
      await invoke("torrent_remove", { slug: t.slug });
      showToast(`"${t.title || t.name}" removed from queue`, "success");
    } catch (e) {
      showToast(`Failed to remove "${t.title || t.name}": ${e}`, "error");
    }
    removing = null;
  }

  async function openFolder(slug) {
    try { await invoke("open_folder", { slug }); } catch (e) { console.error(e); }
  }

  let active = $derived(torrents.filter((t) => t.state !== "seeding" && t.state !== "finished" && (t.progress || 0) < 100));
  let completed = $derived(torrents.filter((t) => t.state === "seeding" || t.state === "finished"));
</script>

<div class="queue">
  {#if torrents.length === 0}
    <div class="empty-state">No active downloads. Browse games and click "Download" to start.</div>
  {:else}
    {#if active.length}
      <h3 class="queue-section-title">Downloading ({active.length})</h3>
      <div class="queue-list">
        {#each active as t}
          <div class="queue-item">
            {#if t.image}
              <img class="queue-thumb" src={t.image} alt="" loading="lazy" onerror={(e) => e.target.style.display = "none"} />
            {:else}
              <div class="queue-thumb queue-thumb-letter">{(t.title || t.name || "?")[0].toUpperCase()}</div>
            {/if}
            <div class="queue-body">
              <div class="queue-name" title={t.title || t.name}>{t.title || t.name}</div>
              <div class="queue-bar-track">
                <div class="queue-bar-fill" style="width: {Math.min(t.progress * 100, 100)}%"></div>
              </div>
              <div class="queue-stats">
                <span class="qstat-pct">{(t.progress * 100).toFixed(1)}%</span>
                <span class="qstat-speed">&darr; {fmtSpeed(t.download_rate)}</span>
                {#if t.eta > 0 && Number.isFinite(t.eta)}
                  <span class="qstat-eta">{fmtEta(t.eta)}</span>
                {/if}

              </div>
            </div>
            <div class="queue-actions">
              {#if t.state === "paused" || t.state === "error" || t.state === "stopped"}
                <button class="queue-btn" onclick={() => resume(t.slug)}>Resume</button>
              {:else}
                <button class="queue-btn" onclick={() => pause(t.slug)}>Pause</button>
              {/if}
              <button class="queue-btn danger" onclick={() => confirmRemove(t)} disabled={removing === t.slug}>
                {#if removing === t.slug}
                  <span class="qspinner"></span>
                {:else}
                  Remove
                {/if}
              </button>
            </div>
          </div>
        {/each}
      </div>
    {/if}

    {#if completed.length}
      <h3 class="queue-section-title">Completed ({completed.length})</h3>
      <div class="queue-list">
        {#each completed as t}
          <div class="queue-item done">
            {#if t.image}
              <img class="queue-thumb" src={t.image} alt="" loading="lazy" onerror={(e) => e.target.style.display = "none"} />
            {:else}
              <div class="queue-thumb queue-thumb-letter">{(t.title || t.name || "?")[0].toUpperCase()}</div>
            {/if}
            <div class="queue-body">
              <div class="queue-name" title={t.title || t.name}>{t.title || t.name}</div>
              <div class="queue-status">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>
                Seeding &middot; {fmt(t.total_upload)} uploaded
                {#if t.verified}
                  <span class="verified-badge" title="Download verified against game metadata">&#10003;</span>
                {:else if t.progress >= 1}
                  <span class="unverified-badge" title="Unable to verify download completeness">?</span>
                {/if}
              </div>
            </div>
            <div class="queue-actions">
              <button class="queue-btn" onclick={() => openFolder(t.slug)} title="Open folder">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/></svg>
              </button>
              <button class="queue-btn danger" onclick={() => confirmRemove(t)} disabled={removing === t.slug}>
                {#if removing === t.slug}
                  <span class="qspinner"></span>
                {:else}
                  Remove
                {/if}
              </button>
            </div>
          </div>
        {/each}
      </div>
    {/if}
  {/if}
</div>

<style>
  .queue { padding: 0; }

  .empty-state {
    text-align: center;
    padding: 64px 0;
    font-size: .85rem;
    color: var(--text-muted);
  }

  .queue-section-title {
    font-size: .78rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: .06em;
    color: var(--text-muted);
    margin: 4px 0 10px;
  }

  .queue-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin-bottom: 24px;
  }

  .queue-item {
    display: flex;
    gap: 14px;
    padding: 10px 14px;
    border-radius: var(--radius-sm);
    background: var(--surface);
    border: 1px solid var(--border);
    transition: border-color .15s;
    align-items: center;
  }

  .queue-item:hover {
    border-color: var(--border-hover);
  }

  .queue-item.done {
    border-color: rgba(0,212,170,.15);
    background: rgba(0,212,170,.02);
  }

  .queue-thumb {
    width: 40px;
    height: 52px;
    object-fit: cover;
    border-radius: 4px;
    flex-shrink: 0;
    background: var(--surface);
  }

  .queue-thumb-letter {
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 1.2rem;
    font-weight: 700;
    color: var(--text-muted);
    background: linear-gradient(135deg, #1a1a2e, #2d1b4e);
  }

  .queue-body {
    flex: 1;
    min-width: 0;
  }

  .queue-name {
    font-size: .85rem;
    font-weight: 600;
    color: var(--text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    margin-bottom: 4px;
  }

  .queue-bar-track {
    height: 6px;
    background: var(--bg);
    border-radius: 3px;
    overflow: hidden;
    border: 1px solid var(--border);
    margin-bottom: 3px;
  }

  .queue-bar-fill {
    height: 100%;
    background: linear-gradient(90deg, #f59e0b, #f97316);
    border-radius: 3px;
  }

  .queue-stats {
    display: flex;
    gap: 14px;
    font-size: .68rem;
    color: var(--text-muted);
    font-variant-numeric: tabular-nums;
  }

  .queue-stats .qstat-pct {
    font-weight: 700;
    color: var(--text);
  }

  .queue-stats .qstat-speed {
    min-width: 8ch;
    flex-shrink: 0;
    white-space: nowrap;
  }

  .queue-status {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: .82rem;
    font-weight: 600;
    color: var(--accent2);
  }

  .verified-badge {
    color: #22c55e;
    font-size: .9rem;
    font-weight: 700;
  }

  .unverified-badge {
    color: #f59e0b;
    font-size: .75rem;
    font-weight: 700;
    width: 16px;
    height: 16px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: 1px solid #f59e0b;
    border-radius: 50%;
  }

  .queue-actions {
    display: flex;
    gap: 4px;
    flex-shrink: 0;
  }

  .queue-btn {
    padding: 5px 12px;
    border: 1px solid var(--border);
    border-radius: 5px;
    background: transparent;
    color: var(--text-muted);
    font-size: .72rem;
    cursor: pointer;
    transition: all .15s;
  }

  .queue-btn:hover {
    border-color: var(--text-muted);
    color: var(--text);
    background: rgba(255,255,255,.04);
  }

  .queue-btn.danger {
    color: #ef4444;
    border-color: #ef444433;
  }

  .queue-btn.danger:hover {
    background: rgba(239,68,68,.12);
    border-color: #ef444466;
  }

  .queue-btn:disabled { opacity: 0.5; cursor: default; }
  .queue-btn:disabled:hover { background: transparent; border-color: var(--border); color: var(--text-muted); }

  .qspinner {
    display: inline-block;
    width: 12px;
    height: 12px;
    border: 2px solid currentColor;
    border-top-color: transparent;
    border-radius: 50%;
    animation: qspin .6s linear infinite;
    vertical-align: middle;
  }

  @keyframes qspin { to { transform: rotate(360deg); } }
</style>
