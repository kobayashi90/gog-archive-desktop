<script>
  import { createEventDispatcher } from "svelte";

  export let game;
  const dispatch = createEventDispatcher();

  let letter = game.title ? game.title[0].toUpperCase() : "?";
  let firstGenres = [];
  let extraGenres = 0;
  let imgFailed = false;

  if (game.genres) {
    const parts = game.genres.split(",").map((g) => g.trim()).filter(Boolean);
    firstGenres = parts.slice(0, 3);
    extraGenres = parts.length - 3;
  }

  function handleGenreClick(g, e) {
    e.stopPropagation();
    dispatch("filterGenre", g);
  }
</script>

<button class="game-card" on:click={() => dispatch("viewGame", game.slug)}>
  {#if game.image && !imgFailed}
    <img src={game.image} alt={game.title} loading="lazy" on:error={() => (imgFailed = true)} />
  {:else}
    <div class="cover-letter" style="background: linear-gradient(135deg, #1a1a2e, #2d1b4e)">
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
        <button type="button" class="card-genre" on:click={(e) => handleGenreClick(g, e)}>{g}</button>
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
    border: 1px solid var(--border);
    cursor: pointer;
    transition: transform .2s ease, border-color .2s;
    aspect-ratio: 3/4;
    width: 100%;
    padding: 0;
    text-align: left;
    backface-visibility: hidden;
    transform: translateZ(0);
  }

  .game-card:hover {
    transform: translateY(-3px);
    border-color: var(--text-muted);
  }

  .game-card img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
    transition: transform .4s ease;
    backface-visibility: hidden;
  }

  .game-card:hover img {
    transform: scale(1.05);
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
    padding: 48px 14px 14px;
    background: linear-gradient(transparent, rgba(0,0,0,.92));
  }

  .info h3 {
    font-size: .85rem;
    font-weight: 600;
    line-height: 1.3;
    margin-bottom: 2px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--text);
  }

  .dev {
    font-size: .75rem;
    font-weight: 700;
    color: var(--text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    margin-bottom: 4px;
  }

  .card-genres {
    display: flex;
    flex-wrap: nowrap;
    gap: 3px;
    overflow: hidden;
  }

  .card-genre {
    font-size: .6rem;
    padding: 1px 6px;
    border-radius: 8px;
    background: rgba(0,212,170,.1);
    border: 1px solid rgba(0,212,170,.2);
    color: #5eccb0;
    cursor: pointer;
    transition: color .15s, background .15s, border-color .15s;
    line-height: 1.4;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .card-genre:hover {
    background: rgba(0,212,170,.2);
    border-color: var(--accent2);
    color: #7ddfc6;
  }

  .card-genre.more {
    background: transparent;
    border-color: var(--border);
    color: var(--text-muted);
    cursor: default;
  }

  .rating-badge {
    position: absolute;
    top: 10px;
    right: 10px;
    background: rgba(0,0,0,.65);
    padding: 2px 8px;
    border-radius: 20px;
    font-size: .7rem;
    font-weight: 600;
    color: #ffc107;
    line-height: 1.4;
    pointer-events: none;
  }

  .rating-badge::before {
    content: "\2605";
    margin-right: 3px;
    font-size: .75rem;
  }
</style>
