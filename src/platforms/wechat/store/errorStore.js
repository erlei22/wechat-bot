import Database from 'better-sqlite3'
import path from 'path'
import fs from 'fs'

// ---------------------------------------------------------------------------
// 错误日志存储
// 记录运行期捕获到的异常，方便事后排查 bug。
// 与 feedbackStore 一样使用 sqlite，单例连接。
// ---------------------------------------------------------------------------

let _db = null

function getDb(dataDir = '.data/wechat') {
  if (_db) return _db
  const dbPath = path.resolve(process.cwd(), dataDir, 'errors.db')
  fs.mkdirSync(path.dirname(dbPath), { recursive: true })
  _db = new Database(dbPath)
  _db.exec(`
    CREATE TABLE IF NOT EXISTS error_log (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      scope      TEXT    NOT NULL,
      message    TEXT    NOT NULL,
      stack      TEXT,
      context    TEXT,
      created_at TEXT    NOT NULL DEFAULT (datetime('now', 'localtime'))
    );
    CREATE INDEX IF NOT EXISTS idx_err_scope   ON error_log(scope);
    CREATE INDEX IF NOT EXISTS idx_err_created ON error_log(created_at);
  `)
  return _db
}

// ---------------------------------------------------------------------------
// Write
// ---------------------------------------------------------------------------

/**
 * 记录一条错误日志。永不抛出——日志失败不应影响主流程。
 * @param {string} scope   出错的模块/位置，如 'defaultMessage'、'extractEventFromMessage'
 * @param {Error|string} error  错误对象或文本
 * @param {object} [context]    额外上下文（房间、发送者、原始消息等），会被 JSON 序列化
 */
export function logError(scope, error, context = null, dataDir = '.data/wechat') {
  try {
    const message = error instanceof Error ? error.message : String(error)
    const stack = error instanceof Error ? error.stack : null
    const ctxStr = context ? JSON.stringify(context) : null
    const db = getDb(dataDir)
    const result = db
      .prepare('INSERT INTO error_log (scope, message, stack, context) VALUES (?, ?, ?, ?)')
      .run(scope, message, stack, ctxStr)
    console.error(`🐞 错误已记录 #${result.lastInsertRowid} [${scope}]: ${message}`)
    return result.lastInsertRowid
  } catch (e) {
    // 最后兜底：连写日志都失败，只打印，绝不抛出
    console.error('logError 自身失败:', e.message)
    console.error('原始错误:', error)
    return null
  }
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

export function listErrors({ scope, limit = 20, offset = 0 } = {}, dataDir = '.data/wechat') {
  const db = getDb(dataDir)
  const conditions = []
  const params = []
  if (scope) { conditions.push('scope = ?'); params.push(scope) }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
  params.push(limit, offset)
  return db.prepare(`SELECT * FROM error_log ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`).all(...params)
}

export function countErrors({ scope } = {}, dataDir = '.data/wechat') {
  const db = getDb(dataDir)
  const conditions = []
  const params = []
  if (scope) { conditions.push('scope = ?'); params.push(scope) }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
  return db.prepare(`SELECT COUNT(*) as n FROM error_log ${where}`).get(...params).n
}

/** 清空全部错误日志，返回删除条数。 */
export function clearErrors(dataDir = '.data/wechat') {
  const db = getDb(dataDir)
  const result = db.prepare('DELETE FROM error_log').run()
  return result.changes
}

// ---------------------------------------------------------------------------
// Format
// ---------------------------------------------------------------------------

export function formatErrorList(rows) {
  if (!rows.length) return '暂无错误日志 🎉'
  return rows
    .map((r) => {
      const lines = [
        `#${r.id} [${r.scope}] ${r.created_at.slice(0, 16)}`,
        `信息: ${r.message}`,
      ]
      if (r.context) lines.push(`上下文: ${r.context}`)
      return lines.join('\n')
    })
    .join('\n─────\n')
}
