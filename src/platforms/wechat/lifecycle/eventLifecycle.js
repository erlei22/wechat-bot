import OpenAI from 'openai'
import dotenv from 'dotenv'
import {
  loadGroupEvents,
  saveGroupEvents,
  getUpcomingGroupEvents,
  loadEventConfig,
  addEventType,
  mergeEvent,
} from '../store/eventStore.js'
import { logError } from '../store/errorStore.js'

const env = { ...dotenv.config().parsed, ...process.env }

// ---------------------------------------------------------------------------
// 活动生命周期：二次确认 + 权限控制（全部由代码强约束，LLM 只负责识别意图）
//
// 规则：
//  - 新增活动：LLM 识别后先挂起为 pending，机器人请发起者确认，回复"确认"才落库。
//  - 删除活动：仅发起者可发起删除，二次确认后才删。
//  - 修改活动：仅发起者本人的消息能改。
//  - 参加活动：机器人不自动拉人，引导报名者去找发起者。
// ---------------------------------------------------------------------------

// 每个群最多一个待确认操作；内存存储，重启即失效（可接受）。
const pendingByRoom = new Map()
const PENDING_TTL_MS = 5 * 60 * 1000

// LLM 意图识别的每群冷却，控制成本（确认/取消是关键词匹配，不受此限）。
const classifyCooldown = new Map()
const CLASSIFY_COOLDOWN_MS = 2 * 60 * 1000

// ---------------------------------------------------------------------------
// 确认 / 取消 关键词识别（代码，确定性）
// ---------------------------------------------------------------------------

const CONFIRM_WORDS = ['确认', '确定', '对', '是的', '没错', '好的', '可以', '行', 'ok', 'yes', '嗯']
const CANCEL_WORDS = ['取消', '算了', '不用', '不要', '不是', '不对', '否', 'no']

function normalize(text) {
  return String(text || '')
    .trim()
    .toLowerCase()
    .replace(/[\s，。、！？!?,.~～]+/g, '')
}

/** 短消息且命中确认词才算确认，避免误触发。 */
export function isConfirm(text) {
  const t = normalize(text)
  if (!t || t.length > 10) return false
  return CONFIRM_WORDS.some((w) => t === w || t.startsWith(w))
}

export function isCancel(text) {
  const t = normalize(text)
  if (!t || t.length > 10) return false
  return CANCEL_WORDS.some((w) => t === w || t.startsWith(w))
}

// ---------------------------------------------------------------------------
// Pending 管理
// ---------------------------------------------------------------------------

function getValidPending(roomName) {
  const p = pendingByRoom.get(roomName)
  if (!p) return null
  if (Date.now() > p.expiresAt) {
    pendingByRoom.delete(roomName)
    return null
  }
  return p
}

function setPending(roomName, data) {
  pendingByRoom.set(roomName, { ...data, expiresAt: Date.now() + PENDING_TTL_MS })
}

export function clearPending(roomName) {
  pendingByRoom.delete(roomName)
}

// ---------------------------------------------------------------------------
// 提交待确认操作（确认后真正落库）
// ---------------------------------------------------------------------------

function commitPending(pend, roomName, dataDir) {
  const now = new Date().toISOString()

  if (pend.type === 'create') {
    const e = pend.event || {}
    // 新活动类型自动登记
    const { typeEmojis } = loadEventConfig(dataDir)
    if (e.type && !typeEmojis[e.type]) addEventType(e.type, '📌', dataDir)

    const events = loadGroupEvents(roomName, dataDir)
    const newEvent = {
      id: String(Date.now()),
      ...e,
      initiator: pend.initiator,
      participants: e.participants?.length ? [...new Set(e.participants)] : [pend.initiator],
      drivers: (e.drivers || []).filter((d) => d && d.name),
      room: roomName,
      status: 'upcoming',
      createdAt: now,
      updatedAt: now,
    }
    events.push(newEvent)
    saveGroupEvents(roomName, events, dataDir)
    return `✅ 活动已记录：${newEvent.title}${newEvent.date ? `（${newEvent.date}${newEvent.time ? ' ' + newEvent.time : ''}）` : ''}`
  }

  if (pend.type === 'delete') {
    const events = loadGroupEvents(roomName, dataDir)
    const idx = events.findIndex((ev) => ev.id === pend.eventId)
    if (idx < 0) return `找不到要删除的活动了`
    events[idx].status = 'cancelled'
    events[idx].updatedAt = now
    saveGroupEvents(roomName, events, dataDir)
    return `🗑️ 已删除活动：${events[idx].title}`
  }

  return null
}

