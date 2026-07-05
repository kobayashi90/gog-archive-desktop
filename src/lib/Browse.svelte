<script>
  import { onMount } from "svelte";
  import { invoke } from "@tauri-apps/api/core";
  import GameCard from "./GameCard.svelte";

  let { advFilters, searchQuery, ongameCount, onviewGame, onclearSearch, onclearAdvFilters, onfilterGenre } = $props();

  let query = $state("");
  let sort = $state("popularity_ranking");
  let order = $state("ASC");
  let games = $state([]);
  let total = $state(0);
  let limit = $state(48);
  let offset = $state(0);
  let loading = $state(true);
  let error = $state(false);
  let isMounted = $state(false);

  onMount(() => {
    isMounted = true;
  });

  $effect(() => {
    if (isMounted && searchQuery !== query) {
      query = searchQuery;
      offset = 0;
      search();
    }
  });

  $effect(() => {
    if (isMounted && advFilters) {
      offset = 0;
      search();
    }
  });

  async function search() {
    loading = true;
    error = false;
    try {
      const result = await invoke("search_games", {
        query,
        limit,
        offset,
        genre: advFilters?.genre?.length ? advFilters.genre.join("||") : null,
        tag: advFilters?.tag?.length ? advFilters.tag.join("||") : null,
        developer: advFilters?.developer?.length ? advFilters.developer.join("||") : null,
        publisher: advFilters?.publisher?.length ? advFilters.publisher.join("||") : null,
        year: advFilters?.year?.length ? advFilters.year.join("||") : null,
        sort,
        order,
      });
      games = result.games;
      total = result.total;
      ongameCount?.(total);
    } catch (e) {
      error = true;
    }
    loading = false;
  }

  function prevPage() { offset = Math.max(0, offset - limit); search(); }
  function nextPage() { offset += limit; search(); }
  function goPage(n) { offset = n * limit; search(); }

  function viewGame(slug) { onviewGame?.(slug); }

  function filterGenre(g) { onfilterGenre?.(g); }

  function clearFilters() {
    onclearAdvFilters?.();
  }

  function totalPages() { return Math.ceil(total / limit); }

  function pageRange() {
    const tp = totalPages();
    const current = Math.floor(offset / limit);
    const pages = [];
    if (tp <= 7) {
      for (let i = 0; i < tp; i++) pages.push(i);
    } else {
      pages.push(0);
      if (current > 2) pages.push(-1);
      for (let i = Math.max(1, current - 1); i <= Math.min(tp - 2, current + 1); i++) pages.push(i);
      if (current < tp - 3) pages.push(-2);
      pages.push(tp - 1);
    }
    return pages;
  }
</script>

