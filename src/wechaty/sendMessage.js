import { getDeepseekReplyWithTools } from '../deepseek/index.js'
import { getWechatRuntimeConfig } from '../config/env.js'
import { handleAdminCommand } from '../platforms/wechat/commandRouter.js'
import { loadProfile, formatProfileForPrompt, extractAndUpdateProfile } from '../platforms/wechat/profileStore.js'
import { getUpcomingGroupEvents, formatEventsForPrompt } from '../platforms/wechat/eventStore.js'
import { BOT_TOOLS, executeTool } from '../platforms/wechat/botTools.js'
import { throttledSay } from '../utils/replyQueue.js'

/**
 * 处理微信消息。
 * DeepSeek 通过 function calling 自行决定是否需要查询/修改活动、画像等数据。
 */
export async function defaultMessage(msg, bot) {
  const { botName, autoReplyPrefix, aliasWhiteList, roomWhiteList, commandPrefix, dataDir } =
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
        if (result.reply) await throttledSay(room || contact, result.reply)
        return
      }
    }

    // 构建上下文前缀（画像 + 群活动）
    const profile = loadProfile(senderKey, dataDir)
    const profileCtx = formatProfileForPrompt(profile)
    const upcomingEvents = roomName ? getUpcomingGroupEvents(roomName, dataDir) : []
    const eventsCtx = formatEventsForPrompt(upcomingEvents, dataDir)

    const toolCtx = { roomName, dataDir, senderKey }
    const toolHandler = (toolName, args) => executeTool(toolName, args, toolCtx)

    // 群聊：@机器人 触发
    if (isRoom && room && content.replace(`${botName}`, '').trimStart().startsWith(`${autoReplyPrefix}`)) {
      const question =
        (await msg.mentionText()) || content.replace(`${botName}`, '').replace(`${autoReplyPrefix}`, '')
      console.log('🌸 group:', question)

      const ctxParts = [`[群聊: ${roomName} | 发送者: ${senderKey}]`]
      if (profileCtx) ctxParts.push(profileCtx)
      if (eventsCtx) ctxParts.push(eventsCtx)
      const ctx = ctxParts.join('\n') + '\n'

      const response = await getDeepseekReplyWithTools(ctx + question, BOT_TOOLS, toolHandler)
      await throttledSay(room, response)
      extractAndUpdateProfile(senderKey, question, response, roomName, dataDir).catch(() => { })
      return
    }

    // 私聊
    if (isAlias && !room && content.trimStart().startsWith(`${autoReplyPrefix}`)) {
      const question = content.replace(`${autoReplyPrefix}`, '')
      console.log('🌸 private:', question)

      const ctxParts = [`[私聊 | 发送者: ${senderKey}]`]
      if (profileCtx) ctxParts.push(profileCtx)
      const ctx = ctxParts.join('\n') + '\n'

      const response = await getDeepseekReplyWithTools(ctx + question, BOT_TOOLS, toolHandler)      await throttledSay(contact, response)
      extractAndUpdateProfile(senderKey, question, response, null, dataDir).catch(() => { })
    }
  } catch (e) {
    console.error('defaultMessage error:', e)
  }
}
