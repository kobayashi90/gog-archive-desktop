<script>
  import { onMount } from "svelte";
  import { invoke } from "@tauri-apps/api/core";
  import { getCurrentWindow } from "@tauri-apps/api/window";
  import { listen } from "@tauri-apps/api/event";
  import Browse from "./lib/Browse.svelte";
  import Queue from "./lib/Queue.svelte";
  import Library from "./lib/Library.svelte";
  import Settings from "./lib/Settings.svelte";
  import GameModal from "./lib/GameModal.svelte";
  import AdvancedSearch from "./lib/AdvancedSearch.svelte";
  import Toast from "./lib/Toast.svelte";
  import Confirm from "./lib/Confirm.svelte";

  let tab = $state("browse");
  let gameCount = $state(0);
  let libraryCount = $state(0);
  let detailGame = $state(null);
  let advFilters = $state({});
  let showAdvSearch = $state(false);
  let searchQuery = $state("");
  let rawQuery = $state("");
  let torrentStatuses = $state([]);
  let downSpeed = $state(0);
  let upSpeed = $state(0);

  let activeItems = $derived(torrentStatuses.filter(s => s.state !== "paused" && s.state !== "stopped" && s.state !== "error"));
  let anyRunning = $derived(torrentStatuses.length > 0 && torrentStatuses.some(t => t.state !== "paused" && t.state !== "stopped" && t.state !== "error" && t.state !== "seeding" && t.state !== "finished"));
  let tbarItem = $derived(activeItems[0] || null);

  let searchTimer;
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
      torrentStatuses = statuses.map(s => ({
        ...s,
        progress: s.progress || 0,
        download_rate: s.download_rate || 0,
        upload_rate: s.upload_rate || 0,
        eta: s.eta || 0,
      }));
      const downloading = statuses.filter(
        s => s.state === "downloading" || s.state === "metadata" || s.state === "checking"
      );
      downSpeed = downloading.reduce((a, s) => a + (s.download_rate || 0), 0);
      upSpeed = statuses.reduce((a, s) => a + (s.upload_rate || 0), 0);
    });
    return () => {
      unlistenTray.then(f => f());
      unlistenTorrent.then(f => f());
    };
  });

  const tabs = [
    { id: "browse", label: "Browse", icon: "grid" },
    { id: "queue", label: "Downloads", icon: "play" },
    { id: "library", label: "Library", icon: "folder" },
    { id: "settings", label: "Settings", icon: "gear" },
  ];

  function onSearchInput() {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      searchQuery = rawQuery;
    }, 300);
  }

  function minimize() { appWindow.minimize(); }
  function toggleMaximize() { appWindow.toggleMaximize(); }
  function closeWindow() { appWindow.close(); }

  async function loadDetail(slug) { try { detailGame = await invoke("get_game", { slug }); } catch (e) {} }
  function closeDetail() { detailGame = null; }

  function handleViewGame(slug) {
    if (slug) loadDetail(slug);
    else closeDetail();
  }

  function handleNavigateTo(v) { tab = v; }
  function handleClearSearch() { rawQuery = ""; searchQuery = ""; }
  function handleClearAdvFilters() { advFilters = {}; rawQuery = ""; searchQuery = ""; }

  function handleAdvSearch(filters) {
    advFilters = filters;
    showAdvSearch = false;
    tab = "browse";
  }

  function handleGameCount(n) { gameCount = n; }

  function handleAdvancedClick() { showAdvSearch = true; }

  function goBrowse() { closeDetail(); rawQuery = ""; searchQuery = ""; tab = "browse"; advFilters = {}; }

  function handleTorrentBarClick() { closeDetail(); tab = "queue"; }

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

  function formatSpeed(bytes) {
    if (bytes <= 0) return "\u2014";
    const units = ["B/s", "KB/s", "MB/s", "GB/s"];
    let i = 0, v = bytes;
    while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
    return v.toFixed(2) + " " + units[i];
  }

  function fmtEta(sec) {
    if (!sec || sec < 0) return "";
    if (sec < 60) return sec + "s";
    if (sec < 3600) return Math.floor(sec / 60) + "m " + (sec % 60) + "s";
    return Math.floor(sec / 3600) + "h " + Math.floor((sec % 3600) / 60) + "m";
  }
