import fs from 'fs'
import path from 'path'

const CONFIG_FILE = 'config/whitelist.json'

const DEFAULT_CONFIG = {
  version: 1,
  updatedAt: new Date().toISOString(),
  note: '白名单配置。botName: 机器人昵称（群聊里需 @ 这个名字才触发）；aliasWhiteList: 允许私聊的好友备注或昵称；roomWhiteList: 允许接入的群名。修改后重启生效。',
  botName: '',
  aliasWhiteList: [],
  roomWhiteList: [],
}

function getConfigPath(dataDir = '.data/wechat') {
  return path.resolve(process.cwd(), dataDir, CONFIG_FILE)
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true })
}

/**
 * Load whitelist config from JSON file.
 * On first run, seeds the file from `seed` (e.g. legacy env CSV values) so
 * existing setups keep working without manual migration.
 */
export function loadWhitelistConfig(dataDir = '.data/wechat', seed = {}) {
  const configPath = getConfigPath(dataDir)
  if (!fs.existsSync(configPath)) {
    const config = { ...DEFAULT_CONFIG, ...seed, updatedAt: new Date().toISOString() }
    ensureDir(path.dirname(configPath))
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8')
    return config
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(configPath, 'utf8'))
    return {
      botName: parsed.botName || '',
      aliasWhiteList: Array.isArray(parsed.aliasWhiteList) ? parsed.aliasWhiteList : [],
      roomWhiteList: Array.isArray(parsed.roomWhiteList) ? parsed.roomWhiteList : [],
    }
  } catch {
    return { ...DEFAULT_CONFIG, ...seed }
  }
}
