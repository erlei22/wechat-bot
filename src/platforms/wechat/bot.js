import { WechatyBuilder, ScanStatus, log } from 'wechaty'
import qrTerminal from 'qrcode-terminal'
import { defaultMessage } from '../../wechaty/sendMessage.js'
import { captureWechatMessage } from './messageStore.js'
import { getWechatRuntimeConfig } from '../../config/env.js'
import { extractFromPassiveMessage } from './profileStore.js'
import { extractEventFromMessage } from './eventStore.js'

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
        // 活动提取对群里所有人开放（不限白名单），但按群隔离
        extractEventFromMessage(message.text(), senderKey, roomName, config.dataDir).catch(() => { })
      }
    }
  })
  bot.on('error', (error) => {
    console.error('bot error handle: ', error)
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