// ---------------------------------------------------------------------------
// 应用意图（确定性核心：权限校验 + pending 流转），可单测
// intent: { action: 'create'|'update'|'join'|'leave'|'delete'|'none', targetId, event }
// 返回机器人要发的话，或 null（不回复）。
// ---------------------------------------------------------------------------

export function applyEventIntent(intent, { senderKey, roomName, dataDir }) {
  if (!intent || !intent.action || intent.action === 'none') return null
  const now = new Date().toISOString()

  switch (intent.action) {
    case 'create': {
      const e = intent.event
      if (!e || !e.title) return null
      setPending(roomName, { type: 'create', event: e, initiator: senderKey })
      const bits = [e.title]
      if (e.date) bits.push(`${e.date}${e.time ? ' ' + e.time : ''}`)
      if (e.location) bits.push(`@${e.location}`)
      return `📝 ${senderKey} 要发起活动「${bits.join(' / ')}」吗？回复『确认』我就记下来，回复『取消』忽略。`
    }

    case 'update': {
      if (!intent.targetId || !intent.event) return null
      const events = loadGroupEvents(roomName, dataDir)
      const idx = events.findIndex((ev) => ev.id === intent.targetId)
      if (idx < 0) return null
      const ev = events[idx]
      // 权限：只有发起者能改（旧数据无 initiator 时放行，避免破坏历史）
      if (ev.initiator && ev.initiator !== senderKey) {
        return `「${ev.title}」是 ${ev.initiator} 发起的，只有 TA 能修改哦～`
      }
      events[idx] = mergeEvent(ev, intent.event)
      events[idx].updatedAt = now
      saveGroupEvents(roomName, events, dataDir)
      return `✅ 已更新「${events[idx].title}」`
    }

    case 'delete': {
      if (!intent.targetId) return null
      const events = loadGroupEvents(roomName, dataDir)
      const ev = events.find((x) => x.id === intent.targetId && x.status !== 'cancelled')
      if (!ev) return null
      // 权限：只有发起者能删
      if (ev.initiator && ev.initiator !== senderKey) {
        return `「${ev.title}」是 ${ev.initiator} 发起的，只有 TA 能删除哦～`
      }
      setPending(roomName, { type: 'delete', eventId: ev.id, initiator: senderKey })
      return `⚠️ 确认删除活动「${ev.title}」吗？回复『确认』删除，回复『取消』放弃。`
    }

    case 'join': {
      // 机器人不自动拉人，引导报名者去找发起者
      if (!intent.targetId) return null
      const events = loadGroupEvents(roomName, dataDir)
      const ev = events.find((x) => x.id === intent.targetId && x.status !== 'cancelled')
      if (!ev) return null
      const who = ev.initiator || '发起者'
      return `想参加「${ev.title}」的话，直接找发起者 ${who} 报名确认哈～`
    }

    case 'leave': {
      // 允许本人退出（移除自己）
      if (!intent.targetId) return null
      const events = loadGroupEvents(roomName, dataDir)
      const idx = events.findIndex((ev) => ev.id === intent.targetId)
      if (idx < 0) return null
      const before = events[idx].participants || []
      if (!before.includes(senderKey)) return null
      events[idx].participants = before.filter((p) => p !== senderKey)
      events[idx].updatedAt = now
      saveGroupEvents(roomName, events, dataDir)
      return `已把你从「${events[idx].title}」的名单里移除了`
    }

    default:
      return null
  }
}

