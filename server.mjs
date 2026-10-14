import { randomInt, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ENDPOINT = 'https://image.novelai.net/ai/generate-image'
const RESOURCE_URI = 'ui://novelai-image/settings'
const TOKEN_FILE = process.env.NAI_TOKEN_FILE || join(process.env.USERPROFILE || homedir(), '.codex', 'secrets', 'novelai_token.txt')
const PLUGIN_DIR = dirname(fileURLToPath(import.meta.url))
const DEFAULT_LIBRARY = join(PLUGIN_DIR, 'artists.json')
const MODELS = new Set(['nai-diffusion-5-full', 'nai-diffusion-5-curated', 'nai-diffusion-4-5-full', 'nai-diffusion-4-5-curated'])
const PNG_SIGNATURE = Buffer.from('89504e470d0a1a0a', 'hex')
const publicDir = PLUGIN_DIR

const text = (value) => typeof value === 'string' ? value : ''
const libraryPath = () => resolve(process.env.NAI_LIBRARY_FILE || join(process.env.NAI_LIBRARY_DIR || dirname(DEFAULT_LIBRARY), 'artists.json'))
const makeId = () => `style-${randomUUID().replaceAll('-', '').slice(0, 12)}`

function normalizeStyle(value) {
  if (!value || typeof value !== 'object' || !text(value.name).trim()) return null
  return {
    id: text(value.id) || makeId(),
    name: text(value.name).trim(),
    group: text(value.group).trim() || 'Default',
    artistText: typeof value.artistText === 'string' ? value.artistText : undefined,
    artists: Array.isArray(value.artists) ? value.artists : [],
    basePrompt: text(value.basePrompt),
    prompt: text(value.prompt),
    negativePrompt: text(value.negativePrompt),
    source: text(value.source) || 'local',
    createdAt: text(value.createdAt) || new Date().toISOString(),
  }
}

async function readLibrary() {
  const path = libraryPath()
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8'))
    const styles = Array.isArray(parsed.styles) ? parsed.styles.map(normalizeStyle).filter(Boolean) : []
    const groups = [...new Set([...(Array.isArray(parsed.groups) ? parsed.groups : []), ...styles.map((style) => style.group)])]
    return {
      path,
      version: 1,
      updatedAt: text(parsed.updatedAt) || new Date().toISOString(),
      groups,
      styles,
      selectedStyleId: styles.some((style) => style.id === parsed.selectedStyleId) ? parsed.selectedStyleId : '',
    }
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

function findStyle(library, key) {
  const value = text(key).trim()
  if (!value) return null
  return library.styles.find((style) => style.id === value) || library.styles.find((style) => style.name === value) || null
}

function selectedStyle(library, key) {
  return findStyle(library, key) || findStyle(library, library.selectedStyleId)
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

function extraPrompt(style) {
  const raw = text(style?.prompt).trim()
  if (!raw || !style?.artistText) return raw
  return raw.split(/[,，、；;]/).map((part) => part.trim()).filter((part) => part && !/^(-?\d+(?:\.\d+)?)\s*::?\s*artist\s*:/i.test(part) && !/^artist\s*:/i.test(part)).join(', ')
}

function compose(style, prompt = '') {
  return [artistString(style), extraPrompt(style), text(style?.basePrompt).trim(), text(prompt).trim()].filter(Boolean).join(' ')
}

function summary(style, currentId) {
  return { id: style.id, name: style.name, group: style.group, source: style.source, artistText: artistString(style), basePrompt: style.basePrompt || '', prompt: style.prompt || '', negativePrompt: style.negativePrompt || '', current: style.id === currentId }
}

function integer(value, fallback, min, max, label, multiple = 1) {
  const result = value === undefined ? fallback : Number(value)
  if (!Number.isSafeInteger(result) || result < min || result > max || result % multiple !== 0) throw new Error(`${label} 必须是 ${min}-${max} 范围内的整数${multiple > 1 ? `，且为 ${multiple} 的倍数` : ''}`)
  return result
}

function buildRequest(args) {
  const prompt = text(args.prompt).trim()
  if (!prompt || prompt.length > 8000) throw new Error('prompt 不能为空且不能超过 8000 个字符')
  const model = args.model || 'nai-diffusion-5-full'
  if (!MODELS.has(model)) throw new Error(`不支持的 NovelAI 模型：${model}`)
  const width = integer(args.width, 1024, 512, 1536, 'width', 64)
  const height = integer(args.height, 1024, 512, 1536, 'height', 64)
  if (width * height > 1536 * 1024) throw new Error('图片面积超过 1,572,864 像素限制')
  const negative = text(args.negative_prompt).trim()
  const steps = integer(args.steps, 28, 1, 50, 'steps')
  const scale = args.scale === undefined ? 5 : Number(args.scale)
  if (!Number.isFinite(scale) || scale < 1 || scale > 10) throw new Error('scale 必须在 1-10 之间')
  const seed = integer(args.seed, randomInt(1, 10_000_000_000), 0, 9_999_999_999, 'seed')
  const caption = (base_caption) => ({ caption: { base_caption, char_captions: [] }, use_coords: false, use_order: false })
  return { input: prompt, model, action: 'generate', parameters: { params_version: model.startsWith('nai-diffusion-5') ? 4 : 3, width, height, scale, sampler: 'k_euler_ancestral', steps, seed, n_samples: 1, ucPreset: 0, qualityToggle: true, dynamic_thresholding: false, controlnet_strength: 1, legacy: false, add_original_image: false, cfg_rescale: 0, noise_schedule: 'karras', legacy_v3_extend: false, negative_prompt: negative, prompt, v4_prompt: caption(prompt), v4_negative_prompt: caption(negative) } }
}

async function tokenConfigured() {
  if (text(process.env.NAI_API_TOKEN).trim()) return true
  try { return Boolean((await readFile(TOKEN_FILE, 'utf8')).trim()) } catch (error) { if (error?.code === 'ENOENT') return false; throw error }
}

async function tokenValue() {
  if (text(process.env.NAI_API_TOKEN).trim()) return process.env.NAI_API_TOKEN.trim()
  try {
    const value = (await readFile(TOKEN_FILE, 'utf8')).trim()
    if (value) return value
  } catch (error) { if (error?.code !== 'ENOENT') throw error }
  throw new Error(`未配置 NovelAI API Token，请在设置界面保存，或写入 ${TOKEN_FILE}`)
}

async function saveToken(value) {
  const token = text(value).trim()
  if (!token) throw new Error('API Token 不能为空')
  await mkdir(dirname(TOKEN_FILE), { recursive: true })
  await writeFile(TOKEN_FILE, `${token}\n`, { encoding: 'utf8', mode: 0o600 })
  return { configured: true, path: TOKEN_FILE }
}

async function generate(args) {
  const library = await readLibrary()
  const style = selectedStyle(library, args.style)
  if (text(args.style).trim() && !style) throw new Error(`找不到画师串：${args.style}`)
  const request = buildRequest({ ...args, prompt: compose(style, args.prompt), negative_prompt: args.negative_prompt === undefined ? style?.negativePrompt : args.negative_prompt })
  const response = await fetch(ENDPOINT, { method: 'POST', headers: { Authorization: `Bearer ${await tokenValue()}`, 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(request), signal: AbortSignal.timeout(120000) })
  if (!response.ok) throw new Error(`NovelAI HTTP ${response.status}: ${(await response.text()).slice(0, 600)}`)
  const payload = await response.json()
  const image = payload?.images?.[0]
  if (typeof image?.image !== 'string') throw new Error('NovelAI 响应中没有图片')
  const bytes = Buffer.from(image.image, 'base64')
  if (bytes.length > 30_000_000 || !bytes.subarray(0, 8).equals(PNG_SIGNATURE)) throw new Error('NovelAI 返回的不是有效 PNG')
  const outputDir = resolve(process.env.NAI_OUTPUT_DIR || join(process.env.USERPROFILE || homedir(), '.codex', 'nai-images'))
  await mkdir(outputDir, { recursive: true })
  const path = join(outputDir, `nai-${new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-')}-${randomUUID()}.png`)
  await writeFile(path, bytes, { flag: 'wx' })
  return { path, model: request.model, seed: image.seed ?? request.parameters.seed, width: request.parameters.width, height: request.parameters.height, bytes: bytes.length, style: style?.name || '' }
}

const schemas = {
  empty: { type: 'object', additionalProperties: false, properties: {} },
  key: { type: 'object', additionalProperties: false, properties: { id: { type: 'string' }, name: { type: 'string' } } },
}

function toolList() {
const ui = { ui: { resourceUri: RESOURCE_URI } }
const settingsUi = {
  ui: { resourceUri: RESOURCE_URI, visibility: ['app'] },
  'openai/ui': { entrypoints: [{ type: 'settings' }] },
  'ui/resourceUri': RESOURCE_URI,
}
  return [
    { name: 'nai_open_settings', title: 'NovelAI 设置', description: 'Open the NovelAI API and artist-style settings panel.', inputSchema: schemas.empty, annotations: { readOnlyHint: true, openWorldHint: false }, _meta: settingsUi },
    { name: 'nai_settings_get', description: 'Return whether the local NovelAI API Token is configured. Never returns the token.', inputSchema: schemas.empty },
    { name: 'nai_settings_save', description: 'Save the NovelAI API Token locally without returning it.', inputSchema: { type: 'object', additionalProperties: false, properties: { token: { type: 'string' } }, required: ['token'] } },
    { name: 'nai_style_list', description: 'List local artist/style presets and identify the current one.', inputSchema: { type: 'object', additionalProperties: false, properties: { group: { type: 'string' }, query: { type: 'string' } } }, _meta: ui },
    { name: 'nai_style_get', description: 'Read one local artist/style preset by id or exact name.', inputSchema: schemas.key },
    { name: 'nai_style_save', description: 'Create or update a local artist/style preset. artistText is preserved exactly.', inputSchema: { type: 'object', additionalProperties: false, properties: { id: { type: 'string' }, name: { type: 'string' }, group: { type: 'string' }, artistText: { type: 'string' }, prompt: { type: 'string' }, basePrompt: { type: 'string' }, negativePrompt: { type: 'string' } }, required: ['name', 'artistText'] } },
    { name: 'nai_style_select', description: 'Set the current local artist/style preset.', inputSchema: schemas.key },
    { name: 'nai_style_delete', description: 'Delete a local artist/style preset.', inputSchema: schemas.key },
    { name: 'nai_compose_prompt', description: 'Compose a prompt from an explicit or current style and a user prompt.', inputSchema: { type: 'object', additionalProperties: false, properties: { style: { type: 'string' }, prompt: { type: 'string' } }, required: ['prompt'] } },
    { name: 'nai_generate_image', description: 'Generate one paid NovelAI image. If style is omitted, the current selected style is used automatically.', inputSchema: { type: 'object', additionalProperties: false, properties: { prompt: { type: 'string' }, negative_prompt: { type: 'string' }, style: { type: 'string' }, model: { type: 'string' }, width: { type: 'integer' }, height: { type: 'integer' }, steps: { type: 'integer' }, scale: { type: 'number' }, seed: { type: 'integer' } }, required: ['prompt'] } },
  ]
}

async function callTool(name, args = {}) {
  if (name === 'nai_open_settings') return { opened: true, resourceUri: RESOURCE_URI }
  if (name === 'nai_settings_get') return { configured: await tokenConfigured() }
  if (name === 'nai_settings_save') return saveToken(args.token)
  const library = await readLibrary()
  if (name === 'nai_style_list') {
    const group = text(args.group).trim()
    const query = text(args.query).trim().toLowerCase()
    const styles = library.styles.filter((style) => (!group || style.group === group) && (!query || `${style.name} ${style.group} ${artistString(style)}`.toLowerCase().includes(query)))
    return { path: library.path, selectedStyleId: library.selectedStyleId, groups: library.groups, count: styles.length, styles: styles.map((style) => summary(style, library.selectedStyleId)) }
  }
  if (name === 'nai_style_get') {
    const style = findStyle(library, args.id || args.name) || selectedStyle(library)
    return style ? { found: true, ...summary(style, library.selectedStyleId), composedPrompt: compose(style, args.prompt || '') } : { found: false }
  }
  if (name === 'nai_style_save') {
    const existing = findStyle(library, args.id)
    const style = { ...(existing || {}), id: existing?.id || makeId(), name: text(args.name).trim(), group: text(args.group).trim() || existing?.group || 'Default', artistText: text(args.artistText), prompt: text(args.prompt), basePrompt: text(args.basePrompt), negativePrompt: text(args.negativePrompt), source: 'local', createdAt: existing?.createdAt || new Date().toISOString() }
    if (!style.name || !style.artistText) throw new Error('name 和 artistText 不能为空')
    const styles = existing ? library.styles.map((item) => item.id === existing.id ? style : item) : [...library.styles, style]
    const saved = await writeLibrary({ ...library, styles })
    return { saved: summary(style, saved.selectedStyleId), path: saved.path }
  }
  if (name === 'nai_style_select') {
    const style = findStyle(library, args.id || args.name)
    if (!style) throw new Error('找不到要选择的画师串')
    const saved = await writeLibrary({ ...library, selectedStyleId: style.id })
    return { selectedStyleId: saved.selectedStyleId, name: style.name, path: saved.path }
  }
  if (name === 'nai_style_delete') {
    const style = findStyle(library, args.id || args.name)
    if (!style) throw new Error('找不到要删除的画师串')
    const saved = await writeLibrary({ ...library, styles: library.styles.filter((item) => item.id !== style.id), selectedStyleId: library.selectedStyleId === style.id ? '' : library.selectedStyleId })
    return { deleted: style.id, path: saved.path }
  }
  if (name === 'nai_compose_prompt') {
    const style = selectedStyle(library, args.style)
    if (text(args.style).trim() && !style) throw new Error(`找不到画师串：${args.style}`)
    return { style: style?.name || '', styleId: style?.id || '', prompt: compose(style, args.prompt) }
  }
  if (name === 'nai_generate_image') return generate(args)
  throw new Error(`未知工具：${name}`)
}

async function resource() {
  const html = (await readFile(join(publicDir, 'public', 'settings.html'), 'utf8')).replaceAll('__LOCAL_SETTINGS_KEY__', '')
  return { contents: [{ uri: RESOURCE_URI, mimeType: 'text/html;profile=mcp-app', text: html }] }
}

function result(id, value) { return { jsonrpc: '2.0', id, result: value } }
function errorResult(id, code, message) { return { jsonrpc: '2.0', id, error: { code, message } } }
function send(value) { process.stdout.write(`${JSON.stringify(value)}\n`) }

async function dispatch(request) {
  if (request.method === 'notifications/initialized' || request.method?.startsWith('notifications/')) return null
  if (request.method === 'initialize') return result(request.id, { protocolVersion: request.params?.protocolVersion || '2024-11-05', capabilities: { tools: {}, resources: {} }, serverInfo: { name: 'codex-novelai-image', version: '0.1.0' } })
  if (request.method === 'ping') return result(request.id, {})
  if (request.method === 'tools/list') return result(request.id, { tools: toolList() })
  if (request.method === 'resources/list') return result(request.id, { resources: [{ uri: RESOURCE_URI, name: 'NovelAI settings', description: 'API Token and artist-style settings panel', mimeType: 'text/html;profile=mcp-app' }] })
  if (request.method === 'resources/read') return result(request.id, await resource())
  if (request.method === 'tools/call') {
    try {
      const value = await callTool(request.params?.name, request.params?.arguments || {})
      return result(request.id, { content: [{ type: 'text', text: JSON.stringify(value) }], structuredContent: value })
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause)
      return result(request.id, { isError: true, content: [{ type: 'text', text: message }] })
    }
  }
  return errorResult(request.id, -32601, `Method not found: ${request.method}`)
}

let buffer = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => {
  buffer += chunk
  while (buffer.includes('\n')) {
    const end = buffer.indexOf('\n')
    const line = buffer.slice(0, end).trim()
    buffer = buffer.slice(end + 1)
    if (!line) continue
    Promise.resolve().then(() => dispatch(JSON.parse(line))).then((response) => { if (response) send(response) }).catch((cause) => send(errorResult(null, -32700, cause instanceof Error ? cause.message : String(cause))))
  }
})
