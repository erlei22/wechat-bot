import { analyzeWechatMessages } from '../../../analysis/wechatAnalyzer.js'
import { getWechatRuntimeConfig } from '../../../config/env.js'
import { runOpenCli } from '../../cli/opencli.js'
import { loadPatternConfig, addPattern, removePattern } from '../lifecycle/patternConfig.js'
import { loadProfile, noteText } from '../store/profileStore.js'
import { loadEventConfig, addEventType, getUpcomingGroupEvents, formatEventsForPrompt } from '../store/eventStore.js'
import { listFeedback, countFeedback, updateFeedbackStatus, formatFeedbackList } from '../store/feedbackStore.js'
import { listErrors, countErrors, clearErrors, formatErrorList, logError } from '../store/errorStore.js'

function stripMention(content, botName) {
  return content.replace(botName, '').trim()
}

function parseTarget(tokens) {
  const type = tokens[1]
  const value = tokens.slice(2).join(' ').trim()
  if (['群', '群聊', 'room', 'group'].includes(type)) return { room: value }
  if (['好友', 'friend', 'contact'].includes(type)) return { friend: value }
  return {}
}

// ---------------------------------------------------------------------------
// /help — 固定工具菜单，不调用 LLM，直接列出可用小工具
// ---------------------------------------------------------------------------

