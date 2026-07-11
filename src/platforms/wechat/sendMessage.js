import { getDeepseekReplyWithTools } from '../../providers/deepseek/index.js'
import { getWechatRuntimeConfig } from '../../config/env.js'
import { handleAdminCommand } from './commands/commandRouter.js'
import { loadProfile, formatProfileForPrompt, extractAndUpdateProfile, isProfileRelevant } from './store/profileStore.js'
import { getUpcomingGroupEvents, formatEventsForPrompt } from './store/eventStore.js'
import { BOT_TOOLS, executeTool } from './commands/botTools.js'
import { throttledSay } from '../../utils/replyQueue.js'
import { logError } from './store/errorStore.js'
import { getHistory, addTurn } from './store/conversationStore.js'

/**
 * 给 AI 生成的回复加上标记，方便接收方区分"这是机器人在说话"。
 * 已带标记或标记为空时不重复添加。
 */
function markAiReply(text, marker) {
  if (!marker) return text
  if (typeof text !== 'string' || !text.trim()) return text
  if (text.startsWith(marker.trim())) return text
  return `${marker}${text}`
}

// 活动事实防编造护栏：活动信息只能来自数据库/工具，查不到就说没有。
const ACTIVITY_GUARDRAIL =
  '[规则: 关于活动/聚会/出行/集合时间地点/车主参与者等事实，只能依据上面"本群近期活动"或工具查询结果回答；若上面显示"无"或查不到，直接说本群暂无相关活动，绝对不要编造任何时间、地点、参与者或细节。]'

/**
 * 处理微信消息。
 * DeepSeek 通过 function calling 自行决定是否需要查询/修改活动、画像等数据。
 */
export async function defaultMessage(msg, bot) {

  const { botName, autoReplyPrefix, aliasWhiteList, roomWhiteList, commandPrefix, dataDir, privateChatAI, aiReplyMarker, multiRoundTurns } =
    getWechatRuntimeConfig()


  const contact = msg.talker()
  const room = msg.room()
  const content = msg.text()
  const roomName = (await room?.topic()) || null
  const remarkName = await contact.alias()
  const name = await contact.name()
  const senderKey = remarkName || name

  const isText = msg.type() === bot.Message.Type.Text
  const isRoom = roomWhiteList.includes(roomName) && content.includes(`${botName}`)
  const isAlias = aliasWhiteList.includes(remarkName) || aliasWhiteList.includes(name)
  const isBotSelf = botName === `@${remarkName}` || botName === `@${name}`
  const isBotSelfDebug = content.trimStart().startsWith('你是谁')
  const isAuthorizedCommand = (room && isRoom) || (!room && isAlias)

  if ((isBotSelf && !isBotSelfDebug) || !isText) return

  try {
    // 管理员指令（隐藏，不对普通用户暴露）
    if (content.replace(`${botName}`, '').trimStart().startsWith(commandPrefix)) {
      if (!isAuthorizedCommand) return
      const result = await handleAdminCommand(content, { roomName, alias: remarkName, name })
      if (result.handled) {
        if (result.reply) await throttledSay(room || contact, result.reply, room ? [contact] : [])
        return
      }
    }

    // 构建上下文前缀（画像 + 群活动）
    const profile = loadProfile(senderKey, dataDir)
    const upcomingEvents = roomName ? getUpcomingGroupEvents(roomName, dataDir) : []
    // 即使没有活动，也显式告诉模型"无"，避免它在信息缺失时凭空编造
    const eventsCtx = formatEventsForPrompt(upcomingEvents, dataDir) || '[本群近期活动: 无]'

    const toolCtx = { roomName, dataDir, senderKey }
    const toolHandler = (toolName, args) => executeTool(toolName, args, toolCtx)

    // 群聊：@机器人 触发
    if (isRoom && room && content.replace(`${botName}`, '').trimStart().startsWith(`${autoReplyPrefix}`)) {
      const question =
        (await msg.mentionText()) || content.replace(`${botName}`, '').replace(`${autoReplyPrefix}`, '')
      console.log('🌸 group:', question)

      const ctxParts = [`[群聊: ${roomName} | 发送者: ${senderKey}]`]
      // 只有当这句话确实涉及画像里的内容时才注入画像，且按群隔离（只用本群学到的记录）
      if (profile && isProfileRelevant(question, profile, roomName)) ctxParts.push(formatProfileForPrompt(profile, roomName))
      ctxParts.push(eventsCtx)
      // ACTIVITY_GUARDRAIL 作为 systemAppend 传入，放在 system message 里以利用 prefix cache
      const ctx = ctxParts.join('\n') + '\n'

      // 加载本群历史对话（按群隔离，最近 multiRoundTurns 轮），让模型感知上下文关联
      const history = getHistory(roomName, multiRoundTurns)

      const response = await getDeepseekReplyWithTools(ctx + question, BOT_TOOLS, toolHandler, ACTIVITY_GUARDRAIL, history)
      // 群聊里 @ 回提问者，让大家知道在回谁
      await throttledSay(room, markAiReply(response, aiReplyMarker), [contact])

      // 保存本轮到历史：仅存纯提问（不含 ctx 前缀），节省后续请求的 token
      addTurn(roomName, question, response, multiRoundTurns)

      extractAndUpdateProfile(senderKey, question, response, roomName, dataDir).catch(() => { })
      return
    }

    // 私聊
    if (isAlias && !room && content.trimStart().startsWith(`${autoReplyPrefix}`)) {
      // 私聊默认不启用 AI（PRIVATE_CHAT_AI=true 才开启），管理指令已在上方处理
      if (!privateChatAI) {
        console.log('🔕 私聊 AI 已关闭，跳过自动回复:', senderKey)
        return
      }
      const question = content.replace(`${autoReplyPrefix}`, '')
      console.log('🌸 private:', question)

      const ctxParts = [`[私聊 | 发送者: ${senderKey}]`]
      if (profile && isProfileRelevant(question, profile, '私聊')) ctxParts.push(formatProfileForPrompt(profile, '私聊'))
      const ctx = ctxParts.join('\n') + '\n'

      const response = await getDeepseekReplyWithTools(ctx + question, BOT_TOOLS, toolHandler)
      await throttledSay(contact, markAiReply(response, aiReplyMarker))
      extractAndUpdateProfile(senderKey, question, response, null, dataDir).catch(() => { })
    }
  } catch (e) {
    console.error('defaultMessage error:', e)
    logError('defaultMessage', e, { roomName, senderKey, text: content?.slice(0, 200) }, dataDir)
  }
}
