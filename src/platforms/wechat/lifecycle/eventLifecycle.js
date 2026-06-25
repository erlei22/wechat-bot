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
import { safeJsonParse } from '../../../utils/json.js'

const env = { ...dotenv.config().parsed, ...process.env }

// ---------------------------------------------------------------------------
// 活动生命周期：二次确认 + 权限控制（全部由代码强约束，LLM 只负责识别意图）
//
// 规则：
//  - 新增活动：LLM 识别后先挂起为 pending，机器人请发起者确认，回复"确认"才落库。
//  - 删除活动：仅发起者可发起删除，二次确认后才删。
//  - 修改活动：仅发起者本人的消息能改。
//  - 参加活动：自助报名，谁说"我要去"就把谁加进名单；退出同理（移除自己）。
//    增减他人 / 改活动细节仍仅发起者可做。
// ---------------------------------------------------------------------------

// 每个群最多一个待确认操作；内存存储，重启即失效（可接受）。
const pendingByRoom = new Map()
const PENDING_TTL_MS = 5 * 60 * 1000

// LLM 意图识别的每群冷却，控制成本（确认/取消是关键词匹配，不受此限）。
const classifyCooldown = new Map()
const CLASSIFY_COOLDOWN_MS = 30 * 1000

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
      title: e.title,
      type: e.type || '',
      date: e.date || '',
      time: e.time || '',
      location: e.location || e.meetingPoint || '',
      initiator: pend.initiator,
      participants: e.participants?.length ? [...new Set(e.participants)] : [pend.initiator],
      notes: e.notes || '',
      room: roomName,
      status: 'upcoming',
      createdAt: now,
      updatedAt: now,
    }
    events.push(newEvent)
    saveGroupEvents(roomName, events, dataDir)
    return [
      `✅ 活动已记录：${newEvent.title}${newEvent.date ? `（${newEvent.date}${newEvent.time ? ' ' + newEvent.time : ''}）` : ''}`,
      '',
      `后续操作：`,
      `• 补充信息 → ${newEvent.initiator} 直接说"集合地点在XX"、"改成8点"，我会自动更新`,
      `• 想参加 → 直接发"我要去"/"算我一个"，我帮你记上名单`,
      `• 取消活动 → ${newEvent.initiator} 说"取消活动"即可`,
    ].join('\n')
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
      return [
        `📝 ${senderKey} 要发起活动「${bits.join(' / ')}」`,
        '',
        `👉 ${senderKey} 本人直接在群里发一句「确认」即可记录`,
        `   发「取消」则忽略`,
        `   （5分钟内有效，其他人的确认无效）`,
      ].join('\n')
    }

    case 'update': {
      if (!intent.targetId) return null
      const events = loadGroupEvents(roomName, dataDir)
      const idx = events.findIndex((ev) => ev.id === intent.targetId)
      if (idx < 0) return null
      const ev = events[idx]
      // 权限：只有发起者能改（含增减名单）。旧数据无 initiator 时放行。
      if (ev.initiator && ev.initiator !== senderKey) {
        return `「${ev.title}」是 ${ev.initiator} 发起的，只有 TA 能改哦～`
      }
      if (intent.event) events[idx] = mergeEvent(ev, intent.event) // 含 participants 追加
      // 移除参与者（发起者把谁踢出名单）
      const remove = Array.isArray(intent.removeParticipants) ? intent.removeParticipants : []
      if (remove.length) {
        events[idx].participants = (events[idx].participants || []).filter((p) => !remove.includes(p))
      }
      events[idx].updatedAt = now
      saveGroupEvents(roomName, events, dataDir)
      const u = events[idx]
      const info = [u.date, u.time, u.location].filter(Boolean).join(' / ')
      const roster = u.participants?.length ? `\n名单（${u.participants.length}人）：${u.participants.join('、')}` : ''
      return `✅ 已更新「${u.title}」${info ? `\n${info}` : ''}${roster}`
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
      return [
        `⚠️ 确认要删除活动「${ev.title}」吗？`,
        '',
        `👉 ${senderKey} 本人直接在群里发一句「确认」即删除`,
        `   发「取消」则保留`,
        `   （5分钟内有效，其他人的确认无效）`,
      ].join('\n')
    }

    case 'join': {
      // 自助报名：谁想参加就直接把本人加进名单，不用发起者确认
      if (!intent.targetId) return null
      const events = loadGroupEvents(roomName, dataDir)
      const idx = events.findIndex((x) => x.id === intent.targetId && x.status !== 'cancelled')
      if (idx < 0) return null
      const ev = events[idx]
      const roster = ev.participants || []
      if (roster.includes(senderKey)) {
        return `${senderKey} 已经在「${ev.title}」名单里啦～当前 ${roster.length} 人：${roster.join('、')}`
      }
      ev.participants = [...roster, senderKey]
      ev.updatedAt = now
      saveGroupEvents(roomName, events, dataDir)
      return [
        `✅ 已把 ${senderKey} 加进「${ev.title}」`,
        `当前 ${ev.participants.length} 人：${ev.participants.join('、')}`,
        `（去不了了说一声「我不去了」就帮你撤下）`,
      ].join('\n')
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

    case 'query': {
      // 有人咨询近期活动 → 主动播报（只有真有活动才插话，避免噪音）
      const events = getUpcomingGroupEvents(roomName, dataDir)
      if (!events.length) return null
      const lines = ['📋 本群近期活动：']
      for (const e of events.slice(0, 5)) {
        const when = [e.date, e.time].filter(Boolean).join(' ')
        const where = e.location ? ` @${e.location}` : ''
        lines.push(`• ${e.title}${when || where ? `（${[when, where.trim()].filter(Boolean).join(' ')}）` : ''}`)
        const meta = []
        if (e.initiator) meta.push(`发起人：${e.initiator}`)
        if (e.participants?.length) meta.push(`已报名 ${e.participants.length} 人：${e.participants.join('、')}`)
        if (meta.length) lines.push(`   ${meta.join('　')}`)
      }
      lines.push('想参加直接说"我要去"/"算我一个"，我帮你记上～')
      return lines.join('\n')
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
- "update"：发起者补充/修改已有活动的时间/地点/集合/备注，或增减参与者（"把麻薯加上"/"大林也去"→放进 event.participants；"去掉小白"/"麻薯不去了"→放进 removeParticipants），需给出 targetId。
- "join"：有人想报名加入，如「算我一个」「我要去」「带我」，需给出 targetId。
- "leave"：有人想退出，如「我去不了了」，需给出 targetId。
- "delete"：要取消/删除某个已有活动，需给出 targetId。
- "query"：有人在打听近期活动/有什么安排/去哪玩/周末干嘛/今晚有啥，想知道群里有什么活动。
- "none"：纯聊天、吐槽、提问，与活动无关。

返回 JSON：
{
  "action": "none",
  "targetId": "",
  "event": {
    "title": "", "type": "", "date": "", "time": "",
    "location": "", "notes": "", "participants": []
  },
  "removeParticipants": []
}
注意：
- 日期口语（今晚/今天/周六/下周）要换算成 YYYY-MM-DD。
- event.participants 只在 update 且发起者明确要加人时填；create 不用填（发起者自动入列）。`

  const res = await openai.chat.completions.create({
    model,
    messages: [{ role: 'user', content: prompt }],
    response_format: { type: 'json_object' },
    max_tokens: 500,
  })
  return safeJsonParse(res.choices[0].message.content) || { action: 'none' }
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
