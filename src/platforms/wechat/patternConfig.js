import fs from 'fs'
import path from 'path'

const CONFIG_FILE = 'config/injection-patterns.json'

// 默认模式——只用于初始化配置文件，之后从文件读取
const DEFAULT_PATTERNS = [
  'ignore.*previous',
  'you are now',
  'forget everything',
  'new (instruction|rule|persona|role|system)',
  '从现在起|忘记之前|你现在是|新的指令|系统提示|忽略上面',
  '\\[.*(system|prompt|instruction).*?\\]',
  'act as|pretend|roleplay',
]

const DEFAULT_CONFIG = {
  version: 1,
  updatedAt: new Date().toISOString(),
  note: '每条 pattern 是一个 JS 正则字符串（不含 / /），忽略大小写。可通过 /patterns add 指令追加，无需重启。',
  patterns: DEFAULT_PATTERNS,
}

// ---------------------------------------------------------------------------
// Load / Save
// ---------------------------------------------------------------------------

function getConfigPath(dataDir = '.data/wechat') {
  return path.resolve(process.cwd(), dataDir, CONFIG_FILE)
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true })
}

export function loadPatternConfig(dataDir = '.data/wechat') {
  const configPath = getConfigPath(dataDir)
  if (!fs.existsSync(configPath)) {
    // 首次运行，写入默认配置
    ensureDir(path.dirname(configPath))
    fs.writeFileSync(configPath, JSON.stringify(DEFAULT_CONFIG, null, 2), 'utf8')
    return DEFAULT_CONFIG
  }
  try {
    return JSON.parse(fs.readFileSync(configPath, 'utf8'))
  } catch {
    return DEFAULT_CONFIG
  }
}

export function savePatternConfig(config, dataDir = '.data/wechat') {
  const configPath = getConfigPath(dataDir)
  ensureDir(path.dirname(configPath))
  config.updatedAt = new Date().toISOString()
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8')
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

/**
 * Add a new pattern string to the config file.
 * Returns false if it already exists.
 */
export function addPattern(patternStr, dataDir = '.data/wechat') {
  const config = loadPatternConfig(dataDir)
  if (config.patterns.includes(patternStr)) return false
  config.patterns.push(patternStr)
  savePatternConfig(config, dataDir)
  return true
}

/**
 * Remove a pattern by index (0-based).
 * Returns the removed pattern string, or null if out of range.
 */
export function removePattern(index, dataDir = '.data/wechat') {
  const config = loadPatternConfig(dataDir)
  if (index < 0 || index >= config.patterns.length) return null
  const [removed] = config.patterns.splice(index, 1)
  savePatternConfig(config, dataDir)
  return removed
}

/**
 * Compile all patterns into RegExp objects for matching.
 * Invalid patterns are skipped with a warning.
 */
export function compilePatterns(dataDir = '.data/wechat') {
  const { patterns } = loadPatternConfig(dataDir)
  return patterns
    .map((p) => {
      try {
        return new RegExp(p, 'i')
      } catch (e) {
        console.warn(`patternConfig: 无效的正则 "${p}"，已跳过`)
        return null
      }
    })
    .filter(Boolean)
}
