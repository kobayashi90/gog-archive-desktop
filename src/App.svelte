<script>
  import { onMount } from "svelte";
  import { invoke } from "@tauri-apps/api/core";
  import { listen } from "@tauri-apps/api/event";
  import { getCurrentWindow } from "@tauri-apps/api/window";
  import { showToast } from "./lib/stores.js";
  import Browse from "./lib/Browse.svelte";
  import Queue from "./lib/Queue.svelte";
  import Library from "./lib/Library.svelte";
  import Settings from "./lib/Settings.svelte";
  import GameModal from "./lib/GameModal.svelte";
  import Toast from "./lib/Toast.svelte";
  import Confirm from "./lib/Confirm.svelte";

  let tab = $state("browse");
  let gameCount = $state(0);
  let libraryCount = $state(0);
  let detailGame = $state(null);
  let advFilters = $state(null);
  let torrentStatuses = $state([]);
  let downSpeed = $state(0);
  let upSpeed = $state(0);

  // debounced search
  let rawQuery = $state("");
  let searchQuery = $state("");

  let searchTimer;
  $effect(() => {
    if (rawQuery !== undefined) {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        searchQuery = rawQuery;
      }, 300);
      return () => clearTimeout(searchTimer);
    }
  });

  let tabs = $derived([
    { id: "browse", label: "Browse", count: gameCount },
    { id: "queue", label: "Downloads", count: torrentStatuses.length },
    { id: "library", label: "Library", count: libraryCount },
    { id: "settings", label: "Settings" },
  ]);

  let anyRunning = $derived(
    torrentStatuses.length > 0 && torrentStatuses.some(
      t => t.state !== "paused" && t.state !== "stopped" && t.state !== "error" &&
           t.state !== "seeding" && t.state !== "finished"
    )
  );

  // smoothed per-torrent rates via EMA
  let slugSmoothRate = $state({});
  const RATE_ALPHA = 0.3;

  let appWindow = getCurrentWindow();

  onMount(() => {
    const unlistenTray = listen("tray-action", (e) => {
      const action = e.payload;
      if (action === "show") {
        try { appWindow.unminimize(); } catch (e) {}
        try { appWindow.show(); } catch (e) {}
        try { appWindow.setFocus(); } catch (e) {}
      } else if (action === "downloads") { closeDetail(); tab = "queue"; }
      else if (action === "settings") { closeDetail(); tab = "settings"; }
      else if (action === "pause_all") { pauseAll(); }
      else if (action === "resume_all") { resumeAll(); }
    });
    const unlistenTorrent = listen("torrent-status", (e) => {
      const statuses = e.payload;
      torrentStatuses = statuses.map(s => {
        const prev = slugSmoothRate[s.slug];
        const smooth = prev === undefined ? (s.download_rate || 0) : prev + ((s.download_rate || 0) - prev) * RATE_ALPHA;
        slugSmoothRate = { ...slugSmoothRate, [s.slug]: smooth };
        return { ...s, download_rate: smooth };
      });
      const downloading = statuses.filter(
        s => s.state === "downloading" || s.state === "metadata" || s.state === "checking"
      );
      downSpeed = downloading.reduce((a, s) => a + (s.download_rate || 0), 0);
      upSpeed = statuses.reduce((a, s) => a + (s.upload_rate || 0), 0);
    });
    const unlistenDownloads = listen("download-progress", (e) => {
      const p = e.payload;
      if (p.done) showToast(`Download complete: ${p.name || p.slug}`, "success");
    });

    return () => {
      unlistenTray.then(f => f());
      unlistenTorrent.then(f => f());
      unlistenDownloads.then(f => f());
    };
  });

  async function toggleAll() {
    if (anyRunning) {
      for (const t of torrentStatuses) try { await invoke("torrent_pause", { slug: t.slug }); } catch (e) {}
    } else {
      for (const t of torrentStatuses) try { await invoke("torrent_resume", { slug: t.slug }); } catch (e) {}
    }
  }

  async function pauseAll() {
    for (const t of torrentStatuses) {
      if (t.state !== "paused" && t.state !== "stopped" && t.state !== "error")
        try { await invoke("torrent_pause", { slug: t.slug }); } catch (e) {}
    }
  }

  async function resumeAll() {
    for (const t of torrentStatuses) {
      if (t.state === "paused")
        try { await invoke("torrent_resume", { slug: t.slug }); } catch (e) {}
    }
  }

  function closeDetail() { detailGame = null; }

  async function handleViewGame(slug) {
    if (slug) {
      try { detailGame = await invoke("get_game", { slug }); } catch (e) {}
    } else {
      closeDetail();
    }
  }

  function handleNavigateTo(t) { tab = t; }

  function handleClearSearch() { rawQuery = ""; searchQuery = ""; }

  function handleClearAdvFilters() { advFilters = null; }

  function handleAdvSearch(filters) {
    advFilters = filters;
    rawQuery = "";
    searchQuery = "";
    tab = "browse";
  }

  function handleFilterGenre(g) {
    advFilters = { genre: [g] };
    rawQuery = "";
    searchQuery = "";
    tab = "browse";
  }

  function handleFilterDeveloper(d) {
    advFilters = { developer: [d] };
    rawQuery = "";
    searchQuery = "";
    tab = "browse";
  }

  function handleFilterPublisher(p) {
    advFilters = { publisher: [p] };
    rawQuery = "";
    searchQuery = "";
    tab = "browse";
  }

  function handleFilterTag(t) {
    advFilters = { tag: [t] };
    rawQuery = "";
    searchQuery = "";
    tab = "browse";
  }

  function handleFilterYear(y) {
    advFilters = { year: [y] };
    rawQuery = "";
    searchQuery = "";
    tab = "browse";
  }

  function goBrowse() {
    closeDetail();
    rawQuery = "";
    searchQuery = "";
    tab = "browse";
    advFilters = null;
  }

  function handleTorrentBarClick() { closeDetail(); tab = "queue"; }

  function formatSpeed(bytes) {
    if (bytes <= 0) return "\u2014";
    const units = ["B/s", "KB/s", "MB/s", "GB/s"];
    let i = 0, v = bytes;
    while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
    return v.toFixed(2) + " " + units[i];
  }

  function handleKeydown(e) {
    if (e.key === "Escape") closeDetail();
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="app">
  <!-- Titlebar -->
  <div class="titlebar" data-tauri-drag-region>
    <div class="titlebar-left">
      <span class="titlebar-icon">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
      </span>
      <span class="titlebar-title">GOG Archive</span>
      <div class="titlebar-search">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        <input type="text" placeholder="Search games..." bind:value={rawQuery} />
      </div>
    </div>
    <div class="titlebar-right">
      <button class="tb-btn" onclick={() => handleNavigateTo("queue")} aria-label="Downloads">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
        {#if torrentStatuses.length}
          <span class="badge">{torrentStatuses.length}</span>
        {/if}
      </button>
      <button class="tb-btn" onclick={() => appWindow.minimize()} aria-label="Minimize">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="5" y1="12" x2="19" y2="12"/></svg>
      </button>
      <button class="tb-btn tb-close" onclick={() => appWindow.close()} aria-label="Close">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>
  </div>

  <!-- Tab bar -->
  <div class="tabbar">
    {#each tabs as t}
      <button class="tab" class:active={tab === t.id} onclick={() => (tab = t.id)}>
        {t.label}
        {#if t.count !== undefined && t.count > 0}
          <span class="tab-count">{t.count > 999 ? "999+" : t.count}</span>
        {/if}
      </button>
    {/each}
  </div>

  <!-- Torrent bar -->
  {#if torrentStatuses.length > 0}
    <div class="torrent-bar" onclick={handleTorrentBarClick} onkeydown={(e) => e.key === 'Enter' && handleTorrentBarClick()} role="button" tabindex="0" aria-label="Open downloads">
      <div class="tbar-left">
        <span class="tbar-count">{torrentStatuses.filter(s => s.state === "downloading" || s.state === "metadata" || s.state === "checking").length} active</span>
        <span class="tbar-dots">&middot;</span>
        <span class="tbar-speed down">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="7 13 12 18 17 13"/><line x1="12" y1="18" x2="12" y2="6"/></svg>
          {formatSpeed(downSpeed)}
        </span>
        <span class="tbar-speed up">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="17 11 12 6 7 11"/><line x1="12" y1="18" x2="12" y2="6"/></svg>
          {formatSpeed(upSpeed)}
        </span>
      </div>
      <div class="tbar-right">
        <button class="tbar-toggle" onclick={(e) => { e.stopPropagation(); toggleAll(); }} title={anyRunning ? "Pause All" : "Resume All"}>
          {#if anyRunning}
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
          {:else}
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
          {/if}
        </button>
      </div>
    </div>
  {/if}

  <!-- Tab content -->
  <div class="content">
    {#if tab === "browse"}
      <Browse
        {searchQuery}
        {advFilters}
        ongameCount={(n) => (gameCount = n)}
        onviewGame={handleViewGame}
        onclearSearch={handleClearSearch}
        onclearAdvFilters={handleClearAdvFilters}
        onfilterGenre={handleFilterGenre}
      />
    {:else if tab === "queue"}
      <Queue {torrentStatuses} onviewGame={handleViewGame} />
    {:else if tab === "library"}
      <Library onviewGame={handleViewGame} onlibraryCount={(n) => (libraryCount = n)} />
    {:else if tab === "settings"}
      <Settings />
    {/if}
  </div>
</div>

{#if detailGame}
  <GameModal
    game={detailGame}
    onclose={closeDetail}
    onnavigateTo={handleNavigateTo}
    onfilterGenre={handleFilterGenre}
    onfilterTag={handleFilterTag}
    onfilterDeveloper={handleFilterDeveloper}
    onfilterPublisher={handleFilterPublisher}
    onfilterYear={handleFilterYear}
  />
{/if}

<Toast />
<Confirm />

<style>
  .app {
    display: flex;
    flex-direction: column;
    height: 100vh;
    background: var(--bg);
    color: var(--text);
    overflow: hidden;
  }

  .titlebar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 12px;
    background: var(--surface);
    border-bottom: 1px solid var(--border);
    user-select: none;
    flex-shrink: 0;
    gap: 12px;
  }

  .titlebar-left {
    display: flex;
    align-items: center;
    gap: 10px;
    flex: 1;
    min-width: 0;
  }

  .titlebar-icon { color: var(--accent2); display: flex; align-items: center; flex-shrink: 0; }

  .titlebar-title {
    font-size: .85rem;
    font-weight: 700;
    color: var(--text);
    flex-shrink: 0;
  }

  .titlebar-search {
    position: relative;
    flex: 1;
    max-width: 320px;
  }

  .titlebar-search svg {
    position: absolute;
    left: 10px;
    top: 50%;
    transform: translateY(-50%);
    color: var(--text-muted);
    pointer-events: none;
  }

  .titlebar-search input {
    width: 100%;
    padding: 6px 10px 6px 32px;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--bg);
    color: var(--text);
    font-size: .8rem;
    outline: none;
    transition: border .2s;
  }

  .titlebar-search input:focus { border-color: var(--text-muted); }

  .titlebar-right { display: flex; align-items: center; gap: 6px; }

  .tb-btn {
    position: relative;
    width: 32px;
    height: 32px;
    display: flex;
    align-items: center;
    justify-content: center;
    border: none;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
    transition: all .15s;
  }

  .tb-btn:hover { background: rgba(255,255,255,.06); color: var(--text); }

  .tb-close:hover { background: rgba(220,38,38,.15); color: #ef4444; }

  .badge {
    position: absolute;
    top: 4px;
    right: 4px;
    min-width: 14px;
    height: 14px;
    padding: 0 4px;
    font-size: .55rem;
    font-weight: 700;
    background: var(--accent);
    color: #fff;
    border-radius: 7px;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .tabbar {
    display: flex;
    gap: 0;
    border-bottom: 1px solid var(--border);
    background: var(--surface);
    flex-shrink: 0;
    padding: 0 8px;
  }

  .tab {
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 9px 16px;
    border: none;
    border-bottom: 2px solid transparent;
    background: transparent;
    color: var(--text-muted);
    font-size: .82rem;
    cursor: pointer;
    transition: all .15s;
    margin-bottom: -1px;
  }

  .tab:hover { color: var(--text); border-bottom-color: rgba(255,255,255,.2); }

  .tab.active { color: var(--text); border-bottom-color: var(--text); }

  .tab-count {
    font-size: .6rem;
    padding: 1px 6px;
    border-radius: 8px;
    background: rgba(255,255,255,.06);
    color: var(--text-muted);
    line-height: 1.4;
  }

  .tab.active .tab-count { background: rgba(255,255,255,.1); color: var(--text); }

  .torrent-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 6px 12px;
    background: var(--surface);
    border-bottom: 1px solid var(--border);
    cursor: pointer;
    flex-shrink: 0;
    transition: background .15s;
  }

  .torrent-bar:hover { background: var(--surface-hover); }

  .tbar-left { display: flex; align-items: center; gap: 6px; font-size: .72rem; color: var(--text-muted); }

  .tbar-dots { opacity: .4; }

  .tbar-speed { display: flex; align-items: center; gap: 3px; font-weight: 600; }

  .tbar-speed.down { color: var(--accent2); }
  .tbar-speed.up { color: #ffc107; }

  .tbar-right { display: flex; align-items: center; gap: 6px; }

  .tbar-toggle {
    width: 24px;
    height: 24px;
    display: flex;
    align-items: center;
    justify-content: center;
    border: none;
    border-radius: 4px;
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
    transition: all .15s;
  }

  .tbar-toggle:hover { background: rgba(255,255,255,.08); color: var(--text); }

  .content {
    flex: 1;
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }
</style>
