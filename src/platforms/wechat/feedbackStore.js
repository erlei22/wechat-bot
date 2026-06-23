import Database from 'better-sqlite3'
import path from 'path'
import fs from 'fs'

// ---------------------------------------------------------------------------
// DB init — singleton connection
// ---------------------------------------------------------------------------

let _db = null

function getDb(dataDir = '.data/wechat') {
  if (_db) return _db
  const dbPath = path.resolve(process.cwd(), dataDir, 'feedback.db')
  fs.mkdirSync(path.dirname(dbPath), { recursive: true })
  _db = new Database(dbPath)
  _db.exec(`
    CREATE TABLE IF NOT EXISTS feedback (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      sender     TEXT    NOT NULL,
      room       TEXT,
      content    TEXT    NOT NULL,
      status     TEXT    NOT NULL DEFAULT 'pending',
      created_at TEXT    NOT NULL DEFAULT (datetime('now', 'localtime')),
      updated_at TEXT    NOT NULL DEFAULT (datetime('now', 'localtime'))
    );
    CREATE INDEX IF NOT EXISTS idx_status  ON feedback(status);
    CREATE INDEX IF NOT EXISTS idx_created ON feedback(created_at);
    CREATE INDEX IF NOT EXISTS idx_room    ON feedback(room);
  `)
  return _db
}

// ---------------------------------------------------------------------------
// Write
// ---------------------------------------------------------------------------

export function saveFeedback({ sender, room, content }, dataDir = '.data/wechat') {
  const db = getDb(dataDir)
  const result = db
    .prepare('INSERT INTO feedback (sender, room, content) VALUES (?, ?, ?)')
    .run(sender, room || null, content)
  console.log(`💬 反馈已记录 #${result.lastInsertRowid} from ${sender}`)
  return result.lastInsertRowid
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

export function listFeedback({ status, room, limit = 20, offset = 0 } = {}, dataDir = '.data/wechat') {
  const db = getDb(dataDir)
  const conditions = []
  const params = []
  if (status) { conditions.push('status = ?'); params.push(status) }
  if (room) { conditions.push('room = ?'); params.push(room) }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
  params.push(limit, offset)
  return db.prepare(`SELECT * FROM feedback ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`).all(...params)
}

export function countFeedback({ status, room } = {}, dataDir = '.data/wechat') {
  const db = getDb(dataDir)
  const conditions = []
  const params = []
  if (status) { conditions.push('status = ?'); params.push(status) }
  if (room) { conditions.push('room = ?'); params.push(room) }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
  return db.prepare(`SELECT COUNT(*) as n FROM feedback ${where}`).get(...params).n
}

// ---------------------------------------------------------------------------
// Update
// ---------------------------------------------------------------------------

const VALID_STATUS = ['pending', 'reviewed', 'done', 'dismissed']

export function updateFeedbackStatus(id, status, dataDir = '.data/wechat') {
  if (!VALID_STATUS.includes(status)) return false
  const db = getDb(dataDir)
  const result = db
    .prepare("UPDATE feedback SET status = ?, updated_at = datetime('now', 'localtime') WHERE id = ?")
    .run(status, id)
  return result.changes > 0
}

// ---------------------------------------------------------------------------
// Format
// ---------------------------------------------------------------------------

const STATUS_LABEL = {
  pending: '⏳ 待处理',
  reviewed: '👀 已查看',
  done: '✅ 已处理',
  dismissed: '🚫 已忽略',
}

export function formatFeedbackList(rows) {
  if (!rows.length) return '暂无反馈记录'
  return rows.map((r) => [
    `#${r.id} [${STATUS_LABEL[r.status] || r.status}] ${r.created_at.slice(0, 16)}`,
    `来自: ${r.sender}${r.room ? ' @ ' + r.room : ''}`,
    `内容: ${r.content}`,
  ].join('\n')).join('\n─────\n')
}