<div class="browse">
  {#if advFilters?.genre?.length || advFilters?.tag?.length || advFilters?.developer?.length || advFilters?.publisher?.length || advFilters?.year?.length || query}
    <div id="genreBar">
      <strong>Filtering by </strong>
      {#if query}search: <strong>{query}</strong>{/if}
      {#if advFilters.genre?.length}{#if query}; {/if}genre: <strong>{advFilters.genre.join(", ")}</strong>{/if}
      {#if advFilters.tag?.length}{#if query || advFilters.genre?.length}; {/if}tag: <strong>{advFilters.tag.join(", ")}</strong>{/if}
      {#if advFilters.developer?.length}{#if query || advFilters.genre?.length || advFilters.tag?.length}; {/if}developer: <strong>{advFilters.developer.join(", ")}</strong>{/if}
      {#if advFilters.publisher?.length}{#if query || advFilters.genre?.length || advFilters.tag?.length || advFilters.developer?.length}; {/if}publisher: <strong>{advFilters.publisher.join(", ")}</strong>{/if}
      {#if advFilters.year?.length}{#if query || advFilters.genre?.length || advFilters.tag?.length || advFilters.developer?.length || advFilters.publisher?.length}; {/if}year: <strong>{advFilters.year.join(", ")}</strong>{/if}
      <span> &mdash; {total.toLocaleString()} game{total !== 1 ? "s" : ""}</span>
      <button class="clear-genre" onclick={clearFilters}>Clear</button>
    </div>
  {/if}

  {#if loading}
    <div id="loading" class="active">
      <div class="spinner"></div>
    </div>
  {:else if error}
    <div class="empty-state">
      <p>Failed to load games. Is the API accessible?</p>
      <button class="retry-btn" onclick={search}>Retry</button>
    </div>
  {:else if games.length === 0}
    <div class="empty-state">
      <p>No games found</p>
      <span class="sub">Try adjusting your search or filters</span>
    </div>
  {:else}
    <div id="grid">
      {#each games as game, i}
        <GameCard {game} onviewGame={() => viewGame(game.slug)} onfilterGenre={(g) => filterGenre(g)} />
      {/each}
    </div>

    {#if total > limit}
      <div id="pagination">
        <button disabled={offset === 0} onclick={prevPage}>&laquo; Prev</button>
        {#each pageRange() as p}
          {#if p < 0}
            <span class="page-info">&hellip;</span>
          {:else}
            <button class:active={offset === p * limit} onclick={() => goPage(p)}>{p + 1}</button>
          {/if}
        {/each}
        <button disabled={offset + limit >= total} onclick={nextPage}>Next &raquo;</button>
      </div>
    {/if}

    <footer>
      <div class="footer-inner">
        <span class="footer-left">{total.toLocaleString()} games cataloged</span>
        <span class="footer-center"><button type="button" class="link-btn" onclick={() => invoke("open_url", { url: "https://discord.gg/yuvnx7FS89" })}>Discord</button><span class="footer-sep">|</span><button type="button" class="link-btn" onclick={() => invoke("open_url", { url: "https://status.squid-board.org" })}>Status</button><span class="footer-sep">|</span><button type="button" class="link-btn" onclick={() => invoke("open_url", { url: "https://give.calibour.com/49680ed027b06ced091ae39023b64151" })}>Donate</button></span>
        <span class="footer-credit">In Cooperation with <img src="/privateers.png" alt="Privateers.Wiki" class="footer-logo"> <button type="button" class="link-btn" onclick={() => invoke("open_url", { url: "https://privateers.wiki" })}>Privateers.Wiki</button></span>
      </div>
    </footer>
  {/if}
</div>

<style>
  #genreBar {
    display: flex;
    align-items: center;
    padding: 10px 16px;
    margin-bottom: 16px;
    border-radius: var(--radius-sm);
    background: rgba(255,255,255,.04);
    border: 1px solid rgba(255,255,255,.1);
    font-size: .85rem;
    color: var(--text);
    gap: 4px;
    flex-wrap: wrap;
  }

  #genreBar strong {
    color: var(--text);
  }

  .clear-genre {
    margin-left: 12px;
    padding: 3px 12px;
    border: 1px solid var(--border);
    border-radius: 12px;
    background: transparent;
    color: var(--text-muted);
    font-size: .78rem;
    cursor: pointer;
    transition: all .2s;
  }

  .clear-genre:hover {
    border-color: #ef444466;
    background: rgba(239,68,68,.1);
    color: #ef4444;
  }

  #grid {
    display: grid;
    grid-template-columns: repeat(6, 1fr);
    gap: 16px;
    margin-bottom: 32px;
    isolation: isolate;
  }

  #loading {
    justify-content: center;
    padding: 60px 0;
  }

  #loading.active {
    display: flex;
  }

  .spinner {
    width: 36px;
    height: 36px;
    border: 3px solid var(--border);
    border-top-color: var(--text-muted);
    border-radius: 50%;
    animation: spin .7s linear infinite;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  .empty-state {
    text-align: center;
    padding: 60px 20px;
    color: var(--text-muted);
    font-size: .9rem;
  }

  .empty-state p {
    margin-bottom: 4px;
  }

  .empty-state .sub {
    font-size: .82rem;
    color: var(--text-muted);
  }

  .retry-btn {
    margin-top: 12px;
    padding: 8px 24px;
    background: var(--accent);
    color: #fff;
    border-radius: var(--radius-sm);
    font-size: .85rem;
    cursor: pointer;
    transition: background .15s;
  }

  .retry-btn:hover {
    background: var(--accent-hover, #8a6cff);
  }

  footer {
    padding: 24px;
    font-size: .8rem;
    color: var(--text-muted);
    border-top: 1px solid var(--border);
  }

  .footer-inner {
    display: flex;
    justify-content: space-between;
    align-items: center;
    flex-wrap: wrap;
    gap: 8px;
    max-width: 1400px;
    margin: 0 auto;
    padding: 0 24px;
    width: 100%;
    box-sizing: border-box;
  }

  .footer-left,
  .footer-center,
  .footer-credit {
    flex: 1;
  }

  .footer-left {
    text-align: left;
  }

  .footer-sep {
    color: var(--border);
    margin: 0 2px;
  }

  .footer-center {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
  }

  .footer-credit {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    justify-content: flex-end;
  }

  .link-btn {
    background: none;
    border: none;
    padding: 0;
    font: inherit;
    color: var(--text-muted);
    cursor: pointer;
    text-decoration: none;
  }

  .link-btn:hover {
    color: var(--text);
  }

  .footer-logo {
    width: 18px;
    height: 18px;
    border-radius: 3px;
  }

  #pagination {
    text-align: center;
    overflow-x: auto;
    white-space: nowrap;
    padding: 16px 0 40px;
    scrollbar-width: none;
    -ms-overflow-style: none;
  }

  #pagination::-webkit-scrollbar { display: none; }

  #pagination button {
    padding: 8px 16px;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--surface);
    color: var(--text);
    font-size: .85rem;
    cursor: pointer;
    transition: all .2s;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    margin: 0 2px;
  }

  #pagination button:hover:not(:disabled) {
    border-color: var(--text-muted);
    background: rgba(255,255,255,.04);
  }

  #pagination button:disabled {
    opacity: .35;
    cursor: not-allowed;
  }

  #pagination button.active {
    background: #2a2a3a;
    border-color: #2a2a3a;
    color: #fff;
  }

  .page-info {
    font-size: .85rem;
    color: var(--text-muted);
    padding: 0 8px;
  }

  @media (max-width: 900px) {
    #grid {
      grid-template-columns: repeat(4, 1fr);
    }
  }

  @media (max-width: 640px) {
    #grid {
      gap: 6px;
      grid-template-columns: repeat(2, 1fr);
    }

    #pagination {
      display: flex;
      justify-content: center;
      overflow: visible;
      white-space: normal;
      padding: 12px 2px 24px;
      gap: 0;
    }
    #pagination button {
      margin: 0 1.5px;
      flex: 1;
      min-width: 0;
      max-width: 80px;
      padding: 10px 6px;
    }
    .page-info {
      flex: none;
      width: 20px;
      padding: 0;
      display: flex;
      align-items: center;
      justify-content: center;
    }
  }
</style>
