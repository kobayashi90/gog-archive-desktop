// IPC command dispatcher — port of the 19 Tauri commands in commands.rs.
//
// Envelope contract: main returns { ok: true, v } / { ok: false, e } and the
// renderer shim unwraps + throws `e` as a plain string. This preserves the
// Tauri behavior where `catch (e)` receives the raw error string (Electron's
// default error wrapping would otherwise inject
// "Error invoking remote handler…" into every toast).

import { ipcMain, shell } from 'electron'
import fs from 'node:fs'
import { saveSettings } from './settings.js'

/**
 * One status tick: engine snapshot → cached metadata enrichment → completion
 * events + seed-limit enforcement. Shared by the 200 ms emitter and the
 * torrent_status_all command.
 */
export async function collectStatus (engine, api, settings) {
  const statuses = await engine.statusAll()
  await Promise.all(statuses.map(async s => {
    const game = await api.getGameCached(s.slug) // TTL cache — H-2 fix
    if (!game) return
    s.title = game.title
    s.image = game.image
    if (s.state === 'seeding' && game.total_size) {
      const ratio = game.total_size > 0 ? s.total_size / game.total_size : 0
      s.verified = ratio > 0.8 && ratio < 1.5
    }
  }))
  return engine.process(statuses, settings)
}

export function registerIpc ({ settings, settingsPath, engine, api }) {
  async function run (cmd, args) {
    switch (cmd) {
      // --- game search (api.rs) -------------------------------------------
      case 'search_games':
        return api.searchGames({
          query: args.query ?? '',
          limit: args.limit ?? 48,
          offset: args.offset ?? 0,
          // buildSearchParams()'s contract is the plural keys — singular
          // ones were silently dropped, so advanced filters never reached
          // the API.
          genres: args.genre,
          tags: args.tag,
          developers: args.developer,
          publishers: args.publisher,
          years: args.year,
          sort: args.sort ?? 'popularity_ranking',
          order: args.order ?? 'ASC'
        })
      case 'get_game':
        return api.getGameOrNull(args.slug)
      case 'search_suggestions':
        return api.searchSuggestions(args.query ?? '', 8)
      case 'get_filters':
        return api.getFilters()

      // --- settings --------------------------------------------------------
      case 'get_settings':
        return { ...settings }
      case 'save_settings': {
        const incoming = args.settings
        if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming)) {
          throw new Error('Invalid settings payload')
        }
        const oldDir = settings.download_dir
        const next = { ...settings, ...incoming }
        if (typeof next.download_dir !== 'string' || !next.download_dir) {
          next.download_dir = oldDir
        }
        if (!saveSettings(settingsPath, next)) throw new Error('Failed to save settings')
        Object.assign(settings, next) // shared live object (main reads flags)
        engine.applyLimits(settings) // hot-apply rate limits (update_limits parity)
        if (next.download_dir !== oldDir && engine.basePath !== next.download_dir) {
          fs.mkdirSync(next.download_dir, { recursive: true })
          engine.setBasePath(next.download_dir)
        }
        return null
      }

      // --- torrent ops (torrent.rs) ---------------------------------------
      case 'torrent_status_all':
        return collectStatus(engine, api, settings)
      case 'torrent_preview':
        return engine.preview(args.magnet)
      case 'torrent_add':
        // Tauri accepted camelCase in JS for the snake_case Rust param
        return engine.add(args.magnet, args.slug, args.selectedFiles ?? args.selected_files)
      case 'torrent_remove':
        return engine.remove(args.slug)
      case 'torrent_pause':
        return engine.pause(args.slug)
      case 'torrent_resume':
        return engine.resume(args.slug)
      case 'torrent_library': {
        const entries = engine.library()
        await Promise.all(entries.map(async e => {
          const game = await api.getGameCached(e.slug)
          if (game) {
            e.title = game.title
            e.image = game.image
            e.developer = game.developer
            e.genre = game.genres
            e.total_size = game.total_size
            return
          }
          // Fallback: match directory name against game titles (slug remap)
          const alt = await api.searchByTitleCached(e.slug, 1)
          if (alt) {
            e.slug = alt.slug
            e.title = alt.title
            e.image = alt.image
            e.developer = alt.developer
            e.genre = alt.genres
            e.total_size = alt.total_size
          }
        }))
        return entries
      }
      case 'torrent_library_delete':
        return engine.libraryDelete(args.slug)
      case 'check_download_dir':
        return engine.downloadDirExists(args.slug)
      case 'delete_download_dir':
        return engine.deleteDownloadDir(args.slug)

      // --- shell integration (lib.rs / commands.rs) -----------------------
      case 'open_folder': {
        const slug = args.slug
        const dir = engine.getSavePath(slug)
        if (!dir) throw new Error(`Folder not found: ${slug}`)
        const err = await shell.openPath(dir)
        if (err) throw new Error(err)
        return null
      }
      case 'open_url': {
        const url = String(args.url ?? '')
        if (!/^https?:\/\//i.test(url) && !/^mailto:/i.test(url)) {
          throw new Error(`Unsupported URL: ${url}`)
        }
        await shell.openExternal(url)
        return null
      }

      default:
        throw new Error(`Unknown command: ${cmd}`)
    }
  }

  ipcMain.handle('gog-command', async (_event, cmd, args) => {
    try {
      return { ok: true, v: await run(String(cmd), args ?? {}) }
    } catch (e) {
      return { ok: false, e: e instanceof Error ? e.message : String(e) }
    }
  })
}
