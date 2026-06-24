import dotenv from 'dotenv'
import { loadWhitelistConfig } from '../platforms/wechat/whitelistConfig.js'

const dotenvResult = dotenv.config()

export const env = {
  ...(dotenvResult.parsed || {}),
  ...process.env,
}

export function readCsvEnv(key) {
  return (env[key] || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

export function getWechatRuntimeConfig() {
  const dataDir = env.WECHAT_DATA_DIR || '.data/wechat'
  // 白名单与机器人昵称现在放在 config/whitelist.json，用数组管理更直观。
  // 文件不存在时，用旧的 .env 值做种子自动迁移一次。
  const whitelist = loadWhitelistConfig(dataDir, {
    botName: env.BOT_NAME || '',
    aliasWhiteList: readCsvEnv('ALIAS_WHITELIST'),
    roomWhiteList: readCsvEnv('ROOM_WHITELIST'),
  })
  return {
    botName: whitelist.botName || env.BOT_NAME || '',
    autoReplyPrefix: env.AUTO_REPLY_PREFIX || '',
    aliasWhiteList: whitelist.aliasWhiteList,
    roomWhiteList: whitelist.roomWhiteList,
    dataDir,
    storeMessages: env.WECHAT_STORE_MESSAGES !== 'false',
    commandPrefix: env.BOT_COMMAND_PREFIX || '/',
    enableRemoteOpenCli: env.ENABLE_REMOTE_OPENCLI === 'true',
    // 私聊是否启用 AI 自动回复。默认关闭：私聊只走管理指令，不触发 AI。
    privateChatAI: env.PRIVATE_CHAT_AI === 'true',
    // AI 回复前缀标记，让接收方能区分这是机器人而非真人。设为空串可关闭。
    aiReplyMarker: env.AI_REPLY_MARKER !== undefined ? env.AI_REPLY_MARKER : '🤖 ',
  }
}

export function getLarkRuntimeConfig() {
  return {
    bin: env.LARK_CLI_BIN || 'lark-cli',
    defaultIdentity: env.LARK_DEFAULT_IDENTITY || 'user',
  }
}

export function getOpenCliRuntimeConfig() {
  return {
    bin: env.OPENCLI_BIN || '',
    npmPackage: env.OPENCLI_NPM_PACKAGE || '@jackwener/opencli',
  }
}

export function getPiRuntimeConfig() {
  return {
    bin: env.PI_BIN || '',
    npmPackage: env.PI_NPM_PACKAGE || '@earendil-works/pi-coding-agent',
    agentArgs: env.PI_AGENT_ARGS || '--print --no-session',
  }
}
