<script>
  let { game, onviewGame, onfilterGenre } = $props();

  let letter = $derived(game.title ? game.title[0].toUpperCase() : "?");
  let firstGenres = $derived.by(() => {
    if (!game.genres) return [];
    return game.genres.split(",").map((g) => g.trim()).filter(Boolean).slice(0, 3);
  });
  let extraGenres = $derived.by(() => {
    if (!game.genres) return 0;
    return game.genres.split(",").map((g) => g.trim()).filter(Boolean).length - 3;
  });
  let imgFailed = $state(false);
  let loaded = $state(false);
  // Shimmer shows only while a real cover is still loading
  let pending = $derived(!!game.image && !imgFailed && !loaded);

  function handleGenreClick(g, e) {
    e.stopPropagation();
    onfilterGenre?.(g);
  }
</script>

<button class="game-card" class:loaded={!pending} onclick={() => onviewGame?.(game.slug)}>
  {#if game.image && !imgFailed}
    <img
      src={game.image}
      alt={game.title}
      loading="lazy"
      onload={() => (loaded = true)}
      onerror={() => (imgFailed = true)}
    />
  {:else}
    <div class="cover-letter" style="background: linear-gradient(135deg, var(--surface), var(--surface-hover))">
      <span class="letter">{letter}</span>
    </div>
  {/if}
  {#if game.rating}
    <div class="rating-badge">{game.rating.toFixed(1)}</div>
  {/if}
  <div class="info">
    <h3 title={game.title}>{game.title}</h3>
    {#if game.developer}
      <div class="dev">{game.developer}</div>
    {/if}
    <div class="card-genres">
      {#each firstGenres as g}
        <span role="button" tabindex="0" class="card-genre" onclick={(e) => handleGenreClick(g, e)} onkeydown={(e) => e.key === 'Enter' && handleGenreClick(g, e)}>{g}</span>
      {/each}
      {#if extraGenres > 0}
        <span class="card-genre more">+{extraGenres}</span>
      {/if}
    </div>
  </div>
</button>

<style>
  .game-card {
    position: relative;
    border-radius: var(--radius);
    overflow: hidden;
    background: var(--surface);
    border: 1px solid var(--line-soft);
    cursor: pointer;
    transition:
      transform 0.22s var(--ease-out),
      border-color 0.22s,
      box-shadow 0.22s;
    aspect-ratio: 3/4;
    width: 100%;
    padding: 0;
    text-align: left;
    backface-visibility: hidden;
    transform: translateZ(0);
    animation: card-up 0.4s var(--ease-out) backwards;
  }

  .game-card:hover {
    transform: translateY(-3px);
    border-color: var(--lure-mid);
    box-shadow: var(--shadow-card);
  }

  /* Cover shimmer while the image loads (mirrors gog.squid.wtf) */
  .game-card::before {
    content: "";
    position: absolute;
    inset: 0;
    pointer-events: none;
    background: linear-gradient(
      100deg,
      var(--surface-hover) 32%,
      #2b2b30 48%,
      var(--surface-hover) 64%
    );
    background-size: 230% 100%;
    animation: cover-shimmer 1.35s linear infinite;
  }

  .game-card.loaded::before {
    opacity: 0;
    transition: opacity 0.35s;
    animation: none;
  }

  .game-card img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
    position: relative;
    opacity: 0;
    transition: transform 0.4s, opacity 0.5s;
    backface-visibility: hidden;
  }

  .game-card.loaded img {
    opacity: 1;
  }

  .game-card:hover img {
    transform: scale(1.03);
  }

  .cover-letter {
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .letter {
    font-size: 3rem;
    font-weight: 700;
    color: var(--text-muted);
  }

  .info {
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    padding: 10px 12px 11px;
    background: linear-gradient(
      transparent,
      rgba(8, 8, 10, 0.7) 15%,
      rgba(8, 8, 10, 0.96) 40%
    );
  }

  .info h3 {
    font-size: 0.85rem;
    font-weight: 600;
    line-height: 1.3;
    margin-bottom: 2px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--text);
  }

  .dev {
    font-size: 0.62rem;
    font-weight: 500;
    color: var(--dim);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    margin-bottom: 5px;
  }

  .card-genres {
    display: flex;
    flex-wrap: nowrap;
    gap: 4px;
    overflow: hidden;
  }

  .card-genre {
    font-size: 0.55rem;
    font-weight: 500;
    padding: 1px 7px;
    border-radius: 999px;
    background: var(--lure-dim);
    border: 1px solid rgba(255, 255, 255, 0.12);
    color: var(--text-muted);
    cursor: pointer;
    transition: all 0.15s;
    line-height: 1.5;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .card-genre:hover {
    background: var(--lure-mid);
    border-color: var(--lure-mid);
    color: var(--text);
  }

  .card-genre.more {
    background: transparent;
    border-color: var(--border);
    color: var(--dim);
    cursor: default;
  }

  .card-genre.more:hover {
    background: transparent;
    border-color: var(--border);
    color: var(--dim);
  }

  .rating-badge {
    position: absolute;
    top: 8px;
    right: 8px;
    -webkit-backdrop-filter: blur(8px);
    backdrop-filter: blur(8px);
    background: rgba(8, 8, 10, 0.72);
    border: 1px solid rgba(255, 255, 255, 0.14);
    border-radius: 999px;
    padding: 2px 8px;
    font-size: 0.66rem;
    font-weight: 600;
    color: var(--text);
    font-variant-numeric: tabular-nums;
    line-height: 1.4;
    pointer-events: none;
  }

  .rating-badge::before {
    content: "\2605";
    margin-right: 3px;
    font-size: 0.62rem;
  }
</style>
