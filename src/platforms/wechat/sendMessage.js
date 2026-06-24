import { getDeepseekReplyWithTools } from '../../providers/deepseek/index.js'
import { getWechatRuntimeConfig } from '../../config/env.js'
import { handleAdminCommand } from './commands/commandRouter.js'
import { loadProfile, formatProfileForPrompt, extractAndUpdateProfile, isProfileRelevant } from './store/profileStore.js'
import { getUpcomingGroupEvents, formatEventsForPrompt } from './store/eventStore.js'
import { BOT_TOOLS, executeTool } from './commands/botTools.js'
import { throttledSay } from '../../utils/replyQueue.js'
import { logError } from './store/errorStore.js'
import { getHistory, addTurn } from './store/conversationStore.js'
import { logger } from '../../utils/logger.js'

function markAiReply(text, marker) {
  if (!marker) return text
  if (typeof text !== 'string' || !text.trim()) return text
  if (text.startsWith(marker.trim())) return text
  return `${marker}${text}`
}

const ACTIVITY_GUARDRAIL =
  '[规则: 关于活动/聚会/出行/集合时间地点/车主参与者等事实，只能依据上面"本群近期活动"或工具查询结果回答；若上面显示"无"或查不到，直接说本群暂无相关活动，绝对不要编造任何时间、地点、参与者或细节。]'

export async function defaultMessage(msg, bot) {
  const {
    botName, autoReplyPrefix, aliasWhiteList, roomWhiteList,
    commandPrefix, dataDir, privateChatAI, aiReplyMarker, multiRoundTurns,
  } = getWechatRuntimeConfig()

  const contact = msg.talker()
  const room = msg.room()
  const content = msg.text()
  const roomName = (await room?.topic()) || null
  const remarkName = await contact.alias()
  const name = await contact.name()
  const senderKey = remarkName || name

  const isText = msg.type() === bot.Message.Type.Text
  const isRoom = roomWhiteList.includes(roomName) && content.includes(botName)
  const isAlias = aliasWhiteList.includes(remarkName) || aliasWhiteList.includes(name)
  const isBotSelf = botName === `@${remarkName}` || botName === `@${name}`
  const isBotSelfDebug = content.trimStart().startsWith('你是谁')
  const isAuthorizedCommand = (room && isRoom) || (!room && isAlias)

  // ── 每条消息都打 debug，方便排查为什么没回复 ─────────────────────────────
  logger.debug('[MSG IN]', {
    room: roomName ?? '私聊',
    sender: senderKey,
    content: content.slice(0, 50),
    isText,
    isRoom,
    isAlias,
    isBotSelf,
    isAuthorizedCommand,
    botName,
    roomWhiteList,
    aliasWhiteList,
  })

  if (!isText) {
    logger.debug('[SKIP] 非文本消息')
    return
  }
  if (isBotSelf && !isBotSelfDebug) {
    logger.debug('[SKIP] bot 自身消息')
    return
  }

  try {
    // ── 管理指令 ─────────────────────────────────────────────────────────────
    if (content.replace(botName, '').trimStart().startsWith(commandPrefix)) {
      if (!isAuthorizedCommand) {
        logger.debug('[SKIP] 指令不在授权范围')
        return
      }
      logger.debug('[CMD]', content.slice(0, 60))
      const result = await handleAdminCommand(content, { roomName, alias: remarkName, name })
      if (result.handled) {
        if (result.reply) await throttledSay(room || contact, result.reply, room ? [contact] : [])
        return
      }
    }

    // ── 共用上下文 ────────────────────────────────────────────────────────────
    const profile = loadProfile(senderKey, dataDir)
    const upcomingEvents = roomName ? getUpcomingGroupEvents(roomName, dataDir) : []
    const eventsCtx = formatEventsForPrompt(upcomingEvents, dataDir) || '[本群近期活动: 无]'
    const toolCtx = { roomName, dataDir, senderKey }
    const toolHandler = (toolName, args) => executeTool(toolName, args, toolCtx)

    // ── 群聊：@机器人 触发 ────────────────────────────────────────────────────
    if (isRoom && room && content.replace(botName, '').trimStart().startsWith(autoReplyPrefix)) {
      const question =
        (await msg.mentionText()) || content.replace(botName, '').replace(autoReplyPrefix, '')

      // 优先处理活动确认/取消（用户习惯 @bot 后说"确认"）
      const { processEventMessage } = await import('./lifecycle/eventLifecycle.js')
      const eventReply = await processEventMessage({ text: question, senderKey, roomName, dataDir })
      if (eventReply) {
        logger.info('[EVENT]', { room: roomName, sender: senderKey, reply: eventReply.slice(0, 60) })
        await throttledSay(room, markAiReply(eventReply, aiReplyMarker), [contact])
        return
      }

      logger.info('[GROUP]', { room: roomName, sender: senderKey, q: question.slice(0, 60) })

      const ctxParts = [`[群聊: ${roomName} | 发送者: ${senderKey}]`]
      if (profile && isProfileRelevant(question, profile, roomName)) {
        ctxParts.push(formatProfileForPrompt(profile, roomName))
      }
      ctxParts.push(eventsCtx)
      const ctx = ctxParts.join('\n') + '\n'

      const history = getHistory(roomName, multiRoundTurns)
      logger.debug('[AI →]', { ctxLen: ctx.length, historyTurns: history.length })

      const response = await getDeepseekReplyWithTools(ctx + question, BOT_TOOLS, toolHandler, ACTIVITY_GUARDRAIL, history)
      logger.info('[REPLY ←]', { room: roomName, preview: response.slice(0, 60) })

      await throttledSay(room, markAiReply(response, aiReplyMarker), [contact])
      addTurn(roomName, question, response, multiRoundTurns)
      extractAndUpdateProfile(senderKey, question, response, roomName, dataDir).catch(() => { })
      return
    }

    if (room) {
      // 在群里但没命中：要么群不在白名单，要么没@机器人
      logger.debug('[SKIP] 群聊未触发', {
        reason: !roomWhiteList.includes(roomName)
          ? `群名不在白名单: "${roomName}"`
          : !content.includes(botName)
            ? `消息未包含 botName: "${botName}"`
            : '消息不以 autoReplyPrefix 开头',
      })
      return
    }

    // ── 私聊 ──────────────────────────────────────────────────────────────────
    if (isAlias && !room && content.trimStart().startsWith(autoReplyPrefix)) {
      if (!privateChatAI) {
        logger.debug('[SKIP] 私聊 AI 已关闭', { sender: senderKey })
        return
      }
      const question = content.replace(autoReplyPrefix, '')
      logger.info('[PRIVATE]', { sender: senderKey, q: question.slice(0, 60) })

      const ctxParts = [`[私聊 | 发送者: ${senderKey}]`]
      if (profile && isProfileRelevant(question, profile, '私聊')) {
        ctxParts.push(formatProfileForPrompt(profile, '私聊'))
      }
      const ctx = ctxParts.join('\n') + '\n'

      const response = await getDeepseekReplyWithTools(ctx + question, BOT_TOOLS, toolHandler)
      await throttledSay(contact, markAiReply(response, aiReplyMarker))
      extractAndUpdateProfile(senderKey, question, response, null, dataDir).catch(() => { })
      return
    }

    logger.debug('[SKIP] 未命中任何触发条件', { isAlias, room: !!room, autoReplyPrefix })

  } catch (e) {
    logger.error('[ERROR] defaultMessage', e)
    logError('defaultMessage', e, { roomName, senderKey, text: content?.slice(0, 200) }, dataDir)
  }
}
