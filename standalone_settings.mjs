import { randomBytes, randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HOST = '127.0.0.1'
const PORT = 47831
const KEY = randomBytes(24).toString('hex')
const TOKEN_FILE = process.env.NAI_TOKEN_FILE || join(process.env.USERPROFILE || homedir(), '.codex', 'secrets', 'novelai_token.txt')
const PLUGIN_DIR = dirname(fileURLToPath(import.meta.url))
const DEFAULT_LIBRARY = join(PLUGIN_DIR, 'artists.json')
const publicDir = dirname(fileURLToPath(import.meta.url))
const text = (value) => typeof value === 'string' ? value : ''
const libraryPath = () => resolve(process.env.NAI_LIBRARY_FILE || join(process.env.NAI_LIBRARY_DIR || dirname(DEFAULT_LIBRARY), 'artists.json'))
const makeId = () => `style-${randomUUID().replaceAll('-', '').slice(0, 12)}`

function normalizeStyle(value) {
  if (!value || typeof value !== 'object' || !text(value.name).trim()) return null
  return { id: text(value.id) || makeId(), name: text(value.name).trim(), group: text(value.group).trim() || 'Default', artistText: typeof value.artistText === 'string' ? value.artistText : undefined, artists: Array.isArray(value.artists) ? value.artists : [], basePrompt: text(value.basePrompt), prompt: text(value.prompt), negativePrompt: text(value.negativePrompt), source: text(value.source) || 'local', createdAt: text(value.createdAt) || new Date().toISOString() }
}

async function readLibrary() {
  const path = libraryPath()
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8'))
    const styles = Array.isArray(parsed.styles) ? parsed.styles.map(normalizeStyle).filter(Boolean) : []
    const groups = [...new Set([...(Array.isArray(parsed.groups) ? parsed.groups : []), ...styles.map((style) => style.group)])]
    return { path, version: 1, updatedAt: text(parsed.updatedAt) || new Date().toISOString(), groups, styles, selectedStyleId: styles.some((style) => style.id === parsed.selectedStyleId) ? parsed.selectedStyleId : '' }
  } catch (error) {
    if (error?.code === 'ENOENT') return { path, version: 1, updatedAt: new Date().toISOString(), groups: [], styles: [], selectedStyleId: '' }
    if (error instanceof SyntaxError) throw new Error(`画师串文件不是有效 JSON：${path}`)
    throw error
  }
}

