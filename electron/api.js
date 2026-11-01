// GOG metadata API client — port of src-tauri/src/api.rs.
// Exact parity: URL building, param conventions (page math, trimmed "||"-lists,
// sort skipping), error strings, and the size/date conversion helpers.
//
// v2.0 addition: TTL cache + in-flight dedupe (docs/codebase-review-todo.md H-2).
// The old backend fetched game metadata on every 200 ms status tick — now each
// slug costs at most one API call per hour.

const BASE = 'https://gog.squid.wtf/api'
const UA = 'gog-archive/1.0'
const TIMEOUT_MS = 30_000
const CACHE_TTL_MS = 60 * 60 * 1000 // positive cache: 1h
const NEG_TTL_MS = 60 * 1000 // error cache: 60s (don't pin failures for an hour)

// reqwest formats StatusCode Display as "<code> <reason>" — mirror the common
// ones for when the server speaks HTTP/2 (no reason phrase in fetch).
const REASONS = {
  400: 'Bad Request', 401: 'Unauthorized', 403: 'Forbidden', 404: 'Not Found',
  408: 'Request Timeout', 429: 'Too Many Requests', 500: 'Internal Server Error',
  502: 'Bad Gateway', 503: 'Service Unavailable', 504: 'Gateway Timeout'
}

// compute_file_info unit parsing: "1.5 GB" → bytes (exact port)
function parseSize (s) {
  const sizeStr = s.trim()
  const idx = sizeStr.lastIndexOf(' ')
  const numStr = idx >= 0 ? sizeStr.slice(0, idx) : sizeStr
  const unit = (idx >= 0 ? sizeStr.slice(idx + 1) : '').trim().toLowerCase()
  const num = Number(numStr.trim())
  const bytes = Number.isNaN(num) ? 0 : num
  switch (unit) {
    case 'tb': return bytes * 1_099_511_627_776
    case 'gb': return bytes * 1_073_741_824
    case 'mb': return bytes * 1_048_576
    case 'kb': return bytes * 1_024
    default: return bytes
  }
}

// compute_file_info: (count of all entries, total bytes as i64 when map has keys)
export function computeFileInfo (files) {
  if (!files || typeof files !== 'object' || Array.isArray(files)) return { fileCount: 0, totalSize: null }
  const lists = Object.values(files)
  if (!lists.length) return { fileCount: 0, totalSize: null } // Rust: empty map → (0, None)
  let count = 0
  let total = 0
  for (const list of lists) {
    if (!Array.isArray(list)) continue
    for (const entry of list) {
      count++
      if (entry && typeof entry.size === 'string') total += parseSize(entry.size)
    }
  }
  // Rust: non-empty map → Some(total_bytes as i64) — even when 0
  return { fileCount: count, totalSize: Math.floor(total) }
}

// format_timestamp: release_timestamp (unix s) → "%Y-%m-%d" UTC, 0 → null
function formatDate (ts) {
  if (!ts || !Number.isFinite(ts)) return null
  try {
    return new Date(ts * 1000).toISOString().slice(0, 10)
  } catch {
    return null
  }
}

// convert_game (exact field parity with api.rs)
function convertGame (api) {
  const { fileCount, totalSize } = computeFileInfo(api.files)
  const genres = Array.isArray(api.genres) ? api.genres.join(', ') : null
  const tags = Array.isArray(api.tags) ? api.tags : []
  return {
    slug: api.slug,
    title: api.title,
    image: api.image ?? null,
    magnet_link: api.magnet_link ?? null,
    files: api.files ? JSON.stringify(api.files) : '',
    genres,
    raw_genres: api.genres ? JSON.stringify(api.genres) : null,
    raw_tags: JSON.stringify(tags),
    hardware: tags.join(', '),
    release_date: formatDate(api.release_timestamp),
    developer: api.developer ?? null,
    publisher: api.publisher ?? null,
    gog_url: api.gog_url ?? null,
    gogdb_url: api.gogdb_url ?? null,
    pcgamingwiki_url: api.pcgamingwiki_url ?? null,
    rating: api.rating ?? null,
    description: null,
    notes: null,
    file_count: fileCount,
    total_size: totalSize
  }
}

