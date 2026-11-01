// Thin IPC shim — same call shapes the app already used with @tauri-apps/*,
// now backed by the preload bridge (window.gog).
//
// invoke() rejects with the error *string* exactly like Tauri did, so every
// existing `catch (e) { showToast(\`...${e}\`) }` keeps working verbatim.

export async function invoke (cmd, args = {}) {
  const r = await window.gog.invoke(cmd, args)
  if (!r.ok) throw r.e
  return r.v
}

// listen(channel, cb) → Promise<unlisten>; cb receives { payload } (Tauri shape)
export function listen (channel, cb) {
  return window.gog.listen(channel, cb)
}

// getCurrentWindow() → { minimize, unminimize, toggleMaximize, show, setFocus, close }
export function getCurrentWindow () {
  return window.gog.window
}

// Native directory picker (replaces @tauri-apps/plugin-dialog open({directory}))
export function pickFolder () {
  return window.gog.pickFolder()
}
