<script>
  import { invoke } from "@tauri-apps/api/core";
  import { showToast } from "./stores.js";

  let {
    game,
    onclose,
    onnavigateTo,
    onfilterGenre,
    onfilterTag,
    onfilterDeveloper,
    onfilterPublisher,
    onfilterYear,
  } = $props();

  let imageFailed = $state(false);
  let details = $state(null);
  let loading = $state(false);
  let dlStatus = $state(null);
  let selectedOs = $state("windows");
  let dlType = $state("installer");

  let genres = $derived.by(() => {
    if (!game?.genres) return [];
    return game.genres.split(",").map((g) => g.trim()).filter(Boolean);
  });

  let features = $derived.by(() => {
    if (!game?.features) return [];
    return game.features.split(",").map((f) => f.trim()).filter(Boolean);
  });

  let langs = $derived.by(() => {
    if (!game?.languages) return [];
    return game.languages.split(",").map((l) => l.trim()).filter(Boolean);
  });

  let year = $derived(game?.release_date ? game.release_date.split("-")[0] : "N/A");

  async function loadDetails() {
    if (loading || details) return;
    loading = true;
    try {
      details = await invoke("get_game_details", { slug: game.slug });
    } catch (e) {
      showToast("Failed to load game details: " + e, "error");
    }
    loading = false;
  }

  let osBuilds = $derived(details?.downloads?.find(d => d.os === selectedOs)?.builds || []);
  let filteredBuilds = $derived(dlType === "installer"
    ? osBuilds.filter(b => !b.name.toLowerCase().includes("bonus"))
    : osBuilds.filter(b => b.name.toLowerCase().includes("bonus"))
  );

  function handleKeydown(e) {
    if (e.key === "Escape") onclose?.();
  }

  function handleOverlayClick(e) {
    if (e.target === e.currentTarget) onclose?.();
  }

  async function downloadBuild(build) {
    dlStatus = { slug: build.slug, progress: "preparing" };
    invoke("download_game", { slug: build.slug, name: build.name, os: selectedOs, type: dlType });
  }

  const OS_ICONS = {
    windows: '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M0 0h11.4v11.4H0zM12.6 0H24v11.4H12.6zM0 12.6h11.4V24H0zM12.6 12.6H24V24H12.6z"/></svg>',
    mac: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2C7.5 2 4 5.5 4 10c0 3.5 2 6.5 5 8l-1 4h8l-1-4c3-1.5 5-4.5 5-8 0-4.5-3.5-8-8-8z"/><circle cx="12" cy="10" r="2"/></svg>',
    linux: '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/></svg>',
  };
</script>

<svelte:window onkeydown={handleKeydown} />