async function writeLibrary(library) {
  const path = library.path || libraryPath()
  const styles = (library.styles || []).map(normalizeStyle).filter(Boolean)
  const groups = [...new Set([...(library.groups || []), ...styles.map((style) => style.group)])]
  const selectedStyleId = styles.some((style) => style.id === library.selectedStyleId) ? library.selectedStyleId : ''
  const payload = { version: 1, updatedAt: new Date().toISOString(), groups, styles, selectedStyleId }
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.tmp-${process.pid}`
  await writeFile(temporary, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
  await rename(temporary, path)
  return { ...payload, path }
}

function artistString(style) {
  if (typeof style?.artistText === 'string') return style.artistText
  return (style?.artists || []).map((artist) => {
    const rawName = typeof artist === 'string' ? artist : artist?.name
    const name = text(rawName).replace(/^artist\s*:/i, '').replace(/\s*::\s*$/, '').replace(/\s*:\s*$/, '').trim().toLowerCase().replace(/\s+/g, '_')
    if (!name) return ''
    const numeric = Number(typeof artist === 'string' ? 1 : artist?.weight)
    const weight = Number.isFinite(numeric) ? Math.round(Math.max(-10, Math.min(10, numeric)) * 100) / 100 : 1
    return `${weight}::artist:${name} ::`
  }).filter(Boolean).join(', ')
}

function findStyle(library, key) {
  const value = text(key).trim()
  if (!value) return null
  return library.styles.find((style) => style.id === value) || library.styles.find((style) => style.name === value) || null
}

function summary(style, currentId) {
  return { id: style.id, name: style.name, group: style.group, source: style.source, artistText: artistString(style), basePrompt: style.basePrompt || '', prompt: style.prompt || '', negativePrompt: style.negativePrompt || '', current: style.id === currentId }
}

async function tokenConfigured() {
  if (text(process.env.NAI_API_TOKEN).trim()) return true
  try { return Boolean((await readFile(TOKEN_FILE, 'utf8')).trim()) } catch (error) { if (error?.code === 'ENOENT') return false; throw error }
}

async function saveToken(value) {
  const token = text(value).trim()
  if (!token) throw new Error('API Token 不能为空')
  await mkdir(dirname(TOKEN_FILE), { recursive: true })
  await writeFile(TOKEN_FILE, `${token}\n`, { encoding: 'utf8', mode: 0o600 })
  return { configured: true }
}

async function call(name, args = {}) {
  if (name === 'nai_settings_get') return { configured: await tokenConfigured() }
  if (name === 'nai_settings_save') return saveToken(args.token)
  const library = await readLibrary()
  if (name === 'nai_style_list') {
    const group = text(args.group).trim()
    const query = text(args.query).trim().toLowerCase()
    const styles = library.styles.filter((style) => (!group || style.group === group) && (!query || `${style.name} ${style.group} ${artistString(style)}`.toLowerCase().includes(query)))
    return { path: library.path, selectedStyleId: library.selectedStyleId, groups: library.groups, count: styles.length, styles: styles.map((style) => summary(style, library.selectedStyleId)) }
  }
  if (name === 'nai_style_save') {
    const existing = findStyle(library, args.id)
    const style = { ...(existing || {}), id: existing?.id || makeId(), name: text(args.name).trim(), group: text(args.group).trim() || existing?.group || 'Default', artistText: text(args.artistText), prompt: text(args.prompt), basePrompt: text(args.basePrompt), negativePrompt: text(args.negativePrompt), source: 'local', createdAt: existing?.createdAt || new Date().toISOString() }
    if (!style.name || !style.artistText) throw new Error('名称和画师串不能为空')
    const styles = existing ? library.styles.map((item) => item.id === existing.id ? style : item) : [...library.styles, style]
    const saved = await writeLibrary({ ...library, styles })
    return { saved: summary(style, saved.selectedStyleId), path: saved.path }
  }
  if (name === 'nai_style_select') {
    const style = findStyle(library, args.id || args.name)
    if (!style) throw new Error('找不到要选择的画师串')
    const saved = await writeLibrary({ ...library, selectedStyleId: style.id })
    return { selectedStyleId: saved.selectedStyleId, name: style.name }
  }
  if (name === 'nai_style_delete') {
    const style = findStyle(library, args.id || args.name)
    if (!style) throw new Error('找不到要删除的画师串')
    const saved = await writeLibrary({ ...library, styles: library.styles.filter((item) => item.id !== style.id), selectedStyleId: library.selectedStyleId === style.id ? '' : library.selectedStyleId })
    return { deleted: style.id, path: saved.path }
  }
  if (name === 'nai_generate_image') throw new Error('独立设置窗口仅用于配置 Token 和画师串，请从插件生图入口生成图片')
  throw new Error('独立设置窗口不支持此操作')
}

async function readBody(request) {
  let body = ''
  for await (const chunk of request) { body += chunk; if (body.length > 2_000_000) throw new Error('请求过大') }
  return body ? JSON.parse(body) : {}
}

function send(response, status, value) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
  response.end(JSON.stringify(value))
}

const server = createServer(async (request, response) => {
  try {
    if (request.method === 'GET' && request.url === '/health') return send(response, 200, { ok: true })
    if (request.method === 'GET' && request.url === '/') {
      const html = (await readFile(join(publicDir, 'public', 'settings.html'), 'utf8')).replaceAll('__LOCAL_SETTINGS_KEY__', KEY).replace('<html lang="zh-CN">', `<html lang="zh-CN" data-local-settings-key="${KEY}">`)
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }); response.end(html); return
    }
    if (!request.url?.startsWith('/api/')) return send(response, 404, { error: 'Not found' })
    if (request.headers['x-local-settings-key'] !== KEY) return send(response, 403, { error: '本地设置窗口授权已失效，请重新打开启动文件' })
    const routes = { '/api/settings/get': 'nai_settings_get', '/api/settings/save': 'nai_settings_save', '/api/styles/list': 'nai_style_list', '/api/styles/save': 'nai_style_save', '/api/styles/select': 'nai_style_select', '/api/styles/delete': 'nai_style_delete', '/api/generate': 'nai_generate_image' }
    if (request.method !== 'POST' || !routes[request.url]) return send(response, 404, { error: 'Not found' })
    const value = await call(routes[request.url], await readBody(request)); send(response, 200, value)
  } catch (error) {
    send(response, 400, { error: error instanceof Error ? error.message : String(error) })
  }
})

server.listen(PORT, HOST, () => console.log(`NovelAI 设置窗口：http://${HOST}:${PORT}/`))
