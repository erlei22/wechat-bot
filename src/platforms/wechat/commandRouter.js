import { analyzeWechatMessages } from '../../analysis/wechatAnalyzer.js'
import { getWechatRuntimeConfig } from '../../config/env.js'
import { runOpenCli } from '../../adapters/opencli.js'
import { loadPatternConfig, addPattern, removePattern } from './patternConfig.js'
import { loadProfile } from './profileStore.js'
import { loadEventConfig, addEventType, getUpcomingGroupEvents, formatEventsForPrompt } from './eventStore.js'
import { listFeedback, countFeedback, updateFeedbackStatus, formatFeedbackList } from './feedbackStore.js'
import { getDeepseekReply } from '../../deepseek/index.js'

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
// /help — DeepSeek 根据当前群上下文动态生成，不暴露命令细节
// ---------------------------------------------------------------------------

async function generateHelp(roomName, dataDir) {
  const events = getUpcomingGroupEvents(roomName, dataDir)
  const { typeEmojis } = loadEventConfig(dataDir)
  const knownTypes = Object.keys(typeEmojis).join('、')

  const prompt = `[系统指令: 生成 /help 回复，不要暴露任何命令语法或技术细节]

当前群: ${roomName || '私聊'}
近期活动数量: ${events.length} 个
已知活动类型: ${knownTypes}

你能做的事（转化成自然语言介绍给用户，像朋友介绍自己，不是命令手册）：
- 随便聊，什么话题都行
- 群里发起活动，自动记录；有人说"我要去"、"算我一个"，自动更新参与者；可以查询谁要去、在哪集合、谁开车
- 认识群里的朋友，记得大家聊过的事，回复会更有针对性
- 分析群聊记录

用轻松随意的语气，两三句话说清楚，不要列清单，不要提任何命令或指令。`

  return await getDeepseekReply(prompt)
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
    const reply = await generateHelp(context.roomName, config.dataDir)
    return { handled: true, reply }
  }

  // ── /画像 ─────────────────────────────────────────────────────────────────
  if (command === '画像') {
    const target = tokens.slice(1).join(' ').trim()
    if (!target) return { handled: true, reply: '用法：/画像 <昵称>' }
    const profile = loadProfile(target, config.dataDir)
    if (!profile) return { handled: true, reply: `还没有 ${target} 的画像，多聊几句就有了` }
    const lines = [
      `👤 ${profile.name}`,
      `群组: ${profile.groups?.join('、') || '—'}`,
      `标签: ${profile.tags?.join('、') || '—'}`,
      ...(profile.notes?.slice(-8).map((n) => `  • ${n}`) || []),
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
  if (['分析', 'analyze', '统计', 'stats'].includes(command)) {
    const statsOnly = ['统计', 'stats'].includes(command)
    const result = await analyzeWechatMessages({
      ...parseTarget(tokens),
      dataDir: config.dataDir,
      statsOnly,
    })
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
