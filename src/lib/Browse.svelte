<script>
  import { invoke } from "@tauri-apps/api/core";
  import GameCard from "./GameCard.svelte";
  import AdvancedSearch from "./AdvancedSearch.svelte";
  import { showToast } from "./stores.js";

  let {
    searchQuery,
    advFilters,
    ongameCount,
    onviewGame,
    onclearSearch,
    onclearAdvFilters,
    onfilterGenre,
  } = $props();

  let games = $state([]);
  let loading = $state(true);
  let sort = $state("title");
  let showAdvSearch = $state(false);

  let filtered = $derived.by(() => {
    let result = games;
    const q = (searchQuery || "").toLowerCase().trim();
    if (q) {
      result = result.filter(
        (g) =>
          g.title.toLowerCase().includes(q) ||
          (g.developer || "").toLowerCase().includes(q) ||
          (g.publisher || "").toLowerCase().includes(q)
      );
    }

    if (advFilters) {
      if (advFilters.genre && advFilters.genre.length) {
        result = result.filter((g) => {
          const gs = (g.genres || "").toLowerCase();
          return advFilters.genre.some((fg) => gs.includes(fg));
        });
      }
      if (advFilters.tag && advFilters.tag.length) {
        result = result.filter((g) => {
          const gs = (g.features || "").toLowerCase();
          return advFilters.tag.some((fg) => gs.includes(fg));
        });
      }
      if (advFilters.developer && advFilters.developer.length) {
        result = result.filter((g) => advFilters.developer.some((d) => g.developer?.toLowerCase() === d));
      }
      if (advFilters.publisher && advFilters.publisher.length) {
        result = result.filter((g) => advFilters.publisher.some((p) => g.publisher?.toLowerCase() === p));
      }
      if (advFilters.year && advFilters.year.length) {
        result = result.filter((g) => {
          const gy = g.release_date?.split("-")[0];
          return gy && advFilters.year.includes(gy);
        });
      }
    }

    result.sort((a, b) => a.title.localeCompare(b.title));
    return result;
  });

  let filteredCount = $derived(filtered.length);

  $effect(() => {
    ongameCount?.(filteredCount);
  });

  async function load() {
    loading = true;
    try {
      games = await invoke("get_games");
    } catch (e) {
      showToast("Failed to load games: " + e, "error");
    }
    loading = false;
  }

  $effect(load);

  function handleAdvSearch(filters) {
    showAdvSearch = false;
    onclearAdvFilters?.();
    onclearSearch?.();
    advFilters = filters;
  }
</script>

<div class="browse">
  <div class="browse-header">
    <div class="browse-header-left">
      <h2>Browse</h2>
      {#if filteredCount >= 0}
        <span class="game-count">{filteredCount.toLocaleString()} games</span>
      {/if}
    </div>
    <div class="browse-header-right">
      <button class="adv-search-btn" onclick={() => (showAdvSearch = true)}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="8" y1="11" x2="14" y2="11"/></svg>
        Advanced
        {#if advFilters && Object.keys(advFilters).some(k => advFilters[k]?.length)}
          <span class="filter-dot"></span>
        {/if}
      </button>
    </div>
  </div>

  {#if loading}
    <div class="loading">
      <div class="spin"></div>
      <span>Loading games...</span>
    </div>
  {:else if filtered.length === 0}
    <div class="empty">
      <p>No games found</p>
    </div>
  {:else}
    <div class="game-grid">
      {#each filtered as game}
        <GameCard {game} onviewGame={(slug) => onviewGame?.(slug)} onfilterGenre={(g) => onfilterGenre?.(g)} />
      {/each}
    </div>
  {/if}
</div>

{#if showAdvSearch}
  <AdvancedSearch currentFilters={advFilters || {}} onapply={handleAdvSearch} onclose={() => (showAdvSearch = false)} />
{/if}

<style>
  .browse { padding: 12px 12px 0; display: flex; flex-direction: column; gap: 12px; flex: 1; overflow-y: auto; }

  .browse-header { display: flex; align-items: center; justify-content: space-between; gap: 12px; }

  .browse-header-left { display: flex; align-items: center; gap: 10px; }

  .browse-header-left h2 { font-size: 18px; font-weight: 600; color: var(--text); margin: 0; }

  .game-count { font-size: .78rem; color: var(--text-muted); }

  .browse-header-right { display: flex; align-items: center; gap: 6px; }

  .adv-search-btn {
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 5px 12px;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text-muted);
    font-size: .75rem;
    cursor: pointer;
    transition: all .15s;
    position: relative;
  }

  .adv-search-btn:hover {
    border-color: var(--text-muted);
    color: var(--text);
  }

  .filter-dot {
    width: 6px; height: 6px; border-radius: 50%;
    background: var(--accent2);
    position: absolute;
    top: 3px;
    right: 3px;
  }

  .game-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
    gap: 12px;
  }

  .loading { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; color: var(--text-muted); }

  .spin { width: 28px; height: 28px; border: 3px solid var(--border); border-top-color: var(--accent); border-radius: 50%; animation: spin 0.6s linear infinite; }

  @keyframes spin { to { transform: rotate(360deg); } }

  .empty { flex: 1; display: flex; align-items: center; justify-content: center; color: var(--text-muted); font-size: .85rem; }
</style>
