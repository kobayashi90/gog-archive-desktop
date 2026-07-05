<script>
  import { onMount } from "svelte";
  import { invoke } from "@tauri-apps/api/core";

  let { currentFilters, onapply, onclose } = $props();

  let titleQuery = $state("");
  let advTab = $state("genres");
  let tabSearch = $state("");
  let filterData = $state(null);

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
  });

  async function loadFilters() {
    try {
      filterData = await invoke("get_filters");
    } catch (e) {}
  }

  function toggleFilter(key, val) {
    const idx = selected[key].indexOf(val);
    if (idx >= 0) selected[key].splice(idx, 1);
    else selected[key].push(val);
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
  }

  function apply() {
    onapply?.({ title: titleQuery, ...selected });
  }

  function close() { onclose?.(); }
  function handleOverlayClick(e) { if (e.target === e.currentTarget) close(); }
</script>

<div class="modal-backdrop" onclick={handleOverlayClick} role="button" tabindex="0" onkeydown={(e) => e.key === 'Escape' && close()}>
  <div class="modal">
    <div class="adv-header">
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="2" y1="14" x2="6" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="22" y2="16"/></svg>
      <h2>Advanced Search</h2>
      <button class="close-btn" onclick={close} aria-label="Close">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>
    <div class="adv-body">
      <div class="adv-title-search">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        <input type="text" placeholder="Search by title..." bind:value={titleQuery} />
      </div>

      <div class="adv-chips">
        {#each selected.genre as v}
          <span class="adv-chip">Genre: {v} <button type="button" class="adv-chip-remove" onclick={() => toggleFilter("genre", v)}>&#10005;</button></span>
        {/each}
        {#each selected.tag as v}
          <span class="adv-chip">Tag: {v} <button type="button" class="adv-chip-remove" onclick={() => toggleFilter("tag", v)}>&#10005;</button></span>
        {/each}
        {#each selected.developer as v}
          <span class="adv-chip">Dev: {v} <button type="button" class="adv-chip-remove" onclick={() => toggleFilter("developer", v)}>&#10005;</button></span>
        {/each}
        {#each selected.publisher as v}
          <span class="adv-chip">Pub: {v} <button type="button" class="adv-chip-remove" onclick={() => toggleFilter("publisher", v)}>&#10005;</button></span>
        {/each}
        {#each selected.year as v}
          <span class="adv-chip">Year: {v} <button type="button" class="adv-chip-remove" onclick={() => toggleFilter("year", v)}>&#10005;</button></span>
        {/each}
      </div>

      <div class="adv-tabs">
        {#each TAB_CFG as t}
          <button class="adv-tab" class:active={advTab === t.id} onclick={() => switchTab(t.id)}>
            {t.label} <span class="count">{(filterData && filterData[t.id] ? filterData[t.id].length : 0).toLocaleString()}</span>
            {#if selected[t.stateKey].length}
              <span class="sel">({selected[t.stateKey].length})</span>
            {/if}
          </button>
        {/each}
      </div>

      <div class="adv-tab-search">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        <input type="text" placeholder="Filter {tabCfg.placeholder}..." bind:value={tabSearch} />
      </div>

      <div class="adv-pills">
        {#each filteredValues as v}
          <button type="button" class="adv-pill" class:active={selectedSet.includes(v)} onclick={() => toggleFilter(tabCfg.stateKey, v)}>
            {#if selectedSet.includes(v)}
              <span class="check">&#10003;</span>
            {/if}
            {v}
          </button>
        {/each}
      </div>

      <div class="adv-footer">
        <button class="adv-clear" onclick={clearAll}>Clear all</button>
        <div class="adv-footer-right">
          <button class="adv-apply" onclick={apply}>Search</button>
        </div>
      </div>
    </div>
  </div>
</div>

<style>
  .modal-backdrop {
    position: fixed; inset: 0;
    background: rgba(0,0,0,.85);
    display: flex; align-items: center; justify-content: center;
    padding: 40px;
    z-index: 200;
  }

  .modal {
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    width: 680px;
    max-width: 100%;
    max-height: 85vh;
    display: flex;
    flex-direction: column;
  }

  .adv-header {
    padding: 24px 32px 0;
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .adv-header svg { color: var(--text-muted); flex-shrink: 0; }

  .adv-header h2 {
    flex: 1;
    font-size: 1.1rem;
    font-weight: 700;
    color: #e4e4ec;
  }

  .close-btn {
    width: 28px; height: 28px;
    display: flex; align-items: center; justify-content: center;
    color: var(--text-muted); border-radius: 4px;
    transition: background .1s; cursor: pointer;
  }

  .close-btn:hover { background: var(--surface-hover); color: var(--text); }

  .adv-body {
    padding: 16px 32px 24px;
    overflow-y: auto;
    flex: 1;
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
    color: var(--text-muted);
    pointer-events: none;
  }

  .adv-title-search input {
    width: 100%;
    padding: 9px 14px 9px 38px;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--surface);
    color: var(--text);
    font-size: .88rem;
    outline: none;
    transition: border .2s;
  }

  .adv-title-search input:focus {
    border-color: var(--text-muted);
    box-shadow: 0 0 0 3px rgba(255,255,255,.06);
  }

  .adv-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 5px;
    margin-bottom: 14px;
    min-height: 0;
  }

  .adv-chips:empty { display: none; }

  .adv-chip {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 3px 8px 3px 10px;
    border-radius: 14px;
    font-size: .72rem;
    background: rgba(255,255,255,.06);
    border: 1px solid rgba(255,255,255,.15);
    color: var(--text);
  }

  .adv-chip-remove {
    background: none;
    border: none;
    padding: 0;
    color: inherit;
    font: inherit;
    cursor: pointer;
    opacity: .5;
    transition: opacity .15s;
    display: flex;
  }

  .adv-chip-remove:hover { opacity: 1; }

  .adv-tabs {
    display: flex;
    gap: 4px;
    margin-bottom: 12px;
    border-bottom: 1px solid var(--border);
    padding-bottom: 0;
  }

  .adv-tab {
    padding: 7px 16px;
    border: none;
    border-bottom: 2px solid transparent;
    background: transparent;
    color: var(--text-muted);
    font-size: .8rem;
    cursor: pointer;
    transition: all .15s;
    margin-bottom: -1px;
    white-space: nowrap;
  }

  .adv-tab:hover {
    color: var(--text);
    border-bottom-color: rgba(255,255,255,.2);
  }

  .adv-tab.active {
    color: var(--text);
    border-bottom-color: var(--text);
  }

  .adv-tab .count {
    font-size: .65rem;
    margin-left: 4px;
    opacity: .6;
  }

  .adv-tab .sel {
    font-size: .65rem;
    margin-left: 3px;
    color: var(--accent2);
  }

  .adv-tab-search {
    position: relative;
    margin-bottom: 10px;
  }

  .adv-tab-search svg {
    position: absolute;
    left: 10px;
    top: 50%;
    transform: translateY(-50%);
    color: var(--text-muted);
    pointer-events: none;
  }

  .adv-tab-search input {
    width: 100%;
    padding: 7px 10px 7px 32px;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--bg);
    color: var(--text);
    font-size: .8rem;
    outline: none;
    transition: border .2s;
  }

  .adv-tab-search input:focus {
    border-color: var(--text-muted);
  }

  .adv-pills {
    display: flex;
    flex-wrap: wrap;
    gap: 5px;
    max-height: 280px;
    overflow-y: auto;
    padding: 2px 0;
  }

  .adv-pill {
    padding: 4px 13px;
    border-radius: 14px;
    font-size: .74rem;
    cursor: pointer;
    transition: all .12s;
    background: var(--bg);
    border: 1px solid var(--border);
    color: var(--text-muted);
    line-height: 1.4;
    white-space: nowrap;
    user-select: none;
  }

  .adv-pill:hover {
    border-color: var(--text-muted);
    color: var(--text);
    background: rgba(255,255,255,.04);
  }

  .adv-pill.active {
    background: #2a2a3a;
    border-color: #2a2a3a;
    color: #fff;
  }

  .adv-pill .check {
    margin-right: 3px;
    opacity: 1;
  }

  .adv-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-top: 14px;
    padding-top: 12px;
    border-top: 1px solid var(--border);
  }

  .adv-clear {
    padding: 5px 14px;
    border: 1px solid var(--border);
    border-radius: 12px;
    background: transparent;
    color: var(--text-muted);
    font-size: .75rem;
    cursor: pointer;
    transition: all .15s;
  }

  .adv-clear:hover {
    border-color: #ef444466;
    background: rgba(239,68,68,.1);
    color: #ef4444;
  }

  .adv-footer-right {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .adv-apply {
    padding: 6px 18px;
    border: none;
    border-radius: var(--radius-sm);
    background: var(--accent);
    color: #fff;
    font-size: .82rem;
    font-weight: 600;
    cursor: pointer;
    transition: background .15s;
  }

  .adv-apply:hover {
    background: var(--accent-hover, #8a6cff);
  }
</style>
