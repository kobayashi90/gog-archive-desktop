<script>
  import { invoke } from "@tauri-apps/api/core";
  import GameCard from "./GameCard.svelte";
  import { showToast } from "./stores.js";

  let { onviewGame, onlibraryCount } = $props();

  let library = $state([]);
  let loading = $state(true);
  let sort = $state("title");

  let sortedGames = $derived.by(() => {
    const sorted = [...library];
    if (sort === "title") sorted.sort((a, b) => a.title.localeCompare(b.title));
    else if (sort === "rating") sorted.sort((a, b) => (b.rating || 0) - (a.rating || 0));
    return sorted;
  });

  async function load() {
    loading = true;
    try {
      library = await invoke("get_library");
    } catch (e) {
      showToast("Failed to load library: " + e, "error");
    }
    loading = false;
  }

  $effect(() => {
    if (library.length > 0) {
      onlibraryCount?.(library.length);
    }
  });

  $effect(load);
</script>

<div class="library">
  <div class="library-header">
    <h2>My Library</h2>
    <div class="sort-group">
      <button class="sort-btn" class:active={sort === "title"} onclick={() => (sort = "title")}>Name</button>
      <button class="sort-btn" class:active={sort === "rating"} onclick={() => (sort = "rating")}>Rating</button>
    </div>
  </div>

  {#if loading}
    <div class="loading">
      <div class="spin"></div>
      <span>Loading library...</span>
    </div>
  {:else if library.length === 0}
    <div class="empty">
      <p>Your library is empty. Add your GOG account in settings to sync your games.</p>
    </div>
  {:else}
    <div class="game-grid">
      {#each sortedGames as game}
        <GameCard {game} onviewGame={(slug) => onviewGame?.(slug)} />
      {/each}
    </div>
  {/if}
</div>

<style>
  .library { padding: 12px 12px 0; display: flex; flex-direction: column; gap: 12px; flex: 1; overflow-y: auto; }

  .library-header { display: flex; align-items: center; gap: 12px; }

  .library-header h2 { font-size: 18px; font-weight: 600; color: var(--text); margin: 0; }

  .sort-group { display: flex; gap: 2px; background: var(--surface); border-radius: var(--radius-sm); padding: 2px; }

  .sort-btn { padding: 4px 12px; font-size: .72rem; border: none; background: transparent; color: var(--text-muted); border-radius: 4px; cursor: pointer; transition: all .15s; }

  .sort-btn.active { background: var(--surface-hover); color: var(--text); }

  .game-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
    gap: 12px;
  }

  .loading { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; color: var(--text-muted); }

  .spin { width: 28px; height: 28px; border: 3px solid var(--border); border-top-color: var(--accent); border-radius: 50%; animation: spin 0.6s linear infinite; }

  @keyframes spin { to { transform: rotate(360deg); } }

  .empty { flex: 1; display: flex; align-items: center; justify-content: center; color: var(--text-muted); font-size: .85rem; text-align: center; padding: 40px; }
</style>
