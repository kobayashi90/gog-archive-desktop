<script>
  import { onMount } from "svelte";
  import { invoke } from "@tauri-apps/api/core";
  import { open } from "@tauri-apps/plugin-dialog";

  let s = $state({});
  let saving = $state(false);
  let saved = $state(false);

  onMount(async () => {
    try { s = await invoke("get_settings"); } catch (e) { console.error("Failed to load settings", e); }
  });

  async function pickFolder() {
    const dir = await open({ directory: true, multiple: false });
    if (dir) s.download_dir = dir;
  }

  async function save() {
    saving = true; saved = false;
    try {
      await invoke("save_settings", { settings: s });
      saved = true;
      setTimeout(() => (saved = false), 2000);
    } catch (e) { console.error("Failed to save settings", e); }
    saving = false;
  }
</script>

<div class="settings">
  <h2>Settings</h2>

  <div class="settings-grid">
    <div class="section">
      <h3>Downloads</h3>
      <label class="field">
        <span>Download location</span>
        <div class="dir-row">
          <input type="text" bind:value={s.download_dir} />
          <button class="browse-btn" onclick={pickFolder}>Browse</button>
        </div>
      </label>
    </div>

    <div class="section">
      <h3>Network</h3>
      <div class="field toggle">
        <span>DHT</span>
        <div class="toggle-wrap">
          <div class="switch" class:on={s.dht} onclick={() => (s.dht = !s.dht)} role="switch" aria-checked={s.dht} tabindex="0" onkeydown={(e) => e.key === 'Enter' && (s.dht = !s.dht)}>
            <div class="switch-knob"></div>
          </div>
        </div>
      </div>
      <div class="field toggle">
        <span>LSD</span>
        <div class="toggle-wrap">
          <div class="switch" class:on={s.lsd} onclick={() => (s.lsd = !s.lsd)} role="switch" aria-checked={s.lsd} tabindex="0" onkeydown={(e) => e.key === 'Enter' && (s.lsd = !s.lsd)}>
            <div class="switch-knob"></div>
          </div>
        </div>
      </div>
    </div>

    <div class="section">
      <h3>Speed Limits</h3>
      <label class="field">
        <span>Download limit (kB/s)</span>
        <input type="number" min="0" bind:value={s.download_rate_limit} />
      </label>
      <label class="field">
        <span>Upload limit (kB/s)</span>
        <input type="number" min="0" bind:value={s.upload_rate_limit} />
      </label>
    </div>

    <div class="section">
      <h3>Advanced</h3>
      <label class="field">
        <span>Proxy URL (socks5://...)</span>
        <input type="text" bind:value={s.proxy_url} />
      </label>
      <label class="field">
        <span>Listen port (0=random)</span>
        <input type="number" min="0" max="65535" bind:value={s.listen_port} />
      </label>
      <label class="field">
        <span>Max peers per torrent</span>
        <input type="number" min="0" bind:value={s.max_peers} />
      </label>
    </div>

    <div class="section">
      <h3>Seeding</h3>
      <label class="field">
        <span>Seed ratio limit</span>
        <input type="number" min="0" step="0.1" bind:value={s.seed_ratio} />
      </label>
      <label class="field">
        <span>Seed time limit (hours)</span>
        <input type="number" min="0" bind:value={s.seed_hours} />
      </label>
    </div>


  </div>

  <button class="save-btn" onclick={save} disabled={saving}>
    {saving ? "Saving..." : saved ? "Saved!" : "Save Settings"}
  </button>
</div>

<style>
  .settings {
    padding: 12px 12px 0;
    display: flex;
    flex-direction: column;
    gap: 12px;
    flex: 1;
  }

  h2 { font-size: 18px; font-weight: 600; color: var(--text); margin: 0; }

  .settings-grid {
    column-count: 2;
    column-gap: 16px;
    flex: 1;
  }

  .section {
    break-inside: avoid;
    margin-bottom: 16px;
  }

  h3 {
    font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px;
    color: var(--text-muted); margin-bottom: 8px; padding-bottom: 4px;
    border-bottom: 1px solid var(--border);
  }

  .field { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }

  .field > span { flex: 0 0 180px; font-size: 12px; color: var(--text-muted); }

  .field input[type="text"],
  .field input[type="number"] {
    flex: 1;
    padding: 4px 6px;
  }

  .dir-row {
    display: flex;
    gap: 6px;
    flex: 1;
  }

  .dir-row input {
    flex: 1;
  }

  .browse-btn {
    padding: 4px 10px;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--surface);
    color: var(--text);
    font-size: .8rem;
    cursor: pointer;
    transition: all .15s;
    white-space: nowrap;
  }

  .browse-btn:hover {
    border-color: var(--text-muted);
    background: var(--surface-hover);
  }

  .field.toggle > span { flex: 0 0 180px; }

  .toggle-wrap { flex: 1; display: flex; align-items: center; }

  .switch {
    width: 36px; height: 20px; background: var(--border-hover); border-radius: 10px;
    position: relative; cursor: pointer; transition: background 0.2s; flex-shrink: 0;
  }

  .switch.on { background: var(--accent); }

  .switch-knob {
    width: 16px; height: 16px; background: #fff; border-radius: 50%;
    position: absolute; top: 2px; left: 2px;
    transition: transform 0.2s;
  }

  .switch.on .switch-knob { transform: translateX(16px); }
  .save-btn {
    width: 100%; padding: 8px;
    background: var(--accent); color: #fff; font-weight: 600;
    border-radius: var(--radius); font-size: 14px;
    transition: background 0.15s;
  }

  .save-btn:hover:not(:disabled) { background: var(--accent-hover); }
  .save-btn:disabled { opacity: 0.6; cursor: default; }
</style>
