import { WechatyBuilder, ScanStatus, log } from 'wechaty'
import qrTerminal from 'qrcode-terminal'
import { defaultMessage } from './sendMessage.js'
import { captureWechatMessage } from './store/messageStore.js'
import { getWechatRuntimeConfig } from '../../config/env.js'
import { extractFromPassiveMessage } from './store/profileStore.js'
import { processEventMessage } from './lifecycle/eventLifecycle.js'
import { throttledSay } from '../../utils/replyQueue.js'
import { logger } from '../../utils/logger.js'
import { logError } from './store/errorStore.js'

function onScan(qrcode, status) {
  if (status === ScanStatus.Waiting || status === ScanStatus.Timeout) {
    qrTerminal.generate(qrcode, { small: true })
    const qrcodeImageUrl = ['https://api.qrserver.com/v1/create-qr-code/?data=', encodeURIComponent(qrcode)].join('')
    console.log('onScan:', qrcodeImageUrl, ScanStatus[status], status)
  } else {
    log.info('onScan: %s(%s)', ScanStatus[status], status)
  }
}

function onLogin(user) {
  console.log(`${user} has logged in`)
  const date = new Date()
  console.log(`Current time:${date}`)
  console.log('Automatic robot chat mode has been activated')
}

function onLogout(user) {
  console.log(`${user} has logged out`)
}

async function onFriendShip(friendship) {
  const friendShipRe = /chatgpt|chat/
  if (friendship.type() === 2 && friendShipRe.test(friendship.hello())) {
    await friendship.accept()
  }
}

export function createWechatBot() {
  const config = getWechatRuntimeConfig()
  const chromeBin = process.env.CHROME_BIN ? { endpoint: process.env.CHROME_BIN } : {}

  const bot = WechatyBuilder.build({
    name: 'WechatEveryDay',
    puppet: 'wechaty-puppet-wechat4u',
    puppetOptions: {
      uos: true,
      ...chromeBin,
    },
  })

  bot.on('scan', onScan)
  bot.on('login', onLogin)
  bot.on('logout', onLogout)
  bot.on('friendship', onFriendShip)
  bot.on('message', async (message) => {
    await captureWechatMessage(message, bot, {
      dataDir: config.dataDir,
      storeMessages: config.storeMessages,
      roomWhiteList: config.roomWhiteList,
      aliasWhiteList: config.aliasWhiteList,
    })

    // 主动：@机器人的消息，回复并更新画像
    await defaultMessage(message, bot)

    // 被动：白名单群里的日常发言，静默观察建立画像
    // 必须同时满足：群在 ROOM_WHITELIST，发言人在 ALIAS_WHITELIST，不@机器人
    const isText = message.type() === bot.Message.Type.Text
    const isSelf = message.talker().self()
    const room = message.room()
    if (isText && !isSelf && room) {
      const roomName = await room.topic()
      const mentionsBot = message.text().includes(config.botName)
      if (config.roomWhiteList.includes(roomName) && !mentionsBot) {
        const talker = message.talker()
        const talkerAlias = await talker.alias()
        const talkerName = await talker.name()
        const senderKey = talkerAlias || talkerName
        // 只观察 ALIAS_WHITELIST 里的人
        if (config.aliasWhiteList.includes(talkerAlias) || config.aliasWhiteList.includes(talkerName)) {
          extractFromPassiveMessage(senderKey, message.text(), roomName, config.dataDir).catch(() => { })
        }
        // 活动生命周期：创建二次确认 / 仅发起者可改删 / 报名引导找发起者。
        // 对群里所有人开放（不限白名单），按群隔离。机器人需要回复时发到群里并 @ 发言人。
        processEventMessage({ text: message.text(), senderKey, roomName, dataDir: config.dataDir })
          .then((reply) => {
            if (!reply) return
            const marked = config.aiReplyMarker ? `${config.aiReplyMarker}${reply}` : reply
            return throttledSay(room, marked, [talker])
          })
          .catch(() => { })
      }
    }
  })
  bot.on('error', (error) => {
    // wechat4u 内部偶发错误（如登录初始化时 status undefined），不影响后续运行，降级为 warn
    const msg = error?.message || String(error)
    if (msg.includes('Cannot read properties of undefined')) {
      logger.warn('[BOT] 协议层内部错误（已忽略）', msg)
    } else {
      logger.error('[BOT] error', error)
      logError('bot', error, {}, config.dataDir)
    }
  })

  return bot
}

export function startWechatBot(options = {}) {
  const bot = createWechatBot(options)
  bot
    .start()
    .then(() => console.log('Start to log in wechat...'))
    .catch((error) => console.error('botStart error: ', error))

  return bot
}