// search_games param building — exact port (page math, trimmed "||" lists, sort skip)
export function buildSearchParams ({ limit = 48, offset = 0, query = '', genres, tags, developers, publishers, years, sort = 'popularity_ranking', order = 'ASC' }) {
  const params = new URLSearchParams()
  params.set('limit', String(limit))
  const page = limit > 0 ? Math.max(0, Math.floor(offset / limit)) + 1 : 1
  params.set('page', String(page))
  if (query) params.set('search', query)
  for (const [key, values] of [['genre', genres], ['tag', tags], ['developer', developers], ['publisher', publishers], ['year', years]]) {
    if (values === undefined || values === null) continue
    // API contract (gog.squid.wtf): ONE param per key with ||-joined values
    // (AND semantics — same shape the site's api.ts buildListParams sends).
    // Repeated keys are NOT equivalent: the API keeps only the first value
    // and silently drops the rest (genre=A&genre=B filters on A alone).
    const list = Array.isArray(values) ? values : String(values).split('||')
    const joined = list.map((s) => String(s).trim()).filter(Boolean).join('||')
    if (joined) params.set(key, joined)
  }
  if (sort && sort !== 'popularity_ranking') {
    params.set('sort', sort)
    if (order) params.set('order', order)
  }
  return params
}

async function fetchJson (url, parsePrefix = 'Failed to parse API response') {
  let res
  try {
    res = await fetch(url, {
      headers: { 'User-Agent': UA },
      signal: AbortSignal.timeout(TIMEOUT_MS)
    })
  } catch (err) {
    throw new Error(`API request failed: ${err?.cause?.message ?? err?.message ?? err}`)
  }
  if (!res.ok) {
    const reason = res.statusText || REASONS[res.status] || '<unknown status code>'
    throw new Error(`API returned ${res.status} ${reason}`)
  }
  try {
    return await res.json()
  } catch (err) {
    throw new Error(`${parsePrefix}: ${err?.message ?? err}`)
  }
}

export class ApiClient {
  constructor () {
    this.cache = new Map() // key -> { t, game, err }
    this.inflight = new Map() // key -> Promise
  }

  // --- raw endpoints -------------------------------------------------------

  async searchGames (opts = {}) {
    const body = await fetchJson(`${BASE}/games?${buildSearchParams(opts)}`)
    return { games: (body.games ?? []).map(convertGame), total: body.total ?? 0 }
  }

  // Rust: 404 → Ok(None); other non-success → "API returned <code> <reason>"
  async getGameOrNull (slug) {
    let res
    const url = `${BASE}/games/${encodeURIComponent(slug)}`
    try {
      res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(TIMEOUT_MS) })
    } catch (err) {
      throw new Error(`API request failed: ${err?.cause?.message ?? err?.message ?? err}`)
    }
    if (res.status === 404) return null
    if (!res.ok) {
      const reason = res.statusText || REASONS[res.status] || '<unknown status code>'
      throw new Error(`API returned ${res.status} ${reason}`)
    }
    let body
    try {
      body = await res.json()
    } catch (err) {
      throw new Error(`Failed to parse API response: ${err?.message ?? err}`)
    }
    if (body === null || body === undefined) return null
    return convertGame(body)
  }

  async searchGamesByTitle (title, limit) {
    const { games } = await this.searchGames({ query: title, limit, offset: 0, sort: 'title', order: 'ASC' })
    return games
  }

  async searchSuggestions (query, limit) {
    const { games } = await this.searchGames({ query, limit, offset: 0, sort: 'title', order: 'ASC' })
    return games
  }

  async getFilters () {
    const body = await fetchJson(`${BASE}/filters`, 'Failed to parse filters')
    return {
      genres: body.genres ?? [],
      tags: body.tags ?? [],
      developers: body.developers ?? [],
      publishers: body.publishers ?? [],
      years: body.years ?? []
    }
  }

  // --- cached accessors (H-2: enrichment without per-tick fetching) --------

  async _cached (key, fn) {
    const hit = this.cache.get(key)
    if (hit && Date.now() - hit.t < (hit.err ? NEG_TTL_MS : CACHE_TTL_MS)) {
      return hit.game ?? null
    }
    if (this.inflight.has(key)) return this.inflight.get(key)
    const p = fn()
      .then(game => {
        this.cache.set(key, { t: Date.now(), game, err: false })
        return game
      })
      .catch(() => {
        // negative-cache briefly: transient network errors shouldn't pin nulls
        this.cache.set(key, { t: Date.now() - CACHE_TTL_MS + NEG_TTL_MS, game: null, err: true })
        return null
      })
      .finally(() => this.inflight.delete(key))
    this.inflight.set(key, p)
    return p
  }

  getGameCached (slug) {
    return this._cached(`game:${slug}`, () => this.getGameOrNull(slug))
  }

  searchByTitleCached (query, limit = 1) {
    return this._cached(`title:${query}:${limit}`, async () => {
      const games = await this.searchGamesByTitle(query, limit)
      return games[0] ?? null
    })
  }
}
