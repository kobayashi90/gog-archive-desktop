import { writable } from 'svelte/store';

export const toasts = writable([]);

export function showToast(message, type = 'info', duration = 3000) {
  const id = Date.now() + Math.random();
  toasts.update(t => [...t, { id, message, type }]);
  setTimeout(() => {
    toasts.update(t => t.filter(toast => toast.id !== id));
  }, duration);
}

export const confirmState = writable(null);

export function showConfirm(title, message, onConfirm, onCancel, confirmLabel) {
  confirmState.set({ title, message, onConfirm, onCancel, confirmLabel });
}

export function closeConfirm() {
  confirmState.set(null);
}
