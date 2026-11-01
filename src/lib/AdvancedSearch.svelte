<script>
  import { onMount } from "svelte";
  import { invoke } from "./ipc.js";

  let { currentFilters, onapply, onclose } = $props();

  let titleQuery = $state("");
  let advTab = $state("genres");
  let tabSearch = $state("");
  let filterData = $state(null);
  let liveCount = $state(null);
  let countTimer = null;
  let countSeq = 0;

  let selected = $state({
    genre: [],
    tag: [],
    developer: [],
    publisher: [],
    year: [],
  });

  onMount(() => {
    loadFilters();
    if (currentFilters && Object.keys(currentFilters).length) {
      titleQuery = currentFilters.title || "";
      for (const key of Object.keys(selected)) {
        if (currentFilters[key]) {
          selected[key] = Array.isArray(currentFilters[key])
            ? [...currentFilters[key]]
            : currentFilters[key].split(",").filter(Boolean);
        }
      }
    }
    scheduleCount();
    return () => clearTimeout(countTimer);
  });

  // Live match count — same behavior as the site (debounced, latest wins)
  function scheduleCount() {
    clearTimeout(countTimer);
    countTimer = setTimeout(runCount, 300);
  }

  async function runCount() {
    const seq = ++countSeq;
    try {
      // Spread to plain arrays: contextBridge structured-clone rejects
      // Svelte $state proxies ("An object could not be cloned").
      const r = await invoke("search_games", {
        query: titleQuery,
        limit: 1,
        offset: 0,
        genre: [...selected.genre],
        tag: [...selected.tag],
        developer: [...selected.developer],
        publisher: [...selected.publisher],
        year: [...selected.year],
      });
      if (seq !== countSeq) return; // stale response
      liveCount = r?.total ?? 0;
    } catch (e) {
      /* keep the last known count */
    }
  }

  async function loadFilters() {
    try {
      filterData = await invoke("get_filters");
    } catch (e) {}
  }

  function toggleFilter(key, val) {
    const idx = selected[key].indexOf(val);
    if (idx >= 0) selected[key].splice(idx, 1);
    else selected[key].push(val);
    scheduleCount();
  }

  const TAB_CFG = [
    { id: "genres", label: "Genres", stateKey: "genre", placeholder: "genres" },
    { id: "tags", label: "Tags", stateKey: "tag", placeholder: "tags" },
    { id: "developers", label: "Developers", stateKey: "developer", placeholder: "developers" },
    { id: "publishers", label: "Publishers", stateKey: "publisher", placeholder: "publishers" },
    { id: "years", label: "Years", stateKey: "year", placeholder: "years" },
  ];

  let tabCfg = $derived(TAB_CFG.find(t => t.id === advTab) || TAB_CFG[0]);
  let currentValues = $derived(filterData ? (filterData[tabCfg.id] || []) : []);
  let selectedSet = $derived(selected[tabCfg.stateKey] || []);
  let filteredValues = $derived(tabSearch
    ? currentValues.filter(v => v.toLowerCase().includes(tabSearch.toLowerCase()))
    : currentValues);

  function switchTab(id) {
    advTab = id;
    tabSearch = "";
  }

  function clearAll() {
    titleQuery = "";
    for (const key of Object.keys(selected)) selected[key] = [];
    scheduleCount();
  }

  function apply() {
    onapply?.({ title: titleQuery, ...selected });
  }

  function close() { onclose?.(); }
  function handleOverlayClick(e) { if (e.target === e.currentTarget) close(); }
  function handleKeydown(e) { if (e.key === "Escape") close(); }

  // span[role=button] keyboard activation (site markup parity)
  function activate(fn) {
    return (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fn(); }
    };
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="modal" role="presentation">
  <div class="modal-backdrop" onclick={handleOverlayClick} role="presentation"></div>
  <div class="modal-content" role="dialog" aria-modal="true" aria-label="Advanced Search">
    <button class="modal-close" onclick={close} aria-label="Close">
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
      </svg>
    </button>
    <div class="adv-header">
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="2" y1="14" x2="6" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="22" y2="16"/></svg>
      <h2>Advanced Search</h2>
    </div>
    <div class="adv-body">
      <div class="adv-title-search">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        <input type="text" placeholder="Search by title..." autocomplete="off" aria-label="Search by title" bind:value={titleQuery} oninput={scheduleCount} />
      </div>

      <div class="adv-chips">
        {#each selected.genre as v}
          <span class="adv-chip">Genre: {v}
            <span class="adv-chip-remove" role="button" tabindex="0" aria-label="Remove filter {v}" onclick={() => toggleFilter("genre", v)} onkeydown={activate(() => toggleFilter("genre", v))}>✕</span></span>
        {/each}
        {#each selected.tag as v}
          <span class="adv-chip">Tag: {v}
            <span class="adv-chip-remove" role="button" tabindex="0" aria-label="Remove filter {v}" onclick={() => toggleFilter("tag", v)} onkeydown={activate(() => toggleFilter("tag", v))}>✕</span></span>
        {/each}
        {#each selected.developer as v}
          <span class="adv-chip">Dev: {v}
            <span class="adv-chip-remove" role="button" tabindex="0" aria-label="Remove filter {v}" onclick={() => toggleFilter("developer", v)} onkeydown={activate(() => toggleFilter("developer", v))}>✕</span></span>
        {/each}
        {#each selected.publisher as v}
          <span class="adv-chip">Pub: {v}
            <span class="adv-chip-remove" role="button" tabindex="0" aria-label="Remove filter {v}" onclick={() => toggleFilter("publisher", v)} onkeydown={activate(() => toggleFilter("publisher", v))}>✕</span></span>
        {/each}
        {#each selected.year as v}
          <span class="adv-chip">Year: {v}
            <span class="adv-chip-remove" role="button" tabindex="0" aria-label="Remove filter {v}" onclick={() => toggleFilter("year", v)} onkeydown={activate(() => toggleFilter("year", v))}>✕</span></span>
        {/each}
      </div>

      {#if filterData}
        <div class="adv-tabs">
          {#each TAB_CFG as t}
            <button class="adv-tab" class:active={advTab === t.id} onclick={() => switchTab(t.id)}>{t.label}
              <span class="count">{(filterData[t.id] ? filterData[t.id].length : 0).toLocaleString()}</span>
              {#if selected[t.stateKey].length}
                <span class="sel">({selected[t.stateKey].length})</span>
              {/if}
            </button>
          {/each}
        </div>

        <div class="adv-tab-search">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          <input type="text" placeholder="Filter {tabCfg.placeholder}..." autocomplete="off" aria-label="Filter {tabCfg.placeholder}" bind:value={tabSearch} />
        </div>

        <div class="adv-pills">
          {#each filteredValues as v}
            <span
              class="adv-pill"
              class:active={selectedSet.includes(v)}
              role="button"
              tabindex="0"
              onclick={() => toggleFilter(tabCfg.stateKey, v)}
              onkeydown={activate(() => toggleFilter(tabCfg.stateKey, v))}>{#if selectedSet.includes(v)}<span class="check">&#10003;</span>{/if}{v}</span>
          {:else}
            <span class="adv-pill adv-empty">No matches</span>
          {/each}
        </div>
      {:else}
        <div class="adv-tabs"></div>
        <div class="adv-tab-search"></div>
        <div class="adv-pills">
          <span class="adv-pill adv-empty">Loading filters…</span>
        </div>
      {/if}

      <div class="adv-footer">
        <button class="adv-clear" onclick={clearAll}>Clear all</button>
        <div class="adv-footer-right">
          <span class="count"><strong>{liveCount ?? '…'}</strong>
            game{liveCount === 1 ? '' : 's'} match</span>
          <button class="adv-apply" onclick={apply}>Search</button>
        </div>
      </div>
    </div>
  </div>
</div>

<style>
  /* ---------- Dialog mechanics (redesign Modal.svelte parity) ----------
     App chrome adaptation: top pad clears the 30px titlebar, bottom clears
     the status bar — the site has no such chrome. */
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

  /* ---------- Advanced search dialog (redesign AdvFilters.svelte parity) ---------- */
  .adv-header {
    padding: 24px 32px 0;
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .adv-header svg {
    color: var(--foam);
    flex-shrink: 0;
  }

  .adv-header h2 {
    font-family: var(--font-display);
    font-size: 1.25rem;
    font-weight: 700;
    color: var(--foam);
    letter-spacing: -.01em;
  }

  .adv-body {
    padding: 16px 32px 24px;
  }

  .adv-title-search {
    position: relative;
    margin-bottom: 14px;
  }

  .adv-title-search svg {
    position: absolute;
    left: 12px;
    top: 50%;
    transform: translateY(-50%);
    color: var(--dim);
    pointer-events: none;
  }

  .adv-title-search input {
    width: 100%;
    padding: 9px 14px 9px 38px;
    border: 1px solid var(--line);
    border-radius: var(--radius-sm);
    background: var(--shelf);
    color: var(--foam);
    font-family: var(--font-ui);
    font-size: .88rem;
    outline: none;
    transition: border-color .15s, background .15s;
  }

  .adv-title-search input:focus {
    border-color: var(--lure-mid);
    background: var(--trench);
  }

  /* Active filter chips */
  .adv-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 5px;
    margin-bottom: 14px;
    min-height: 0;
  }

  .adv-chips:empty {
    display: none;
  }

  .adv-chip {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 3px 8px 3px 10px;
    border-radius: 999px;
    font-size: .7rem;
    font-weight: 500;
    background: var(--lure-dim);
    border: 1px solid var(--lure-mid);
    color: var(--foam);
  }

  .adv-chip-remove {
    cursor: pointer;
    opacity: .6;
    transition: opacity .15s;
    display: flex;
  }

  .adv-chip-remove:hover {
    opacity: 1;
  }

  /* Tabs */
  .adv-tabs {
    display: flex;
    gap: 4px;
    margin-bottom: 12px;
    border-bottom: 1px solid var(--line-soft);
    padding-bottom: 0;
  }

  .adv-tab {
    padding: 7px 16px;
    border: none;
    border-bottom: 2px solid transparent;
    background: transparent;
    color: var(--dim);
    font-family: var(--font-ui);
    font-size: .74rem;
    font-weight: 600;
    letter-spacing: .01em;
    cursor: pointer;
    transition: all .15s;
    margin-bottom: -1px;
    white-space: nowrap;
  }

  .adv-tab:hover {
    color: var(--foam);
    border-bottom-color: var(--line);
  }

  .adv-tab.active {
    color: var(--foam);
    border-bottom-color: var(--lure);
  }

  .adv-tab .count {
    font-size: .64rem;
    margin-left: 4px;
    opacity: .7;
  }

  .adv-tab .sel {
    font-size: .64rem;
    margin-left: 3px;
    color: var(--pulse);
  }

  /* Tab search */
  .adv-tab-search {
    position: relative;
    margin-bottom: 10px;
  }

  .adv-tab-search svg {
    position: absolute;
    left: 10px;
    top: 50%;
    transform: translateY(-50%);
    color: var(--dim);
    pointer-events: none;
  }

  .adv-tab-search input {
    width: 100%;
    padding: 7px 10px 7px 32px;
    border: 1px solid var(--line);
    border-radius: var(--radius-sm);
    background: var(--shelf);
    color: var(--foam);
    font-family: var(--font-ui);
    font-size: .8rem;
    outline: none;
    transition: border-color .15s, background .15s;
  }

  .adv-tab-search input:focus {
    border-color: var(--lure-mid);
    background: var(--trench);
  }

  /* Pills */
  .adv-pills {
    display: flex;
    flex-wrap: wrap;
    gap: 5px;
    max-height: 280px;
    overflow-y: auto;
    padding: 2px 0;
  }

  .adv-pills::-webkit-scrollbar {
    width: 6px;
  }
  .adv-pills::-webkit-scrollbar-track {
    background: transparent;
  }
  .adv-pills::-webkit-scrollbar-thumb {
    background: rgba(255, 255, 255, .22);
    border-radius: 3px;
  }
  .adv-pills::-webkit-scrollbar-thumb:hover {
    background: rgba(255, 255, 255, .35);
  }

  .adv-pill {
    padding: 4px 13px;
    border-radius: 999px;
    font-size: .76rem;
    cursor: pointer;
    transition: all .12s;
    background: var(--shelf);
    border: 1px solid var(--line);
    color: var(--mist);
    line-height: 1.4;
    white-space: nowrap;
    user-select: none;
  }

  .adv-pill:hover {
    border-color: var(--lure-mid);
    color: var(--foam);
    background: var(--trench);
  }

  .adv-pill.active {
    background: var(--lure);
    border-color: var(--lure);
    color: var(--abyss);
    font-weight: 600;
  }

  .adv-pill .check {
    margin-right: 3px;
    opacity: 0;
    transition: opacity .1s;
  }

  .adv-pill.active .check {
    opacity: 1;
  }

  /* Adv footer */
  .adv-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-top: 14px;
    padding-top: 12px;
    border-top: 1px solid var(--line-soft);
  }

  .adv-clear {
    padding: 5px 14px;
    border: 1px solid var(--line);
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--dim);
    font-size: .76rem;
    font-weight: 500;
    cursor: pointer;
    transition: all .15s;
  }

  .adv-clear:hover {
    border-color: var(--lure-mid);
    background: var(--lure-dim);
    color: var(--foam);
  }

  .adv-footer-right {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .adv-footer .count {
    font-size: .8rem;
    color: var(--dim);
  }

  .adv-footer .count strong {
    color: var(--foam);
    font-weight: 600;
  }

  .adv-apply {
    padding: 6px 20px;
    border: 1px solid var(--lure);
    border-radius: var(--radius-sm);
    background: var(--lure);
    color: var(--abyss);
    font-size: .8rem;
    font-weight: 600;
    cursor: pointer;
    transition: all .15s;
  }

  .adv-apply:hover {
    background: var(--pulse);
    box-shadow: 0 4px 18px var(--lure-glow);
  }
</style>
