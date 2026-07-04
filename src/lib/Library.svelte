<script>
  import { createEventDispatcher, onDestroy } from "svelte";
  import { invoke } from "@tauri-apps/api/core";
  import { showConfirm } from "./stores.js";
  import { showToast } from "./stores.js";

  const dispatch = createEventDispatcher();

  let entries = [];
  let allEntries = [];
  let interval;
  let searchQuery = "";
  let deleting = null;

  $: entries = searchQuery
    ? allEntries.filter(e => e.title.toLowerCase().includes(searchQuery.toLowerCase()))
    : allEntries;

  function fmt(bytes) {
    if (bytes <= 0) return "\u2014";
    const units = ["B", "KB", "MB", "GB", "TB"];
    let i = 0, v = bytes;
    while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
    return v.toFixed(v >= 10 ? 0 : 1) + " " + units[i];
  }

  async function poll() {
    try {
      allEntries = await invoke("torrent_library");
      dispatch("libraryCount", allEntries.length);
    } catch (e) {}
  }

  async function openFolder(slug) {
    try { await invoke("open_folder", { slug }); } catch (e) { showToast(e, "error"); }
  }

  function confirmDelete(entry) {
    showConfirm(
      `Delete "${entry.title}"?`,
      `This will permanently delete the game folder and all its files from your disk. This cannot be undone.`,
      () => doDelete(entry),
    );
  }

  async function doDelete(entry) {
    deleting = entry.slug;
    try {
      await invoke("torrent_library_delete", { slug: entry.slug });
      showToast(`"${entry.title}" deleted`, "success");
      allEntries = allEntries.filter(e => e.slug !== entry.slug);
    } catch (e) {
      showToast(`Failed to delete "${entry.title}": ${e}`, "error");
    }
    deleting = null;
  }

  poll();
  interval = setInterval(poll, 5000);
  onDestroy(() => clearInterval(interval));
</script>

<div class="library">
  <div class="header">
    <h2>Library</h2>
    <div class="library-search">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
      <input type="text" placeholder="Filter library..." bind:value={searchQuery} />
    </div>
    <span class="count">({allEntries.length})</span>
  </div>

  {#if entries.length === 0}
    <div class="empty">
      <p>No games in library</p>
      <span>Downloaded games and removed torrents appear here</span>
    </div>
  {:else}
    <div class="grid">
      {#each entries as e}
        <div class="card">
          <div class="cover">
            {#if e.image}
              <img src={e.image} alt={e.title} class="cover-img" />
            {:else}
              <span class="letter">{e.title ? e.title[0].toUpperCase() : "?"}</span>
            {/if}
          </div>
          <div class="info">
            <div class="title" title={e.title}>{e.title}</div>
            {#if e.developer}
              <div class="developer">{e.developer}</div>
            {/if}
            {#if e.genre}
              <div class="genres">{e.genre}</div>
            {/if}
            <div class="size">
              {#if e.file_count > 0}
                {e.file_count} file{e.file_count !== 1 ? 's' : ''} &middot;
              {/if}
              {fmt(e.size)} on disk
              {#if e.total_size != null && e.total_size > 0 && Math.abs(e.total_size - e.size) > 1024}
                &middot; {fmt(e.total_size)} in archive
              {/if}
            </div>
          </div>
          <div class="actions">
            <button class="act-btn" on:click={() => openFolder(e.slug)} title="Open folder">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/>
              </svg>
            </button>
            <button class="act-btn danger" on:click={() => confirmDelete(e)} title="Delete" disabled={deleting === e.slug}>
              {#if deleting === e.slug}
                <span class="spinner"></span>
              {:else}
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <polyline points="3 6 5 6 21 6"/>
                  <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/>
                </svg>
              {/if}
            </button>
          </div>
        </div>
      {/each}
    </div>
  {/if}
</div>

<style>
  .library { padding: 16px; }

  .header {
    display: flex; align-items: center; gap: 10px; margin-bottom: 16px;
  }

  .header h2 { font-size: 18px; font-weight: 600; color: var(--text); flex-shrink: 0; }

  .library-search {
    position: relative;
    flex: 1;
  }

  .library-search svg {
    position: absolute;
    left: 10px;
    top: 50%;
    transform: translateY(-50%);
    color: var(--text-muted);
    pointer-events: none;
  }

  .library-search input {
    width: 100%;
    padding: 6px 10px 6px 30px;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--surface);
    color: var(--text);
    font-size: .82rem;
    outline: none;
  }

  .library-search input:focus {
    border-color: var(--text-muted);
  }

  .count { font-size: 13px; color: var(--text-muted); flex-shrink: 0; }

  .empty { text-align: center; padding: 64px 0; }
  .empty p { font-size: 16px; color: var(--text-muted); margin-bottom: 4px; }
  .empty span { font-size: 13px; color: var(--text-muted); }

  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
    gap: 12px;
  }

  .card {
    display: flex; flex-direction: column;
    background: var(--surface); border: 1px solid var(--border);
    border-radius: var(--radius-lg); overflow: hidden; text-align: left;
  }

  .cover {
    aspect-ratio: 3 / 2; background: var(--bg);
    display: flex; align-items: center; justify-content: center;
    border-bottom: 1px solid var(--border);
  }

  .letter {
    font-size: 48px; font-weight: 700; color: var(--accent); opacity: 0.6;
  }

  .cover-img { width: 100%; height: 100%; object-fit: cover; }

  .info { padding: 10px 12px; flex: 1; }

  .title {
    font-size: 13px; font-weight: 500; color: var(--text);
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-bottom: 2px;
  }

  .developer {
    font-size: 11px; color: var(--text-muted); margin-bottom: 1px;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }

  .genres {
    font-size: 10px; color: var(--text-muted); opacity: 0.75;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-bottom: 1px;
  }

  .size { font-size: 11px; color: var(--text-muted); }

  .actions {
    display: flex; border-top: 1px solid var(--border);
  }

  .act-btn {
    flex: 1; height: 36px; display: flex; align-items: center; justify-content: center;
    color: var(--text-muted); transition: background 0.1s, color 0.1s; gap: 4px;
  }

  .act-btn:hover { background: var(--surface-hover); color: var(--text); }
  .act-btn.danger:hover { background: var(--danger); color: #fff; }
  .act-btn:disabled { opacity: 0.5; cursor: default; }
  .act-btn:disabled:hover { background: none; color: var(--text-muted); }

  .spinner {
    width: 14px;
    height: 14px;
    border: 2px solid currentColor;
    border-top-color: transparent;
    border-radius: 50%;
    animation: libspin .6s linear infinite;
  }

  @keyframes libspin { to { transform: rotate(360deg); } }
</style>
