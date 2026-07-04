<script>
  import { confirmState, closeConfirm } from "./stores.js";

  function handleCancel() {
    if ($confirmState?.onCancel) $confirmState.onCancel();
    closeConfirm();
  }

  function handleConfirm() {
    if ($confirmState?.onConfirm) $confirmState.onConfirm();
    closeConfirm();
  }

  function handleKeydown(e) {
    if (e.key === "Escape") handleCancel();
    if (e.key === "Enter") handleConfirm();
  }
</script>

<svelte:window on:keydown={handleKeydown} />

{#if $confirmState}
    <div class="confirm-overlay" on:click|self={handleCancel} role="dialog" aria-modal="true">
      <div class="confirm-dialog" role="document">
        <h3>{$confirmState.title}</h3>
        <p>{$confirmState.message}</p>
        <div class="confirm-actions">
          <button class="confirm-btn cancel" on:click={handleCancel}>Cancel</button>
          <button class="confirm-btn confirm" on:click={handleConfirm}>{$confirmState.confirmLabel || "Delete"}</button>
        </div>
      </div>
    </div>
{/if}

<style>
  .confirm-overlay {
    position: fixed;
    inset: 0;
    z-index: 900;
    background: rgba(0,0,0,.7);
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .confirm-dialog {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    padding: 24px;
    max-width: 400px;
    width: 90%;
    box-shadow: 0 8px 32px rgba(0,0,0,.5);
  }

  .confirm-dialog h3 {
    font-size: 1rem;
    font-weight: 600;
    color: var(--text);
    margin: 0 0 8px;
  }

  .confirm-dialog p {
    font-size: .85rem;
    color: var(--text-muted);
    margin: 0 0 20px;
    line-height: 1.4;
  }

  .confirm-actions {
    display: flex;
    gap: 8px;
    justify-content: flex-end;
  }

  .confirm-btn {
    padding: 8px 20px;
    border-radius: var(--radius-sm);
    font-size: .82rem;
    font-weight: 600;
    cursor: pointer;
    transition: all .15s;
    border: 1px solid var(--border);
  }

  .confirm-btn.cancel {
    background: transparent;
    color: var(--text-muted);
  }

  .confirm-btn.cancel:hover {
    color: var(--text);
    background: var(--surface-hover);
  }

  .confirm-btn.confirm {
    background: var(--danger, #dc2626);
    color: #fff;
    border-color: transparent;
  }

  .confirm-btn.confirm:hover {
    background: #b91c1c;
  }
</style>