{#if game}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="modal-overlay" onclick={handleOverlayClick} role="presentation">
    <div class="modal" role="dialog" aria-modal="true" aria-label={game.title}>
      <button class="close-btn" onclick={() => onclose?.()} aria-label="Close">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>

      <div class="modal-scroll">
        <div class="hero">
          {#if game.image && !imageFailed}
            <img src={game.image} alt={game.title}
              onerror={() => (imageFailed = true)}
            />
          {:else}
            <div class="hero-placeholder">
              <span class="hero-letter">{game.title[0]?.toUpperCase() || "?"}</span>
            </div>
          {/if}
          <div class="hero-overlay">
            <h1>{game.title}</h1>
            {#if game.developer || game.publisher}
              <p class="dev-pub">
                {game.developer}{#if game.developer && game.publisher} / {/if}{game.publisher}
              </p>
            {/if}
          </div>
        </div>

        <div class="content">
          <!-- Ratings & Meta -->
          <div class="meta-row">
            {#if game.rating}
              <div class="meta-chip rating">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 3l2.5 7.5L22 12l-7.5 1.5L12 21l-2.5-7.5L2 12l7.5-1.5z"/></svg>
                {game.rating.toFixed(1)}
              </div>
            {/if}
            <div class="meta-chip">{year}</div>
            {#if game.game_type}
              <div class="meta-chip">{game.game_type}</div>
            {/if}
          </div>

          <!-- Genres -->
          {#if genres.length}
            <div class="tags-section">
              <span class="tag-label">Genres</span>
              <div class="tag-list">
                {#each genres as g}
                  <button type="button" class="tag clickable" onclick={() => onfilterGenre?.(g)}>{g}</button>
                {/each}
              </div>
            </div>
          {/if}

          <!-- Features -->
          {#if features.length}
            <div class="tags-section">
              <span class="tag-label">Features</span>
              <div class="tag-list">
                {#each features as f}
                  <span class="tag">{f}</span>
                {/each}
              </div>
            </div>
          {/if}

          <!-- Languages -->
          {#if langs.length}
            <div class="tags-section">
              <span class="tag-label">Languages</span>
              <div class="tag-list">
                {#each langs as l}
                  <span class="tag">{l}</span>
                {/each}
              </div>
            </div>
          {/if}

          <!-- Tags -->
          {#if details?.tags?.length}
            <div class="tags-section">
              <span class="tag-label">Tags</span>
              <div class="tag-list">
                {#each details.tags as t}
                  <button type="button" class="tag clickable" onclick={() => onfilterTag?.(t)}>{t}</button>
                {/each}
              </div>
            </div>
          {/if}

          <!-- Description -->
          {#if game.description}
            <div class="description">
              <h3>About</h3>
              <p>{game.description}</p>
            </div>
          {/if}

          <!-- Details Grid -->
          <div class="details-grid">
            {#if game.developer}
              <div class="detail-item">
                <span class="detail-label">Developer</span>
                <button type="button" class="detail-link" onclick={() => onfilterDeveloper?.(game.developer)}>{game.developer}</button>
              </div>
            {/if}
            {#if game.publisher}
              <div class="detail-item">
                <span class="detail-label">Publisher</span>
                <button type="button" class="detail-link" onclick={() => onfilterPublisher?.(game.publisher)}>{game.publisher}</button>
              </div>
            {/if}
            {#if game.release_date}
              <div class="detail-item">
                <span class="detail-label">Release Date</span>
                <button type="button" class="detail-link" onclick={() => onfilterYear?.(year)}>{game.release_date}</button>
              </div>
            {/if}
          </div>

          <!-- Downloads -->
          <div class="downloads-section" onclick={loadDetails} onkeydown={(e) => e.key === 'Enter' && loadDetails()}>
            <h3>Downloads</h3>
            {#if loading}
              <p class="status-msg">Loading...</p>
            {:else if details?.downloads?.length}
              <div class="os-tabs">
                {#each details.downloads as dl}
                  <button type="button"
                    class="os-tab"
                    class:active={selectedOs === dl.os}
                    onclick={() => (selectedOs = dl.os)}>
                    {@html OS_ICONS[dl.os] || ""}
                    {dl.os}
                  </button>
                {/each}
              </div>
              <div class="dl-type-toggle">
                <button type="button"
                  class="dl-type-btn"
                  class:active={dlType === "installer"}
                  onclick={() => (dlType = "installer")}>Installers</button>
                <button type="button"
                  class="dl-type-btn"
                  class:active={dlType === "bonus"}
                  onclick={() => (dlType = "bonus")}>Bonus</button>
              </div>
              {#if filteredBuilds.length}
                <div class="build-list">
                  {#each filteredBuilds as build}
                    <div class="build-row" class:downloading={dlStatus?.slug === build.slug}>
                      <div class="build-info">
                        <span class="build-name">{build.name}</span>
                        {#if build.size}
                          <span class="build-size">{(build.size / 1024 / 1024).toFixed(0)} MB</span>
                        {/if}
                      </div>
                      <button type="button"
                        class="dl-btn"
                        disabled={dlStatus?.slug === build.slug}
                        onclick={() => downloadBuild(build)}>
                        {#if dlStatus?.slug === build.slug}
                          <span class="dl-spinner"></span>
                          Downloading...
                        {:else}
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                          Download
                        {/if}
                      </button>
                    </div>
                  {/each}
                </div>
              {:else}
                <p class="status-msg">No {dlType === "installer" ? "installer" : "bonus content"} builds for {selectedOs}</p>
              {/if}
            {:else if details}
              <p class="status-msg">No downloads available</p>
            {:else}
              <p class="status-msg">Click to load download details</p>
            {/if}
          </div>
        </div>
      </div>
    </div>
  </div>
{/if}

<style>
  .modal-overlay {
    position: fixed;
    inset: 0;
    z-index: 300;
    background: rgba(0,0,0,.85);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 20px;
  }

  .modal {
    position: relative;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    max-width: 620px;
    width: 100%;
    max-height: 85vh;
    overflow: hidden;
    box-shadow: 0 20px 60px rgba(0,0,0,.6);
  }

  .close-btn {
    position: absolute;
    top: 14px;
    right: 14px;
    z-index: 10;
    width: 32px;
    height: 32px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(0,0,0,.5);
    border: none;
    border-radius: 50%;
    color: #fff;
    cursor: pointer;
    transition: background .15s;
  }

  .close-btn:hover { background: rgba(0,0,0,.8); }

  .modal-scroll {
    overflow-y: auto;
    max-height: 85vh;
  }

  .hero {
    position: relative;
    width: 100%;
    aspect-ratio: 16/9;
    overflow: hidden;
    background: #111;
  }

  .hero img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }

  .hero-placeholder {
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    background: linear-gradient(135deg, #1a1a2e, #2d1b4e);
  }

  .hero-letter {
    font-size: 5rem;
    font-weight: 700;
    color: var(--text-muted);
    opacity: .5;
  }

  .hero-overlay {
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    padding: 32px 24px 20px;
    background: linear-gradient(transparent, rgba(0,0,0,.92));
  }

  .hero-overlay h1 {
    font-size: 1.4rem;
    font-weight: 700;
    margin-bottom: 4px;
    color: #fff;
    line-height: 1.2;
  }

  .dev-pub {
    font-size: .85rem;
    color: rgba(255,255,255,.6);
  }

  .content {
    padding: 20px 24px 24px;
  }

  .meta-row { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 16px; }

  .meta-chip {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 4px 10px;
    border-radius: 14px;
    font-size: .72rem;
    background: rgba(255,255,255,.06);
    border: 1px solid rgba(255,255,255,.1);
    color: var(--text-muted);
  }

  .meta-chip.rating { color: #ffc107; }

  .tags-section { margin-bottom: 14px; }

  .tag-label {
    display: block;
    font-size: .68rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: .5px;
    color: var(--text-muted);
    margin-bottom: 6px;
  }

  .tag-list { display: flex; flex-wrap: wrap; gap: 4px; }

  .tag {
    padding: 3px 10px;
    border-radius: 12px;
    font-size: .72rem;
    background: rgba(255,255,255,.05);
    border: 1px solid var(--border);
    color: var(--text-muted);
    line-height: 1.4;
  }

  .tag.clickable {
    cursor: pointer;
    transition: all .15s;
  }

  .tag.clickable:hover {
    border-color: var(--text-muted);
    color: var(--text);
    background: rgba(255,255,255,.08);
  }

  .description {
    margin-bottom: 16px;
  }

  .description h3 {
    font-size: .85rem;
    font-weight: 600;
    color: var(--text);
    margin-bottom: 6px;
  }

  .description p {
    font-size: .82rem;
    color: var(--text-muted);
    line-height: 1.55;
  }

  .details-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
    gap: 8px;
    margin-bottom: 18px;
  }

  .detail-item {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .detail-label {
    font-size: .65rem;
    text-transform: uppercase;
    letter-spacing: .5px;
    color: var(--text-muted);
  }

  .detail-link {
    background: none;
    border: none;
    padding: 0;
    font: inherit;
    font-size: .82rem;
    color: var(--accent, #7c6cf0);
    cursor: pointer;
    text-align: left;
    transition: color .15s;
  }

  .detail-link:hover {
    color: var(--accent-hover, #8a6cff);
    text-decoration: underline;
  }

  .downloads-section {
    background: rgba(255,255,255,.02);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 16px;
    cursor: pointer;
    transition: border-color .2s;
  }

  .downloads-section:hover {
    border-color: var(--text-muted);
  }

  .downloads-section h3 {
    font-size: .9rem;
    font-weight: 600;
    margin-bottom: 12px;
    color: var(--text);
  }

  .status-msg {
    font-size: .82rem;
    color: var(--text-muted);
    text-align: center;
    padding: 8px;
  }

  .os-tabs {
    display: flex;
    gap: 4px;
    margin-bottom: 10px;
  }

  .os-tab {
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 6px 14px;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text-muted);
    font-size: .78rem;
    cursor: pointer;
    transition: all .15s;
    text-transform: capitalize;
  }

  .os-tab:hover {
    border-color: var(--text-muted);
    color: var(--text);
  }

  .os-tab.active {
    background: rgba(255,255,255,.06);
    border-color: var(--text);
    color: var(--text);
  }

  .dl-type-toggle {
    display: flex;
    gap: 4px;
    margin-bottom: 10px;
  }

  .dl-type-btn {
    flex: 1;
    padding: 5px;
    border: none;
    background: rgba(255,255,255,.04);
    color: var(--text-muted);
    font-size: .75rem;
    cursor: pointer;
    border-radius: var(--radius-sm);
    transition: all .15s;
  }

  .dl-type-btn.active {
    background: rgba(255,255,255,.1);
    color: var(--text);
    font-weight: 600;
  }

  .build-list {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .build-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 12px;
    background: rgba(255,255,255,.03);
    border-radius: var(--radius-sm);
    transition: background .15s;
  }

  .build-row:hover { background: rgba(255,255,255,.06); }
  .build-row.downloading { background: rgba(0,212,170,.08); }

  .build-info {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .build-name {
    font-size: .82rem;
    color: var(--text);
    font-weight: 500;
  }

  .build-size {
    font-size: .7rem;
    color: var(--text-muted);
  }

  .dl-btn {
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 5px 14px;
    border: 1px solid var(--accent);
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--accent);
    font-size: .75rem;
    font-weight: 600;
    cursor: pointer;
    transition: all .15s;
    white-space: nowrap;
  }

  .dl-btn:hover:not(:disabled) {
    background: var(--accent);
    color: #fff;
  }

  .dl-btn:disabled {
    opacity: .6;
    cursor: default;
  }

  .dl-spinner {
    display: inline-block;
    width: 12px;
    height: 12px;
    border: 2px solid var(--accent);
    border-top-color: transparent;
    border-radius: 50%;
    animation: spin .6s linear infinite;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }
</style>