function generateHelp(roomName, dataDir) {
  const eventCount = roomName ? getUpcomingGroupEvents(roomName, dataDir).length : 0
  const lines = [
    '🛠 小工具菜单（直接发对应指令）',
    '',
    `📅 活动`,
    `   /活动            查看本群近期活动${roomName ? `（当前 ${eventCount} 个）` : ''}`,
    `   /活动 类型        查看活动类型`,
    '',
    `🌤 天气`,
    `   直接问"上海明天天气怎么样"即可，支持任意城市`,
    '',
    `📅 日历`,
    `   直接问"今天农历是什么"、"这个月节假日"、"端午节放几天"`,
    '',
    `👤 画像`,
    `   /画像 <昵称>      查看某人的画像`,
    '',
    `📊 群分析`,
    `   /统计 群          看本群统计，不走 AI`,
    `   /分析 群          AI 深度分析本群`,
    `   /分析 好友        分析你自己`,
    '',
    `💬 反馈`,
    `   直接说出你的建议或吐槽，会被自动记录`,
    '',
    `❓ /help          再次查看本菜单`,
  ]
  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// Admin-only commands — NOT mentioned in /help, not exposed to regular users
// ---------------------------------------------------------------------------

export async function handleAdminCommand(content, context = {}) {
  const config = getWechatRuntimeConfig()
  const normalized = stripMention(content, config.botName)

  if (!normalized.startsWith(config.commandPrefix)) {
    return { handled: false }
  }

  const commandLine = normalized.slice(config.commandPrefix.length).trim()
  const tokens = commandLine.split(/\s+/).filter(Boolean)
  const command = tokens[0]?.toLowerCase()

  // ── /help — user-facing, DeepSeek-generated ──────────────────────────────
  if (command === 'help' || command === '帮助') {
    const reply = generateHelp(context.roomName, config.dataDir)
    return { handled: true, reply }
  }

  // ── /画像 ─────────────────────────────────────────────────────────────────
  if (command === '画像') {
    const target = tokens.slice(1).join(' ').trim()
    if (!target) return { handled: true, reply: '用法：/画像 <昵称>' }
    const profile = loadProfile(target, config.dataDir)
    if (!profile) return { handled: true, reply: `还没有 ${target} 的画像，多聊几句就有了` }
    const genderLabel = { male: '男 ♂', female: '女 ♀', unknown: '—' }[profile.gender || 'unknown'] ?? '—'
    const lines = [
      `👤 ${profile.name}`,
      `性别: ${genderLabel}`,
      `群组: ${profile.groups?.join('、') || '—'}`,
      `标签: ${profile.tags?.join('、') || '—'}`,
      ...(profile.notes?.slice(-8).map((n) => `  • ${noteText(n)}${typeof n === 'object' && n?.group ? `（${n.group}）` : ''}`) || []),
      `消息数: ${profile.messageCount || 0}  |  最后活跃: ${profile.lastSeen?.slice(0, 10) || '—'}`,
    ]
    return { handled: true, reply: lines.join('\n') }
  }

  // ── /活动 (admin view) ────────────────────────────────────────────────────
  if (command === '活动') {
    const sub = tokens[1]
    const roomName = context.roomName
    if (!roomName) return { handled: true, reply: '活动指令仅在群聊中使用' }

    if (!sub) {
      const events = getUpcomingGroupEvents(roomName, config.dataDir)
      if (!events.length) return { handled: true, reply: '本群暂无近期活动' }
      return { handled: true, reply: formatEventsForPrompt(events, config.dataDir) }
    }

    if (sub === '类型' && !tokens[2]) {
      const { typeEmojis } = loadEventConfig(config.dataDir)
      const list = Object.entries(typeEmojis).map(([t, e]) => `${e} ${t}`).join('  ')
      return { handled: true, reply: `活动类型：${list}\n新增：/活动 类型 <名称> <emoji>` }
    }

    if (sub === '类型' && tokens[2]) {
      const isNew = addEventType(tokens[2], tokens[3] || '📌', config.dataDir)
      return { handled: true, reply: `${isNew ? '✅ 新增' : '✅ 更新'}活动类型：${tokens[3] || '📌'} ${tokens[2]}` }
    }
  }

  // ── /patterns ─────────────────────────────────────────────────────────────
  if (command === 'patterns') {
    const sub = tokens[1]
    if (!sub || sub === 'list') {
      const cfg = loadPatternConfig(config.dataDir)
      const list = cfg.patterns.map((p, i) => `${i}. ${p}`).join('\n')
      return { handled: true, reply: `🛡️ 拦截模式 (${cfg.patterns.length})：\n${list}` }
    }
    if (sub === 'add') {
      const pattern = tokens.slice(2).join(' ').trim()
      if (!pattern) return { handled: true, reply: '用法：/patterns add <正则>' }
      try { new RegExp(pattern, 'i') } catch { return { handled: true, reply: `❌ 无效正则：${pattern}` } }
      return { handled: true, reply: addPattern(pattern, config.dataDir) ? `✅ 已添加：${pattern}` : '⚠️ 已存在' }
    }
    if (sub === 'del') {
      const idx = parseInt(tokens[2], 10)
      if (isNaN(idx)) return { handled: true, reply: '用法：/patterns del <序号>' }
      const removed = removePattern(idx, config.dataDir)
      return { handled: true, reply: removed ? `🗑️ 已删除：${removed}` : `❌ 序号 ${idx} 不存在` }
    }
  }

  // ── /分析 /统计 ───────────────────────────────────────────────────────────
  // 权限边界（代码兜底，不交给 LLM）：群分析只能查"当前群"，好友分析默认只能查自己。
  if (['分析', 'analyze', '统计', 'stats'].includes(command)) {
    const statsOnly = ['统计', 'stats'].includes(command)
    const roomName = context.roomName
    const senderKey = context.alias || context.name || ''
    const target = parseTarget(tokens)

    // 私聊禁用群/好友分析（私聊已关闭，且这类查询涉及隐私边界）
    if (!roomName) {
      return { handled: true, reply: '群统计 / 分析只能在群聊里使用哦～' }
    }

    const analyzeOpts = { dataDir: config.dataDir, statsOnly }

    if ('friend' in target) {
      // 普通用户最多查自己；传了别人直接拒绝
      const who = target.friend || senderKey
      const isSelf = who === senderKey || who === context.name || who === context.alias
      if (!isSelf) {
        return { handled: true, reply: '只能分析你自己哦，群里的整体统计请用 /统计 群' }
      }
      analyzeOpts.friend = who
    } else {
      // 群分析：强制锁定当前群，忽略/拒绝用户传入的其它群名
      if (target.room && target.room !== roomName) {
        return { handled: true, reply: `只能统计当前群「${roomName}」，没法查别的群～` }
      }
      analyzeOpts.room = roomName
    }

    let result
    try {
      result = await analyzeWechatMessages(analyzeOpts)
    } catch (e) {
      logError('command', e, { command, roomName }, config.dataDir)
      return { handled: true, reply: '分析服务暂时不可用（可能没配置模型 key），可以先用 /统计 看本地数据～' }
    }

    if (statsOnly || !result.analysis) {
      return {
        handled: true,
        reply: [
          result.target,
          `消息数：${result.stats.totalMessages}`,
          `文本：${result.stats.textMessages}`,
          `均长：${result.stats.averageTextLength}`,
          `活跃：${result.stats.topSpeakers.map((s) => `${s.name}(${s.count})`).join('、') || '无'}`,
        ].join('\n'),
      }
    }
    return { handled: true, reply: result.analysis }
  }

  // ── /反馈 ─────────────────────────────────────────────────────────────────
  if (command === '反馈' || command === 'feedback') {
    const sub = tokens[1]

    // /反馈 — 最近 10 条待处理
    if (!sub) {
      const pending = countFeedback({ status: 'pending' }, config.dataDir)
      const rows = listFeedback({ status: 'pending', limit: 10 }, config.dataDir)
      const header = `💬 待处理反馈 (${pending} 条)：\n`
      return { handled: true, reply: header + formatFeedbackList(rows) }
    }

    // /反馈 全部 [pending|reviewed|done|dismissed]
    if (sub === '全部') {
      const status = tokens[2] || null
      const rows = listFeedback({ status, limit: 20 }, config.dataDir)
      const total = countFeedback({ status }, config.dataDir)
      return { handled: true, reply: `💬 反馈列表 (${total} 条)：\n` + formatFeedbackList(rows) }
    }

    // /反馈 已处理 <id>
    if (sub === '已处理' && tokens[2]) {
      const ok = updateFeedbackStatus(Number(tokens[2]), 'done', config.dataDir)
      return { handled: true, reply: ok ? `✅ #${tokens[2]} 已标记为已处理` : `找不到 #${tokens[2]}` }
    }

    // /反馈 关闭 <id>
    if (sub === '关闭' && tokens[2]) {
      const ok = updateFeedbackStatus(Number(tokens[2]), 'dismissed', config.dataDir)
      return { handled: true, reply: ok ? `🚫 #${tokens[2]} 已关闭` : `找不到 #${tokens[2]}` }
    }

    // /反馈 看过 <id>
    if (sub === '看过' && tokens[2]) {
      const ok = updateFeedbackStatus(Number(tokens[2]), 'reviewed', config.dataDir)
      return { handled: true, reply: ok ? `👀 #${tokens[2]} 已标记为已查看` : `找不到 #${tokens[2]}` }
    }

    return { handled: true, reply: '用法：/反馈 | 全部 | 已处理 <id> | 看过 <id> | 关闭 <id>' }
  }

  // ── /错误 /errors — 查看运行期错误日志，便于排查 bug ──────────────────────
  if (command === '错误' || command === 'errors') {
    const sub = tokens[1]

    if (sub === '清空' || sub === 'clear') {
      const n = clearErrors(config.dataDir)
      return { handled: true, reply: `🗑️ 已清空 ${n} 条错误日志` }
    }

    const scope = sub && sub !== '全部' && sub !== 'all' ? sub : null
    const total = countErrors({ scope }, config.dataDir)
    const rows = listErrors({ scope, limit: 10 }, config.dataDir)
    const header = `🐞 错误日志 (${total} 条${scope ? ` · ${scope}` : ''})：\n`
    return { handled: true, reply: header + formatErrorList(rows) }
  }

  // ── /opencli ──────────────────────────────────────────────────────────────
  if (command === 'opencli') {
    if (!config.enableRemoteOpenCli) {
      return { handled: true, reply: '远程 OpenCLI 未开启，需在 .env 中设置 ENABLE_REMOTE_OPENCLI=true' }
    }
    await runOpenCli(tokens.slice(1))
    return { handled: true, reply: 'OpenCLI 已执行，结果见本机控制台' }
  }

  return { handled: false }
}