</script>

<div class="app">
  <div class="titlebar" data-tauri-drag-region>
    <div class="titlebar-title">GOG Archive</div>
    <div class="titlebar-controls">
      <button class="titlebar-btn" onclick={minimize} aria-label="Minimize">
        <svg width="12" height="12" viewBox="0 0 12 12"><rect x="2" y="5.5" width="8" height="1" fill="currentColor"/></svg>
      </button>
      <button class="titlebar-btn" onclick={toggleMaximize} aria-label="Maximize">
        <svg width="12" height="12" viewBox="0 0 12 12"><rect x="2" y="2" width="8" height="8" rx="1" fill="none" stroke="currentColor" stroke-width="1"/></svg>
      </button>
      <button class="titlebar-btn titlebar-close" onclick={closeWindow} aria-label="Close">
        <svg width="12" height="12" viewBox="0 0 12 12"><line x1="2" y1="2" x2="10" y2="10" stroke="currentColor" stroke-width="1.2"/><line x1="10" y1="2" x2="2" y2="10" stroke="currentColor" stroke-width="1.2"/></svg>
      </button>
    </div>
  </div>
  <header>
    <div class="header-inner">
      <button type="button" class="logo-btn" onclick={goBrowse} aria-label="GOG Archive">
      <svg clip-rule="evenodd" fill-rule="evenodd" stroke-linejoin="round" stroke-miterlimit="2" viewBox="165 70 240 280" xmlns="http://www.w3.org/2000/svg" class="header-logo"><g fill="currentColor"><g fill-rule="nonzero"><path d="m0 0c-.465-.147-.975-.22-1.53-.22-.657 0-1.249.101-1.776.305-.528.203-.979.488-1.353.854-.374.367-.662.806-.863 1.318-.201.514-.302 1.077-.302 1.692 0 .623.098 1.191.293 1.703.196.513.474.952.835 1.319s.799.65 1.315.851c.517.202 1.094.302 1.732.302.323 0 .623-.024.9-.071s.534-.115.769-.205c.235-.089.454-.198.655-.324.201-.128.389-.272.564-.43l-.314-.502c-.049-.076-.113-.124-.191-.145-.077-.021-.164-.003-.259.054-.091.053-.195.118-.313.194-.118.075-.261.149-.43.219s-.368.13-.598.18c-.23.049-.502.073-.817.073-.46 0-.875-.074-1.248-.224-.372-.151-.689-.365-.951-.644s-.463-.617-.604-1.014c-.14-.396-.21-.842-.21-1.336 0-.512.073-.97.219-1.375.146-.404.355-.749.627-1.031.271-.283.601-.498.988-.647.387-.148.822-.222 1.304-.222.19 0 .368.012.533.034.165.023.323.055.475.095s.298.089.439.147c.14.06.283.127.427.203v1.8h-1.27c-.072 0-.131.021-.174.062-.043.042-.066.093-.066.155v.626h2.507v-3.133c-.41-.296-.848-.517-1.313-.663" transform="matrix(3.53736 0 0 -3.53736 200.601721 321.239917)"/><path d="m0 0c0 .501-.068.951-.205 1.35s-.33.736-.581 1.011-.554.487-.911.635c-.357.149-.756.222-1.196.222-.437 0-.834-.073-1.191-.222-.356-.148-.661-.36-.914-.635-.252-.275-.447-.612-.584-1.011-.136-.399-.205-.849-.205-1.35s.069-.95.205-1.347c.137-.397.332-.733.584-1.008.253-.275.558-.486.914-.632.357-.146.754-.22 1.191-.22.44 0 .839.074 1.196.22s.66.357.911.632.444.611.581 1.008.205.846.205 1.347m1.133 0c0-.611-.096-1.172-.29-1.683-.193-.51-.467-.95-.82-1.318-.354-.369-.777-.655-1.273-.858s-1.044-.304-1.643-.304c-.6 0-1.147.101-1.641.304-.493.203-.917.489-1.27.858-.353.368-.626.808-.82 1.318-.193.511-.29 1.072-.29 1.683 0 .612.097 1.172.29 1.684.194.51.467.95.82 1.321.353.37.777.658 1.27.863.494.205 1.041.307 1.641.307.599 0 1.147-.102 1.643-.307s.919-.493 1.273-.863c.353-.371.626-.811.82-1.321.194-.512.29-1.072.29-1.684" transform="matrix(3.53736 0 0 -3.53736 235.487166 307.269821)"/><path d="m0 0c-.465-.147-.975-.22-1.53-.22-.657 0-1.249.101-1.776.305-.528.203-.979.488-1.353.854-.374.367-.662.806-.863 1.318-.201.514-.302 1.077-.302 1.692 0 .623.098 1.191.293 1.703.196.513.474.952.835 1.319s.799.65 1.315.851c.517.202 1.094.302 1.732.302.323 0 .623-.024.9-.071s.534-.115.769-.205c.235-.089.454-.198.655-.324.201-.128.389-.272.564-.43l-.314-.502c-.049-.076-.113-.124-.191-.145-.077-.021-.164-.003-.259.054-.091.053-.195.118-.313.194-.118.075-.261.149-.43.219s-.368.13-.598.18c-.23.049-.502.073-.817.073-.46 0-.875-.074-1.248-.224-.372-.151-.689-.365-.951-.644s-.463-.617-.604-1.014c-.14-.396-.21-.842-.21-1.336 0-.512.073-.97.219-1.375.146-.404.355-.749.627-1.031.271-.283.601-.498.988-.647.387-.148.822-.222 1.304-.222.19 0 .368.012.533.034.165.023.323.055.475.095s.298.089.439.147c.14.06.283.127.427.203v1.8h-1.27c-.072 0-.131.021-.174.062-.043.042-.066.093-.066.155v.626h2.507v-3.133c-.41-.296-.848-.517-1.313-.663" transform="matrix(3.53736 0 0 -3.53736 265.476904 321.239917)"/><path d="m0 0c0 .098.018.191.054.278.036.088.085.164.148.228.063.065.138.116.225.154s.18.057.279.057.192-.019.279-.057.163-.089.228-.154c.064-.064.116-.14.154-.228.037-.087.057-.18.057-.278 0-.102-.02-.197-.057-.282-.038-.086-.09-.161-.154-.225-.065-.065-.141-.115-.228-.151s-.18-.054-.279-.054-.192.018-.279.054-.162.086-.225.151c-.063.064-.112.139-.148.225-.036.085-.054.18-.054.282" transform="matrix(3.53736 0 0 -3.53736 276.923801 319.47725)"/><path d="m0 0c.061 0 .114-.024.159-.074l.439-.473c-.334-.387-.74-.689-1.216-.906-.477-.216-1.053-.324-1.729-.324-.585 0-1.116.101-1.595.305-.478.203-.886.487-1.224.854s-.6.806-.786 1.318c-.186.514-.279 1.077-.279 1.692 0 .616.097 1.179.29 1.692.194.512.466.953.818 1.321.351.369.771.654 1.261.858.49.203 1.031.304 1.624.304.58 0 1.093-.093 1.537-.279s.836-.438 1.174-.757l-.365-.507c-.023-.038-.052-.069-.088-.094-.037-.025-.085-.037-.146-.037-.068 0-.151.037-.25.111-.099.073-.228.157-.388.247-.159.092-.358.174-.597.248-.239.075-.534.111-.883.111-.422 0-.807-.072-1.156-.219-.35-.146-.651-.358-.903-.635-.253-.277-.449-.615-.59-1.014-.14-.399-.211-.849-.211-1.35 0-.508.074-.962.22-1.361s.346-.736.598-1.011.55-.485.894-.629.715-.217 1.113-.217c.244 0 .463.014.659.043.195.029.375.073.541.134.165.06.319.138.461.23.142.093.283.205.424.334.065.057.129.085.194.085" transform="matrix(3.53736 0 0 -3.53736 308.816638 315.73154)"/><path d="m0 0c0 .501-.068.951-.205 1.35s-.33.736-.581 1.011-.554.487-.911.635c-.357.149-.756.222-1.196.222-.437 0-.834-.073-1.191-.222-.356-.148-.661-.36-.914-.635-.252-.275-.447-.612-.584-1.011-.136-.399-.205-.849-.205-1.35s.069-.95.205-1.347c.137-.397.332-.733.584-1.008.253-.275.558-.486.914-.632.357-.146.754-.22 1.191-.22.44 0 .839.074 1.196.22s.66.357.911.632.444.611.581 1.008.205.846.205 1.347m1.133 0c0-.611-.096-1.172-.29-1.683-.194-.51-.467-.95-.82-1.318-.354-.369-.777-.655-1.273-.858s-1.044-.304-1.643-.304c-.6 0-1.147.101-1.641.304-.493.203-.917.489-1.27.858-.353.368-.626.808-.82 1.318-.193.511-.29 1.072-.29 1.683 0 .612.097 1.172.29 1.684.194.51.467.95.82 1.321.353.37.777.658 1.27.863.494.205 1.041.307 1.641.307.599 0 1.147-.102 1.643-.307s.919-.493 1.273-.863c.353-.371.626-.811.82-1.321.194-.512.29-1.072.29-1.684" transform="matrix(3.53736 0 0 -3.53736 338.905422 307.269821)"/><path d="m0 0c.042-.1.083-.2.125-.298.038.102.078.204.12.304.041.1.087.197.136.287l2.769 5.019c.045.087.095.14.15.159s.132.028.231.028h.815v-8.161h-.969v5.997c0 .08.002.165.006.257.004.091.01.183.017.279l-2.797-5.104c-.087-.17-.22-.256-.398-.256h-.16c-.178 0-.311.086-.398.256l-2.859 5.121c.011-.1.019-.196.025-.29.006-.096.009-.183.009-.263v-5.997h-.969v8.161h.815c.099 0 .174-.009.228-.028.053-.019.104-.072.153-.159l2.82-5.024c.045-.091.089-.187.131-.288" transform="matrix(3.53736 0 0 -3.53736 364.629104 312.277308)"/></g><path d="m0 0h-6.577c-.516 0-.93-.419-.93-.935 0 0 .002 0 .002-.006h-.002v-4.693h.002l-.002-.004c0-.514.414-.937.93-.937h6.577v-3.131h-8.207v.008c-1.343 0-2.429 1.086-2.429 2.425v7.98c0 1.332 1.086 2.418 2.429 2.418h8.207z" transform="matrix(3.53736 0 0 -3.53736 239.59404 200.161744)"/><path d="m0 0c0-1.365-1.103-2.463-2.462-2.463h-10.556v3.173h8.9c.524 0 .944.428.944.949v10.488c0 .523-.42.947-.944.947h-4.783c-.523 0-.944-.424-.944-.947v-4.773c0-.524.421-.949.944-.949h3.821v-3.173h-5.477c-1.362 0-2.461 1.1-2.461 2.461v8.094c0 1.36 1.099 2.462 2.461 2.462h8.095c1.359 0 2.462-1.102 2.462-2.462z" transform="matrix(3.53736 0 0 -3.53736 247.991733 169.337189)"/><path d="m0 0h-3.128v9.698h-2.198c-.517 0-.931-.419-.931-.935v-8.763h-3.128v9.698h-2.199c-.518 0-.932-.419-.932-.935v-8.771h-3.127v10.413c0 1.332 1.083 2.418 2.426 2.418h13.217z" transform="matrix(3.53736 0 0 -3.53736 358.024853 234.467061)"/><path d="m0 0c0-1.365-1.104-2.463-2.461-2.463h-10.557v3.173h8.9c.526 0 .948.428.948.949v10.488c0 .523-.422.947-.948.947h-4.782c-.518 0-.941-.424-.941-.947v-4.773c0-.524.423-.949.941-.949h3.819v-3.173h-5.474c-1.362 0-2.463 1.1-2.463 2.461v8.094c0 1.36 1.101 2.462 2.463 2.462h8.094c1.357 0 2.461-1.102 2.461-2.462z" transform="matrix(3.53736 0 0 -3.53736 358.05669 169.337189)"/><path d="m0 .008v-4.773c0-.524-.411-.95-.936-.95h-4.781c-.525 0-.945.426-.945.95v4.773c0 .523.42.946.945.946h4.781c.525 0 .936-.423.936-.946zm.721 4.121h-8.098c-1.36 0-2.459-1.102-2.459-2.462v-8.094c0-1.36 1.099-2.461 2.459-2.461h8.098c1.356 0 2.46 1.101 2.46 2.461v8.094c0 1.36-1.104 2.462-2.46 2.462" transform="matrix(3.53736 0 0 -3.53736 291.773638 126.393638)"/><path d="m0 .006v-4.699c0-.516-.414-.937-.928-.937-.005 0-.006.005-.011.005v-.005h-4.692v.005s-.005-.005-.01-.005c-.516 0-.93.421-.93.937v4.699c0 .516.414.935.93.935h4.713c.514 0 .928-.419.928-.935zm.703 4.06h-7.976c-1.343 0-2.427-1.086-2.427-2.418v-7.98c0-1.339 1.084-2.425 2.427-2.425h7.976c1.338 0 2.424 1.086 2.424 2.425v7.98c0 1.332-1.086 2.418-2.424 2.418" transform="matrix(3.53736 0 0 -3.53736 282.763982 203.490399)"/><path d="m0 0c0-.806-.325-1.53-.853-2.059-.528-.527-1.253-.851-2.057-.851h-48.315c-.805 0-1.529.324-2.057.851-.528.529-.851 1.253-.853 2.059v45.578c.002.805.325 1.528.853 2.057.528.527 1.252.851 2.057.852h48.315c.804-.001 1.529-.325 2.057-.852.528-.529.853-1.252.853-2.057zm-.004 48.485c-.742.744-1.772 1.204-2.906 1.204h-48.315c-1.134 0-2.164-.46-2.906-1.204-.744-.742-1.206-1.774-1.206-2.907v-45.578c0-1.134.462-2.166 1.206-2.908.742-.743 1.772-1.205 2.906-1.205h48.315c1.134 0 2.164.462 2.906 1.205.744.742 1.206 1.774 1.206 2.908v45.578c0 1.133-.462 2.165-1.206 2.907" fill-rule="nonzero" transform="matrix(3.53736 0 0 -3.53736 375.747027 253.749564)"/></g></svg>
      GOG Archive
    </button>
      <div class="nav-tabs">
        {#each tabs as t}
          <button class="nav-tab" class:active={tab === t.id} onclick={() => { closeDetail(); tab = t.id; }}>
            {#if t.icon === "grid"}
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>
            {:else if t.icon === "play"}
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"/></svg>
            {:else if t.icon === "folder"}
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/></svg>
            {:else if t.icon === "gear"}
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg>
            {/if}
            {t.label}
            {#if t.id === "library" && libraryCount > 0}
              <span class="badge">{libraryCount}</span>
            {/if}
          </button>
        {/each}
      </div>
      {#if tab === "browse"}
        <div class="search-wrap">
          <svg class="search-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          <input type="text" id="search" placeholder="Search games..." autocomplete="off" bind:value={rawQuery} oninput={onSearchInput} />
          <button class="adv-btn" onclick={handleAdvancedClick} title="Advanced filters">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="2" y1="14" x2="6" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="22" y2="16"/></svg>
          </button>
        </div>
      {/if}
    </div>
  </header>

  <main>
    <div class="main-inner">
      <div class:hidden={tab !== "browse"}>
        <Browse
          {advFilters}
          {searchQuery}
          ongameCount={(n) => (gameCount = n)}
          onviewGame={handleViewGame}
          onclearSearch={handleClearSearch}
          onclearAdvFilters={handleClearAdvFilters}
          onfilterGenre={(g) => { advFilters = { ...advFilters, genre: [g] }; tab = "browse"; }}
        />
      </div>
      <div class:hidden={tab !== "queue"}>
        <Queue {torrentStatuses} onviewGame={handleViewGame} />
      </div>
      <div class:hidden={tab !== "library"}>
        <Library onviewGame={handleViewGame} onlibraryCount={(n) => (libraryCount = n)} />
      </div>
      <div class:hidden={tab !== "settings"}>
        <Settings />
      </div>
    </div>
  </main>

  <div class="torrent-bar">
    <div class="torrent-bar-inner">
      <div class="tbar-center">
        {#if !tbarItem}
          <span class="tbar-idle">No active downloads</span>
        {:else}
          <div class="tbar-item" onclick={handleTorrentBarClick} onkeydown={(e) => e.key === 'Enter' && handleTorrentBarClick()} role="button" tabindex="0" title="{tbarItem.title || tbarItem.name} &mdash; {(tbarItem.progress * 100).toFixed(1)}%  ETA: {fmtEta(tbarItem.eta)}">
            <img class="tbar-item-thumb" src={tbarItem.image || ""} alt="" loading="lazy" onerror={(e) => e.target.style.display = "none"} />
            <div class="tbar-item-body">
              <div class="tbar-item-name" title={tbarItem.title || tbarItem.name}>{tbarItem.title || tbarItem.name}</div>
              <div class="tbar-item-bar">
                <div class="tbar-item-fill" style="width: {Math.min(tbarItem.progress * 100, 100)}%"></div>
              </div>
              <div class="tbar-item-meta">
                {(tbarItem.progress * 100).toFixed(1)}% &mdash; {fmtEta(tbarItem.eta)}
              </div>
            </div>
          </div>
        {/if}
      </div>
      <div class="tbar-mid">
        <span class="tbar-speed">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3v14"/><path d="m8 11 4 5 4-5"/><path d="M4 21h16"/></svg>
          <span class="tbar-down">{formatSpeed(downSpeed)}</span>
        </span>
      </div>
      <div class="tbar-right">
        <button class="tbar-btn" title={anyRunning ? "Pause all" : "Resume all"} onclick={toggleAll}>
          {#if anyRunning}
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
          {:else}
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"/></svg>
          {/if}
        </button>
      </div>
    </div>
  </div>
</div>

{#if detailGame}
  <GameModal
    game={detailGame}
    onclose={closeDetail}
    onnavigateTo={handleNavigateTo}
    onfilterGenre={(g) => { advFilters = { ...advFilters, genre: [g] }; tab = "browse"; closeDetail(); }}
    onfilterTag={(t) => { advFilters = { ...advFilters, tag: [t] }; tab = "browse"; closeDetail(); }}
    onfilterDeveloper={(d) => { advFilters = { ...advFilters, developer: [d] }; tab = "browse"; closeDetail(); }}
    onfilterPublisher={(p) => { advFilters = { ...advFilters, publisher: [p] }; tab = "browse"; closeDetail(); }}
    onfilterYear={(y) => { advFilters = { ...advFilters, year: [y] }; tab = "browse"; closeDetail(); }}
  />
{/if}

{#if showAdvSearch}
  <AdvancedSearch currentFilters={advFilters} onapply={handleAdvSearch} onclose={() => (showAdvSearch = false)} />
{/if}

<Toast />
<Confirm />

<style>
  .app {
    display: flex;
    flex-direction: column;
    height: 100vh;
    background: var(--bg);
  }

  .titlebar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    height: 30px;
    min-height: 30px;
    padding: 0 0 0 12px;
    background: var(--surface);
    border-bottom: 1px solid var(--border);
    user-select: none;
    flex-shrink: 0;
    position: relative;
    z-index: 300;
  }

  .titlebar-title {
    position: absolute;
    left: 50%;
    transform: translateX(-50%);
    font-size: .75rem;
    color: var(--text-muted);
    font-weight: 500;
    letter-spacing: .3px;
    white-space: nowrap;
  }

  .titlebar-controls {
    display: flex;
    align-items: center;
    gap: 0;
    margin-left: auto;
  }

  .titlebar-btn {
    width: 32px;
    height: 30px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: none;
    border: none;
    color: var(--text-muted);
    cursor: pointer;
    border-radius: 0;
  }

  .titlebar-btn:hover {
    background: var(--border-hover);
    color: var(--text);
  }

  .titlebar-close:hover {
    background: #e81123;
    color: #fff;
  }

  header {
    position: sticky;
    top: 0;
    z-index: 100;
    background: rgba(0,0,0,.95);
    border-bottom: 1px solid var(--border);
    isolation: isolate;
    flex-shrink: 0;
  }

  .header-inner {
    max-width: 1400px;
    margin: 0 auto;
    padding: 16px 24px;
    display: flex;
    align-items: center;
    gap: 24px;
  }

  .logo-btn {
    font-size: 1.25rem;
    font-weight: 700;
    display: flex;
    align-items: center;
    gap: 8px;
    white-space: nowrap;
    color: var(--text);
    cursor: pointer;
    user-select: none;
    background: none;
    border: none;
    font: inherit;
    padding: 0;
  }

  .logo-btn svg {
    flex-shrink: 0;
  }

  .header-logo {
    height: 48px;
    width: auto;
    display: block;
  }

  .search-wrap {
    position: relative;
    flex: 1;
  }

  .search-icon {
    position: absolute;
    left: 14px;
    top: 50%;
    transform: translateY(-50%);
    color: var(--text-muted);
    pointer-events: none;
  }

  #search {
    width: 100%;
    padding: 10px 44px 10px 42px;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--surface);
    color: var(--text);
    font-size: .95rem;
    outline: none;
    transition: border .2s, box-shadow .2s;
  }

  #search:focus {
    border-color: var(--text-muted);
    box-shadow: 0 0 0 3px rgba(255,255,255,.06);
  }

  #search::placeholder {
    color: var(--text-muted);
  }

  .adv-btn {
    position: absolute;
    right: 6px;
    top: 50%;
    transform: translateY(-50%);
    width: 32px;
    height: 32px;
    display: flex;
    align-items: center;
    justify-content: center;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
    transition: all .2s;
  }

  .adv-btn:hover {
    border-color: var(--text-muted);
    color: var(--text);
    background: rgba(255,255,255,.06);
  }

  main {
    flex: 1;
    overflow-y: auto;
    width: 100%;
    isolation: isolate;
  }

  .main-inner {
    max-width: 1400px;
    margin: 0 auto;
    padding: 24px;
    padding-bottom: calc(24px + 60px);
    width: 100%;
    min-height: 100%;
    display: flex;
    flex-direction: column;
  }

  .hidden {
    display: none;
  }

  .torrent-bar {
    position: fixed;
    bottom: 0;
    left: 0;
    right: 0;
    z-index: 300;
    background: rgba(10, 10, 18, 0.97);
    border-top: 1px solid var(--border);
    padding: 0 12px;
    font-size: .8rem;
    box-shadow: 0 -2px 12px rgba(0,0,0,.35);
    overflow-anchor: none;
  }

  .torrent-bar-inner {
    display: flex;
    align-items: center;
    gap: 12px;
    height: 60px;
    max-width: 1400px;
    margin: 0 auto;
  }

  .tbar-center {
    flex: 1;
    display: flex;
    gap: 8px;
    overflow-x: auto;
    scrollbar-width: none;
    -ms-overflow-style: none;
    align-items: center;
    min-width: 0;
  }

  .tbar-center::-webkit-scrollbar {
    display: none;
  }

  .tbar-idle {
    color: var(--text-muted);
    font-style: italic;
    font-size: .8rem;
  }

  .tbar-item {
    display: flex;
    gap: 8px;
    flex: 1 1 240px;
    background: rgba(255,255,255,.04);
    border: 1px solid var(--border);
    border-radius: 5px;
    padding: 4px 8px;
    cursor: pointer;
    transition: border-color .15s;
    align-items: center;
    min-width: 0;
  }

  .tbar-item:hover {
    border-color: var(--text-muted);
  }

  .tbar-item-thumb {
    width: 28px;
    height: 36px;
    object-fit: cover;
    border-radius: 3px;
    flex-shrink: 0;
    background: var(--surface);
  }

  .tbar-item-body {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  .tbar-item-name {
    font-size: .75rem;
    color: var(--text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-weight: 600;
    line-height: 1.2;
  }

  .tbar-item-bar {
    width: 100%;
    height: 5px;
    background: var(--bg);
    border-radius: 2px;
    overflow: hidden;
    flex-shrink: 0;
  }

  .tbar-item-fill {
    height: 100%;
    background: linear-gradient(90deg, #f59e0b, #f97316);
  }

  .tbar-item-meta {
    font-size: .65rem;
    color: var(--text-muted);
  }

  .tbar-right {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-shrink: 0;
  }

  .tbar-mid {
    display: flex;
    align-items: center;
    gap: 16px;
    flex-shrink: 0;
  }

  .tbar-speed {
    display: flex;
    align-items: center;
    gap: 5px;
    color: var(--text-muted);
    font-variant-numeric: tabular-nums;
  }

  .tbar-speed .tbar-down {
    color: #5eebcb;
    font-weight: 600;
  }

  .tbar-speed svg {
    width: 14px;
    height: 14px;
    flex-shrink: 0;
  }

  .nav-tabs {
    display: flex;
    gap: 4px;
    flex-shrink: 0;
  }

  .nav-tab {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 8px 14px;
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text-muted);
    font-size: .82rem;
    cursor: pointer;
    transition: all .15s;
    white-space: nowrap;
  }

  .nav-tab:hover {
    color: var(--text);
    background: rgba(255,255,255,.04);
    border-color: var(--border);
  }

  .nav-tab.active {
    color: var(--text);
    background: rgba(255,255,255,.06);
    border-color: var(--border);
  }

  .nav-tab svg {
    flex-shrink: 0;
  }

  .badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 18px;
    height: 18px;
    padding: 0 5px;
    border-radius: 9px;
    background: var(--accent);
    color: #fff;
    font-size: .65rem;
    font-weight: 700;
    line-height: 1;
  }

  .tbar-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    background: transparent;
    border: 1px solid var(--border);
    border-radius: 4px;
    color: var(--text-muted);
    cursor: pointer;
    transition: all .15s;
    flex-shrink: 0;
  }

  .tbar-btn:hover {
    background: rgba(255,255,255,.06);
    border-color: var(--text-muted);
    color: var(--text);
  }

  .tbar-btn svg {
    width: 14px;
    height: 14px;
    flex-shrink: 0;
  }

  @media (max-width: 900px) {
    .header-logo { height: 36px; }
  }

  @media (max-width: 768px) {
    .header-inner { flex-wrap: wrap; }
    .search-wrap { max-width: 100%; }
  }

  @media (max-width: 640px) {
    .header-inner { padding: 10px 12px; gap: 10px; }
    .logo-btn { font-size: .88rem; }
    .header-logo { height: 28px; }

    #search {
      padding: 8px 36px 8px 34px;
      font-size: .88rem;
    }
    .search-icon { left: 10px; }
    .adv-btn { width: 28px; height: 28px; right: 4px; }

    main { padding: 12px; }
  }
</style>
