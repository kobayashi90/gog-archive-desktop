<script>
  import { onMount } from "svelte";
  import { invoke } from "@tauri-apps/api/core";
  import { listen } from "@tauri-apps/api/event";
  import { getCurrentWindow } from "@tauri-apps/api/window";
  import { showToast, toasts } from "./lib/stores.js";
  import Browse from "./lib/Browse.svelte";
  import Queue from "./lib/Queue.svelte";
  import Library from "./lib/Library.svelte";
  import Settings from "./lib/Settings.svelte";
  import GameModal from "./lib/GameModal.svelte";
  import Toast from "./lib/Toast.svelte";
  import Confirm from "./lib/Confirm.svelte";

  let tab = $state("browse");
  let searchQuery = $state("");
  let advFilters = $state(null);
  let gameCount = $state(0);
  let libraryCount = $state(0);
  let detailGame = $state(null);
  let torrentStatuses = $state([]);
  let minimized = $state(false);
  let showToastBar = $state(false);

  let tabs = $derived([
    { id: "browse", label: "Browse", count: gameCount },
    { id: "queue", label: "Queue", count: torrentStatuses.length },
    { id: "library", label: "Library", count: libraryCount },
    { id: "settings", label: "Settings" },
  ]);

  onMount(async () => {
    const unlisten = await listen("torrent-update", (event) => {
      torrentStatuses = event.payload;
    });
    const unlistenDownloads = await listen("download-progress", (event) => {
      const p = event.payload;
      if (p.done) {
        showToast(`Download complete: ${p.name || p.slug}`, "success");
      }
    });
    const unlistenToast = await listen("show-toast", (event) => {
      const { message, type } = event.payload;
      showToast(message, type || "info", 5000);
    });

    return () => {
      unlisten();
      unlistenDownloads();
      unlistenToast();
    };
  });

  function closeDetail() {
    detailGame = null;
  }

  function handleViewGame(slug) {
    if (slug) {
      detailGame = { slug };
    } else {
      closeDetail();
    }
  }

  function handleNavigateTo(t) {
    tab = t;
  }

  function handleClearSearch() {
    searchQuery = "";
  }

  function handleClearAdvFilters() {
    advFilters = null;
  }

  function handleAdvSearch(filters) {
    advFilters = filters;
    searchQuery = "";
  }

  function handleFilterGenre(g) {
    advFilters = { genre: [g] };
    searchQuery = "";
    tab = "browse";
  }

  function handleFilterDeveloper(d) {
    advFilters = { developer: [d] };
    searchQuery = "";
    tab = "browse";
  }

  function handleFilterPublisher(p) {
    advFilters = { publisher: [p] };
    searchQuery = "";
    tab = "browse";
  }

  function handleFilterTag(t) {
    advFilters = { tag: [t] };
    searchQuery = "";
    tab = "browse";
  }

  function handleFilterYear(y) {
    advFilters = { year: [y] };
    searchQuery = "";
    tab = "browse";
  }

  let appWindow = getCurrentWindow();

  async function toggleMinimize() {
    minimized = !minimized;
    if (minimized) {
      await appWindow.minimize();
    } else {
      await appWindow.unminimize();
    }
  }

  let trayTimer;

  function showTrayToast(msg) {
    showToastBar = true;
    clearTimeout(trayTimer);
    trayTimer = setTimeout(() => {
      showToastBar = false;
    }, 3000);
  }
</script>

<div class="app" class:minimized>
  <!-- Titlebar -->
  <div class="titlebar" data-tauri-drag-region>
    <div class="titlebar-left">
      <span class="titlebar-icon">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
      </span>
      <span class="titlebar-title">GOG Archive</span>
      <div class="titlebar-search">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        <input
          type="text"
          placeholder="Search games..."
          bind:value={searchQuery}
        />
      </div>
    </div>
    <div class="titlebar-right">
      <button class="tb-btn" onclick={() => (tab = "queue")} aria-label="Queue">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
        {#if torrentStatuses.length}
          <span class="badge">{torrentStatuses.length}</span>
        {/if}
      </button>
      <button class="tb-btn minimize-btn" onclick={toggleMinimize} aria-label="Minimize to tray">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="5" y1="12" x2="19" y2="12"/></svg>
      </button>
    </div>
  </div>

  <!-- Tab bar -->
  <div class="tabbar">
    {#each tabs as t}
      <button class="tab" class:active={tab === t.id} onclick={() => (tab = t.id)}>
        {t.label}
        {#if t.count !== undefined}
          <span class="tab-count">{t.count > 999 ? "999+" : t.count}</span>
        {/if}
      </button>
    {/each}
  </div>

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

{#if showToastBar}
  <div class="tray-toast">
    Downloading in background
  </div>
{/if}

<style>
  .app {
    display: flex;
    flex-direction: column;
    height: 100vh;
    background: var(--bg);
    color: var(--text);
    overflow: hidden;
  }

  .app.minimized { opacity: .85; }

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

  .titlebar-search input:focus {
    border-color: var(--text-muted);
  }

  .titlebar-right {
    display: flex;
    align-items: center;
    gap: 6px;
  }

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

  .tb-btn:hover {
    background: rgba(255,255,255,.06);
    color: var(--text);
  }

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

  .tab:hover {
    color: var(--text);
    border-bottom-color: rgba(255,255,255,.2);
  }

  .tab.active {
    color: var(--text);
    border-bottom-color: var(--text);
  }

  .tab-count {
    font-size: .6rem;
    padding: 1px 6px;
    border-radius: 8px;
    background: rgba(255,255,255,.06);
    color: var(--text-muted);
    line-height: 1.4;
  }

  .tab.active .tab-count { background: rgba(255,255,255,.1); color: var(--text); }

  .content {
    flex: 1;
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }

  .tray-toast {
    position: fixed;
    bottom: 16px;
    left: 50%;
    transform: translateX(-50%);
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 8px 16px;
    font-size: .8rem;
    color: var(--text-muted);
    z-index: 500;
    animation: fadeIn .2s ease-out;
  }

  @keyframes fadeIn { from { opacity: 0; transform: translateX(-50%) translateY(10px); } to { opacity: 1; transform: translateX(-50%) translateY(0); } }
</style>
