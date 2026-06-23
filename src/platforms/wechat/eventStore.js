import fs from 'fs'
import path from 'path'
import OpenAI from 'openai'
import dotenv from 'dotenv'

const env = { ...dotenv.config().parsed, ...process.env }

// ---------------------------------------------------------------------------
// Event config — type→emoji mapping, stored in a file so new types can be
// added without touching code.
// ---------------------------------------------------------------------------

const DEFAULT_EVENT_CONFIG = {
  version: 1,
  updatedAt: new Date().toISOString(),
  note: '在 typeEmojis 里添加新的活动类型和对应 emoji，重启后生效。',
  typeEmojis: {
    徒步: '🥾',
    聚餐: '🍜',
    聚会: '🎉',
    搬家: '📦',
    其他: '📌',
  },
}

function getEventConfigPath(dataDir = '.data/wechat') {
  return path.resolve(process.cwd(), dataDir, 'config', 'event-config.json')
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true })
}

export function loadEventConfig(dataDir = '.data/wechat') {
  const filePath = getEventConfigPath(dataDir)
  if (!fs.existsSync(filePath)) {
    ensureDir(path.dirname(filePath))
    fs.writeFileSync(filePath, JSON.stringify(DEFAULT_EVENT_CONFIG, null, 2), 'utf8')
    return DEFAULT_EVENT_CONFIG
  }
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'))
  } catch {
    return DEFAULT_EVENT_CONFIG
  }
}

export function saveEventConfig(config, dataDir = '.data/wechat') {
  const filePath = getEventConfigPath(dataDir)
  ensureDir(path.dirname(filePath))
  config.updatedAt = new Date().toISOString()
  fs.writeFileSync(filePath, JSON.stringify(config, null, 2), 'utf8')
}

/** Add or update a type→emoji mapping at runtime. */
export function addEventType(type, emoji, dataDir = '.data/wechat') {
  const config = loadEventConfig(dataDir)
  const exists = config.typeEmojis[type]
  config.typeEmojis[type] = emoji
  saveEventConfig(config, dataDir)
  return !exists // true = new, false = updated
}

function getTypeEmoji(type, dataDir) {
  const { typeEmojis } = loadEventConfig(dataDir)
  return typeEmojis[type] || typeEmojis['其他'] || '📌'
}

// ---------------------------------------------------------------------------
// File helpers — each group gets its own events file
// ---------------------------------------------------------------------------