// ---------------------------------------------------------------------------
// LLM 意图分类（语义层，结果交给 applyEventIntent 做权限/落库）
// ---------------------------------------------------------------------------

async function classifyIntent(text, senderKey, roomName, dataDir) {
  const apiKey = env.DEEPSEEK_API_KEY
  const baseURL = env.DEEPSEEK_URL || 'https://api.deepseek.com/v1'
  const model = env.DEEPSEEK_MODEL || 'deepseek-v4-flash'
  if (!apiKey) return { action: 'none' }

  const existing = getUpcomingGroupEvents(roomName, dataDir)
  const today = new Date().toISOString().slice(0, 10)
  const { typeEmojis } = loadEventConfig(dataDir)
  const knownTypes = Object.keys(typeEmojis).join('、')

  const openai = new OpenAI({ apiKey, baseURL })

  const prompt = `你在观察微信群"${roomName}"的聊天，判断这条消息对"群活动"想做什么操作。

今天日期: ${today}
发言人: ${senderKey}
消息: ${text}

当前已记录的近期活动:
${existing.length ? existing.map((e) => `- id:${e.id} | ${e.title} | ${e.date || '?'} | ${e.location || '?'} | 发起者:${e.initiator || '?'}`).join('\n') : '（无）'}

已知活动类型: ${knownTypes}（新类型可自填）

判断 action（口语化也要识别）：
- "create"：发起/邀约新活动，如「周六爬山有人去吗」「晚上去喝一杯」「一起吃饭」。
- "update"：发起者补充或修改已有活动的时间/地点/集合/备注，需给出 targetId。
- "join"：有人想报名加入，如「算我一个」「我要去」「带我」，需给出 targetId。
- "leave"：有人想退出，如「我去不了了」，需给出 targetId。
- "delete"：要取消/删除某个已有活动，需给出 targetId。
- "none"：纯聊天、吐槽、提问，与活动无关。

返回 JSON：
{
  "action": "none",
  "targetId": "",
  "event": {
    "title": "", "type": "", "date": "", "time": "",
    "location": "", "meetingPoint": "", "notes": ""
  }
}
注意：日期口语（今晚/今天/周六/下周）要换算成 YYYY-MM-DD。`

  const res = await openai.chat.completions.create({
    model,
    messages: [{ role: 'user', content: prompt }],
    response_format: { type: 'json_object' },
    max_tokens: 400,
  })
  return JSON.parse(res.choices[0].message.content || '{}')
}

// ---------------------------------------------------------------------------
// 主入口：每条群消息调用一次。
// 先处理待确认（关键词，确定性，无 LLM），否则做意图分类并按权限落库。
// 返回机器人要发的回复字符串，或 null。
// ---------------------------------------------------------------------------

export async function processEventMessage({ text, senderKey, roomName, dataDir }) {
  if (!roomName || !text || !senderKey) return null

  try {
    // 1) 待确认优先：有挂起操作时，只认发起者的确认/取消，其它一律不再触发新流程
    const pend = getValidPending(roomName)
    if (pend) {
      if (senderKey === pend.initiator) {
        if (isConfirm(text)) {
          clearPending(roomName)
          return commitPending(pend, roomName, dataDir)
        }
        if (isCancel(text)) {
          clearPending(roomName)
          return '好的，已取消～'
        }
      }
      return null
    }

    // 2) LLM 意图分类，受每群冷却限制
    const last = classifyCooldown.get(roomName) || 0
    if (Date.now() - last < CLASSIFY_COOLDOWN_MS) return null
    classifyCooldown.set(roomName, Date.now())

    const intent = await classifyIntent(text, senderKey, roomName, dataDir)
    return applyEventIntent(intent, { senderKey, roomName, dataDir })
  } catch (e) {
    logError('processEventMessage', e, { roomName, senderKey, text: text?.slice(0, 200) }, dataDir)
    return null
  }
}
