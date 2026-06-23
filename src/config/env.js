import dotenv from 'dotenv'

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
  return {
    botName: env.BOT_NAME || '',
    autoReplyPrefix: env.AUTO_REPLY_PREFIX || '',
    aliasWhiteList: readCsvEnv('ALIAS_WHITELIST'),
    roomWhiteList: readCsvEnv('ROOM_WHITELIST'),
    dataDir: env.WECHAT_DATA_DIR || '.data/wechat',
    storeMessages: env.WECHAT_STORE_MESSAGES !== 'false',
    commandPrefix: env.BOT_COMMAND_PREFIX || '/',
    enableRemoteOpenCli: env.ENABLE_REMOTE_OPENCLI === 'true',
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
