<script>
  import { invoke } from "@tauri-apps/api/core";
  import { showToast, showConfirm } from "./stores.js";

  let { torrentStatuses, onviewGame } = $props();

  let torrents = $derived(torrentStatuses);

  function togglePause(slug, paused) {
    if (paused) invoke("resume_torrent", { slug });
    else invoke("pause_torrent", { slug });
  }

  async function removeTorrent(slug) {
    showConfirm("Remove Torrent", "Remove this torrent and its files?", async () => {
      try {
        await invoke("remove_torrent", { slug });
        showToast("Torrent removed", "success");
      } catch (e) {
        showToast("Failed to remove torrent: " + e, "error");
      }
    });
  }

  async function deleteTorrent(slug) {
    showConfirm("Delete Torrent", "Delete this torrent and all downloaded files?", async () => {
      try {
        await invoke("delete_torrent", { slug });
        showToast("Torrent deleted", "success");
      } catch (e) {
        showToast("Failed to delete torrent: " + e, "error");
      }
    });
  }

  let expanded = $state({});

  function toggleExpanded(slug) {
    expanded = { ...expanded, [slug]: !expanded[slug] };
  }

  function speedDisplay(bytesPerSec) {
    if (bytesPerSec < 1024) return bytesPerSec + " B/s";
    if (bytesPerSec < 1024 * 1024) return (bytesPerSec / 1024).toFixed(1) + " kB/s";
    return (bytesPerSec / 1024 / 1024).toFixed(1) + " MB/s";
  }

  function fmt(bytes) {
    if (!bytes) return "0 B";
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " kB";
    if (bytes < 1024 * 1024 * 1024) return (bytes / 1024 / 1024).toFixed(1) + " MB";
    return (bytes / 1024 / 1024 / 1024).toFixed(2) + " GB";
  }

  function progressPercent(t) {
    if (!t.totalBytes) return 0;
    return Math.min(100, ((t.progressBytes / t.totalBytes) * 100));
  }
</script>

<div class="queue">
  {#each torrents as t (t.slug)}
    <div class="torrent-row" class:expanded={expanded[t.slug]}>
      <div class="torrent-main" onclick={() => toggleExpanded(t.slug)} onkeydown={(e) => e.key === 'Enter' && toggleExpanded(t.slug)} role="button" tabindex="0" aria-expanded={!!expanded[t.slug]}>
        <div class="torrent-left">
          <div class="torrent-icon" class:active={t.state === "downloading"} class:seeding={t.state === "seeding"} class:paused-state={t.state === "paused"}>
            {#if t.state === "downloading"}
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            {:else if t.state === "seeding"}
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
            {:else}
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
            {/if}
          </div>
          <div class="torrent-info">
            <div class="torrent-name" onclick={() => onviewGame?.(t.slug)} onkeydown={(e) => e.key === 'Enter' && onviewGame?.(t.slug)} role="button" tabindex="0">{t.name}</div>
            <div class="torrent-progress-wrap">
              <div class="progress-bar">
                <div class="progress-fill" style="width: {progressPercent(t)}%"></div>
              </div>
              <span class="progress-text">{fmt(t.progressBytes)} / {fmt(t.totalBytes)}</span>
            </div>
          </div>
        </div>
        <div class="torrent-right">
          {#if t.downloadSpeed}
            <div class="speed down">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="7 13 12 18 17 13"/><line x1="12" y1="18" x2="12" y2="6"/></svg>
              {speedDisplay(t.downloadSpeed)}
            </div>
          {/if}
          {#if t.uploadSpeed}
            <div class="speed up">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="17 11 12 6 7 11"/><line x1="12" y1="18" x2="12" y2="6"/></svg>
              {speedDisplay(t.uploadSpeed)}
            </div>
          {/if}
          <div class="torrent-actions">
            <button class="action-btn pause-btn" onclick={() => togglePause(t.slug, t.state === "paused")} aria-label={t.state === "paused" ? "Resume" : "Pause"} title={t.state === "paused" ? "Resume" : "Pause"}>
              {#if t.state === "paused"}
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
              {:else}
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
              {/if}
            </button>
            <button class="action-btn action-danger" onclick={() => removeTorrent(t.slug)} aria-label="Remove torrent" title="Remove torrent">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
            </button>
          </div>
        </div>
      </div>
    </div>
  {:else}
    <div class="empty-queue">
      <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><path d="M16 16s-1.5-2-4-2-4 2-4 2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></svg>
      <p>No active downloads</p>
    </div>
  {/each}
</div>

<style>
  .queue { padding: 8px; flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 4px; }

  .queue > :global(* + *) { margin-top: 0; }

  .torrent-row {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    overflow: hidden;
    transition: border-color .15s;
  }
  .torrent-row:hover { border-color: var(--border-hover); }
  .torrent-row.expanded { border-color: var(--text-muted); }

  .torrent-main {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 12px;
    cursor: pointer;
    user-select: none;
    gap: 12px;
  }

  .torrent-left {
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
    flex: 1;
  }

  .torrent-icon {
    flex-shrink: 0;
    width: 32px;
    height: 32px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 50%;
    background: rgba(0,212,170,.08);
    color: var(--accent2);
  }

  .torrent-icon.active { background: rgba(0,212,170,.15); }
  .torrent-icon.seeding { background: rgba(255,193,7,.1); color: #ffc107; }
  .torrent-icon.paused-state { background: rgba(255,255,255,.05); color: var(--text-muted); }

  .torrent-info { min-width: 0; flex: 1; }

  .torrent-name {
    font-size: .8rem;
    font-weight: 600;
    color: var(--text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    margin-bottom: 4px;
    display: inline-block;
    transition: color .15s;
  }

  .torrent-name:hover { color: var(--accent2); }

  .torrent-progress-wrap {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .progress-bar {
    flex: 1;
    height: 4px;
    background: rgba(255,255,255,.08);
    border-radius: 2px;
    overflow: hidden;
    min-width: 60px;
  }

  .progress-fill {
    height: 100%;
    background: var(--accent);
    border-radius: 2px;
    transition: width 0.5s ease;
  }

  .progress-text {
    font-size: .65rem;
    color: var(--text-muted);
    white-space: nowrap;
  }

  .torrent-right {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-shrink: 0;
  }

  .speed {
    display: flex;
    align-items: center;
    gap: 3px;
    font-size: .68rem;
    font-weight: 600;
    white-space: nowrap;
  }

  .speed.down { color: var(--accent2); }
  .speed.up { color: #ffc107; }

  .torrent-actions {
    display: flex;
    gap: 2px;
  }

  .action-btn {
    width: 26px;
    height: 26px;
    display: flex;
    align-items: center;
    justify-content: center;
    border: none;
    border-radius: 4px;
    color: var(--text-muted);
    background: transparent;
    cursor: pointer;
    transition: all .15s;
  }

  .action-btn:hover {
    background: rgba(255,255,255,.08);
    color: var(--text);
  }

  .action-btn.action-danger:hover {
    background: rgba(220,38,38,.15);
    color: #ef4444;
  }

  .pause-btn:hover { color: var(--accent2); }

  .empty-queue {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 12px;
    color: var(--text-muted);
    opacity: .6;
  }

  .empty-queue p { font-size: .85rem; }
</style>