function safeRoomKey(roomName) {
  return (roomName || 'private').replace(/[/\\:*?"<>|]/g, '_')
}

function getEventsPath(roomName, dataDir = '.data/wechat') {
  return path.resolve(process.cwd(), dataDir, 'events', `${safeRoomKey(roomName)}.json`)
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

export function loadGroupEvents(roomName, dataDir = '.data/wechat') {
  const filePath = getEventsPath(roomName, dataDir)
  if (!fs.existsSync(filePath)) return []
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'))
  } catch {
    return []
  }
}

export function saveGroupEvents(roomName, events, dataDir = '.data/wechat') {
  const filePath = getEventsPath(roomName, dataDir)
  ensureDir(path.dirname(filePath))
  fs.writeFileSync(filePath, JSON.stringify(events, null, 2), 'utf8')
}

export function getUpcomingGroupEvents(roomName, dataDir = '.data/wechat') {
  if (!roomName) return []
  const events = loadGroupEvents(roomName, dataDir)
  const now = new Date()
  now.setHours(0, 0, 0, 0)
  return events
    .filter((e) => e.status !== 'cancelled' && e.date && new Date(e.date) >= now)
    .sort((a, b) => new Date(a.date) - new Date(b.date))
    .slice(0, 8)
}

// ---------------------------------------------------------------------------
// Prompt injection
// ---------------------------------------------------------------------------

export function formatEventsForPrompt(events, dataDir = '.data/wechat') {
  if (!events?.length) return ''
  const lines = events.map((e) => {
    const emoji = getTypeEmoji(e.type, dataDir)
    const parts = []
    if (e.date) parts.push(`🗓 ${e.date}${e.time ? ' ' + e.time : ''}`)
    if (e.location) parts.push(`📍 ${e.location}`)
    if (e.meetingPoint) parts.push(`集合: ${e.meetingPoint}`)
    if (e.participants?.length) parts.push(`参与: ${e.participants.join('、')}`)
    if (e.drivers?.length) parts.push(`车主: ${e.drivers.map((d) => `${d.name}(${d.seats || '?'}座)`).join('、')}`)
    if (e.notes) parts.push(`备注: ${e.notes}`)
    return `${emoji}[${e.id}] ${e.title} — ${parts.join(' | ')}`
  })
  return `[本群近期活动:\n${lines.join('\n')}]`
}

// ---------------------------------------------------------------------------
// Async event extraction
// No keyword pre-filter — DeepSeek judges relevance in the prompt itself.
// Per-room cooldown keeps API cost under control.
// ---------------------------------------------------------------------------

const extractionCooldown = new Map()
const EXTRACTION_COOLDOWN_MS = 2 * 60 * 1000 // 2 minutes per room

function mergeEvent(existing, updates) {
  const merged = { ...existing }
  for (const [key, val] of Object.entries(updates)) {
    if (val === null || val === undefined || val === '') continue
    if (key === 'participants' && Array.isArray(val) && val.length) {
      merged.participants = [...new Set([...(merged.participants || []), ...val])]
    } else if (key === 'drivers' && Array.isArray(val) && val.length) {
      const map = new Map((merged.drivers || []).map((d) => [d.name, d]))
      val.forEach((d) => { if (d.name) map.set(d.name, { ...map.get(d.name), ...d }) })
      merged.drivers = [...map.values()]
    } else {
      merged[key] = val
    }
  }
  return merged
}

/**
 * Try to extract event info from a group message.
 * DeepSeek decides whether the message is event-related — no regex gate.
 * Fire-and-forget — call with .catch(()=>{}).
 */
export async function extractEventFromMessage(text, senderKey, roomName, dataDir = '.data/wechat') {
  if (!roomName || !text) return

  // Per-room rate limit — the main cost control
  const lastTime = extractionCooldown.get(roomName) || 0
  if (Date.now() - lastTime < EXTRACTION_COOLDOWN_MS) return
  extractionCooldown.set(roomName, Date.now())

  const apiKey = env.DEEPSEEK_API_KEY
  const baseURL = env.DEEPSEEK_URL || 'https://api.deepseek.com/v1'
  const model = env.DEEPSEEK_MODEL || 'deepseek-v4-flash'
  if (!apiKey) return

  const existing = getUpcomingGroupEvents(roomName, dataDir)
  const today = new Date().toISOString().slice(0, 10)

  // Tell DeepSeek what activity types are currently configured
  const { typeEmojis } = loadEventConfig(dataDir)
  const knownTypes = Object.keys(typeEmojis).join('、')

  const openai = new OpenAI({ apiKey, baseURL })

  const prompt = `你在观察微信群"${roomName}"的聊天消息，判断是否包含群活动信息。

今天日期: ${today}
发言人: ${senderKey}
消息: ${text}

当前已记录的近期活动:
${existing.length ? existing.map((e) => `- id:${e.id} | ${e.title} | ${e.date || '?'} | ${e.location || '?'}`).join('\n') : '（无）'}

已知活动类型: ${knownTypes}（如果是新类型，自己填写）

判断规则：
- 只有消息明确涉及"约好了要一起做某事"、"发起活动"、"报名参加"、"提供/询问车位"、"确认集合时间地点"等才算活动信息
- 普通闲聊、问候、表情、转账提醒等不算
- 有人说"我也去"、"算我一个"视为加入已有活动

返回 JSON，不是活动信息就返回 {"isEvent": false}：
{
  "isEvent": true,
  "action": "create",      // "create" 新活动 | "update" 更新已有活动
  "targetId": "",          // action=update 时填已有活动 id
  "event": {
    "title": "",           // 简短标题，如"周六爬山"、"帮老王搬家"
    "type": "",            // 从已知类型选，或自己填新类型
    "date": "",            // YYYY-MM-DD，"周六"等相对日期请推算
    "time": "",            // 出发/开始时间
    "location": "",        // 目的地或活动地点
    "meetingPoint": "",    // 集合地点
    "participants": [],    // 参与人昵称
    "drivers": [{ "name": "", "seats": 0 }],
    "notes": ""
  }
}`

  try {
    const res = await openai.chat.completions.create({
      model,
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
      max_tokens: 400,
    })

    const result = JSON.parse(res.choices[0].message.content || '{}')
    if (!result.isEvent || !result.event) return

    // If a new activity type appears, auto-register it with a default emoji
    const eventType = result.event.type
    if (eventType && !typeEmojis[eventType]) {
      addEventType(eventType, '📌', dataDir)
      console.log(`📝 新活动类型已记录: ${eventType}`)
    }

    const events = loadGroupEvents(roomName, dataDir)

    if (result.action === 'update' && result.targetId) {
      const idx = events.findIndex((e) => e.id === result.targetId)
      if (idx >= 0) {
        events[idx] = mergeEvent(events[idx], result.event)
        events[idx].updatedAt = new Date().toISOString()
        saveGroupEvents(roomName, events, dataDir)
        console.log(`📅 活动更新 [${roomName}]: ${events[idx].title}`)
        return
      }
    }

    const newEvent = {
      id: String(Date.now()),
      ...result.event,
      drivers: (result.event.drivers || []).filter((d) => d.name),
      room: roomName,
      status: 'upcoming',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    events.push(newEvent)
    saveGroupEvents(roomName, events, dataDir)
    console.log(`📅 新活动记录 [${roomName}]: ${newEvent.title} (${newEvent.date || '日期待定'})`)
  } catch (e) {
    console.error('extractEventFromMessage 失败:', e.message)
  }
}
