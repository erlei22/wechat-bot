import fs from 'fs'
import path from 'path'

// ---------------------------------------------------------------------------
// 错误日志（文件版，append-only JSONL）
//
// 故意不用 sqlite：错误日志就是"记下来事后翻"，不需要数据库/索引/状态工作流。
// 写到 logs/errors.jsonl，可直接 grep/tail，也随时可删（logs/ 已 gitignore）。
// /错误 命令读文件尾部即可在微信里查看。
//
// logError 签名保持不变（scope, error, context, dataDir），所有调用方无需改动。
// dataDir 参数保留兼容，但错误统一落到 logs/ 下。
// ---------------------------------------------------------------------------

const LOG_DIR = path.resolve(process.cwd(), 'logs')
const ERROR_LOG = path.join(LOG_DIR, 'errors.jsonl')

/**
 * 记录一条错误。永不抛出——日志失败不应影响主流程。
 * @param {string} scope          出错的模块/位置，如 'defaultMessage'
 * @param {Error|string} error    错误对象或文本
 * @param {object} [context]      额外上下文，会随行写入
 */
export function logError(scope, error, context = null) {
  try {
    const entry = {
      ts: new Date().toISOString(),
      scope,
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      context: context || undefined,
    }
    fs.mkdirSync(LOG_DIR, { recursive: true })
    fs.appendFileSync(ERROR_LOG, JSON.stringify(entry) + '\n', 'utf8')
    console.error(`🐞 [${scope}] ${entry.message}`)
  } catch (e) {
    // 最后兜底：连写日志都失败，只打印，绝不抛出
    console.error('logError 自身失败:', e.message)
    console.error('原始错误:', error)
  }
}

// ---------------------------------------------------------------------------
// Read（供 /错误 命令）
// ---------------------------------------------------------------------------

function readEntries() {
  try {
    if (!fs.existsSync(ERROR_LOG)) return []
    return fs
      .readFileSync(ERROR_LOG, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((l) => {
        try {
          return JSON.parse(l)
        } catch {
          return null
        }
      })
      .filter(Boolean)
  } catch {
    return []
  }
}

/** 最近的错误（默认 10 条，按时间倒序）。可按 scope 过滤。 */
export function listErrors({ scope, limit = 10 } = {}) {
  let all = readEntries()
  if (scope) all = all.filter((e) => e.scope === scope)
  return all.slice(-limit).reverse()
}

export function countErrors({ scope } = {}) {
  let all = readEntries()
  if (scope) all = all.filter((e) => e.scope === scope)
  return all.length
}

/** 清空错误日志，返回清掉的条数。 */
export function clearErrors() {
  try {
    const n = readEntries().length
    if (fs.existsSync(ERROR_LOG)) fs.unlinkSync(ERROR_LOG)
    return n
  } catch {
    return 0
  }
}

export function formatErrorList(rows) {
  if (!rows.length) return '暂无错误日志 🎉'
  return rows
    .map((r) => {
      const lines = [
        `[${r.scope}] ${(r.ts || '').slice(0, 16).replace('T', ' ')}`,
        `信息: ${r.message}`,
      ]
      if (r.context) lines.push(`上下文: ${JSON.stringify(r.context)}`)
      return lines.join('\n')
    })
    .join('\n─────\n')
}
