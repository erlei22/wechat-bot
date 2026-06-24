import fs from 'fs'
import path from 'path'
import Database from 'better-sqlite3'
import { logError } from './errorStore.js'

// ---------------------------------------------------------------------------
// Message schema（权威定义 v:1）
//
// messages 表:
//   id           TEXT  PRIMARY KEY       — wechaty message id
//   v            INT   DEFAULT 1         — schema 版本号，方便平滑迁移
//   ts           TEXT  NOT NULL          — ISO8601 写入时间，indexed
//   room_name    TEXT                    — NULL = 私聊；群名，indexed
//   talker_name  TEXT                    — 发言人微信名
//   talker_alias TEXT                    — 发言人备注名（通讯录里的昵称）
//   msg_type     INT   NOT NULL          — wechaty Message.Type 枚举值
//   type_name    TEXT                    — 类型可读名，如 Text / Image
//   source       TEXT  NOT NULL DEFAULT 'human'
//                                        — 'human' 真人发; 'self' 账号本人发;
//                                          'ai' 机器人 AI 回复; 'system' 系统消息
//   text         TEXT                    — 文本内容（非文本为空）
//
// 去掉的旧字段：isText(派生), isRoom(派生), receiverName(几乎空), self(→source)
// ---------------------------------------------------------------------------

const DB_VERSION = 1

let _dbMap = new Map() // dataDir → Database 实例

function getDb(dataDir = '.data/wechat') {
  if (_dbMap.has(dataDir)) return _dbMap.get(dataDir)
  const dbPath = path.resolve(process.cwd(), dataDir, 'messages.db')
  fs.mkdirSync(path.dirname(dbPath), { recursive: true })
  const db = new Database(dbPath)
  db.exec(`
    CREATE TABLE IF NOT EXISTS messages (
      id           TEXT    PRIMARY KEY,
      v            INTEGER NOT NULL DEFAULT ${DB_VERSION},
      ts           TEXT    NOT NULL,
      room_name    TEXT,
      talker_name  TEXT,
      talker_alias TEXT,
      msg_type     INTEGER NOT NULL,
      type_name    TEXT,
      source       TEXT    NOT NULL DEFAULT 'human',
      text         TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_msg_ts       ON messages(ts);
    CREATE INDEX IF NOT EXISTS idx_msg_room     ON messages(room_name);
    CREATE INDEX IF NOT EXISTS idx_msg_room_ts  ON messages(room_name, ts);
    CREATE INDEX IF NOT EXISTS idx_msg_talker   ON messages(talker_alias, talker_name);
    CREATE INDEX IF NOT EXISTS idx_msg_source   ON messages(source);
  `)
  _dbMap.set(dataDir, db)
  return db
}

// ---------------------------------------------------------------------------
// Write
// ---------------------------------------------------------------------------

export async function captureWechatMessage(message, bot, options = {}) {
  const dataDir = options.dataDir || '.data/wechat'
  if (options.storeMessages === false) return null

  try {
    const talker = message.talker()
    const room = message.room()
    const isText = message.type() === bot.Message.Type.Text
    const roomName = room ? await room.topic() : null

    // 群消息只记录白名单内的群，私聊不受限
    const roomWhiteList = options.roomWhiteList || []
    if (room && roomWhiteList.length > 0 && !roomWhiteList.includes(roomName)) return null

    const talkerAlias = talker ? await talker.alias() : ''
    const talkerName = talker ? await talker.name() : ''

    // 私聊只记录白名单内的人，群聊不受限
    const aliasWhiteList = options.aliasWhiteList || []
    if (!room && aliasWhiteList.length > 0 && !aliasWhiteList.includes(talkerAlias) && !aliasWhiteList.includes(talkerName)) return null

    const isSelf = Boolean(talker?.self?.())
    const msgType = message.type()
    const typeName = bot.Message.Type[msgType] || String(msgType)
    const text = isText ? message.text() : ''

    // 非文本消息（表情、图片、语音等）text 为空，没有存储价值，跳过
    if (!text.trim()) return null

    const record = {
      id: message.id || `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      v: DB_VERSION,
      ts: new Date().toISOString(),
      room_name: roomName || null,
      talker_name: talkerName,
      talker_alias: talkerAlias,
      msg_type: msgType,
      type_name: typeName,
      source: isSelf ? 'self' : 'human',
      text,
    }

    getDb(dataDir).prepare(`
      INSERT OR IGNORE INTO messages
        (id, v, ts, room_name, talker_name, talker_alias, msg_type, type_name, source, text)
      VALUES
        (@id, @v, @ts, @room_name, @talker_name, @talker_alias, @msg_type, @type_name, @source, @text)
    `).run(record)

    return toPublicRecord(record)
  } catch (e) {
    logError('captureWechatMessage', e, {}, options.dataDir || '.data/wechat')
    return null
  }
}

/**
 * 记录机器人 AI 回复（source: 'ai'），供复盘和训练数据使用。
 * 在 throttledSay 发送后异步调用，失败不影响主流程。
 */
export function logAiReply({ roomName, text, dataDir = '.data/wechat' }) {
  if (!text) return
  try {
    getDb(dataDir).prepare(`
      INSERT OR IGNORE INTO messages (id, v, ts, room_name, msg_type, type_name, source, text)
      VALUES (?, ?, ?, ?, 7, 'Text', 'ai', ?)
    `).run(
      `ai-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      DB_VERSION,
      new Date().toISOString(),
      roomName || null,
      text,
    )
  } catch (e) {
    logError('logAiReply', e, { roomName }, dataDir)
  }
}

// ---------------------------------------------------------------------------
// Read — 统一的公开字段形状（兼容旧代码和 wechatAnalyzer）
// ---------------------------------------------------------------------------

function toPublicRecord(row) {
  return {
    id: row.id,
    v: row.v ?? DB_VERSION,
    timestamp: row.ts,          // 兼容旧字段名
    roomName: row.room_name,   // 兼容旧字段名
    talkerName: row.talker_name,
    talkerAlias: row.talker_alias,
    type: row.msg_type,
    typeName: row.type_name,
    source: row.source ?? 'human',
    text: row.text ?? '',
  }
}

/**
 * 加载消息记录，支持 SQL 层过滤（高性能）。
 * @param {object} opts
 * @param {string} opts.dataDir
 * @param {number} opts.limit         — 最多返回条数（0 = 不限）
 * @param {string} opts.room          — 按群名过滤
 * @param {string} opts.friend        — 按 talkerAlias 或 talkerName 过滤
 * @param {string} opts.start         — 起始时间（ISO8601）
 * @param {string} opts.end           — 结束时间（ISO8601）
 * @param {string} opts.query         — 全文关键词（SQL LIKE）
 */
export function loadWechatMessages(opts = {}) {
  const dataDir = opts.dataDir || '.data/wechat'

  try {
    const conditions = []
    const params = {}

    if (opts.room) {
      conditions.push('room_name = @room')
      params.room = opts.room
    }
    if (opts.friend) {
      conditions.push('(talker_alias = @friend OR talker_name = @friend)')
      params.friend = opts.friend
    }
    if (opts.start) {
      conditions.push('ts >= @start')
      params.start = opts.start
    }
    if (opts.end) {
      conditions.push('ts <= @end')
      params.end = opts.end
    }
    if (opts.query) {
      conditions.push('LOWER(text) LIKE @query')
      params.query = `%${opts.query.toLowerCase()}%`
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
    const limit = Number(opts.limit || 0)
    const limitClause = limit > 0 ? `LIMIT ${limit}` : ''

    // 取最新的 N 条（降序取 N 再反转）
    const sql = limit > 0
      ? `SELECT * FROM (SELECT * FROM messages ${where} ORDER BY ts DESC ${limitClause}) ORDER BY ts ASC`
      : `SELECT * FROM messages ${where} ORDER BY ts ASC`

    const rows = getDb(dataDir).prepare(sql).all(params)
    return rows.map(toPublicRecord)
  } catch (e) {
    logError('loadWechatMessages', e, { opts }, dataDir)
    return []
  }
}

/** 内存过滤，保留给 wechatAnalyzer 的老调用路径（已推 SQL 层过滤后这里是 no-op 直通） */
export function filterWechatMessages(records, filters = {}) {
  const startTime = filters.start ? new Date(filters.start).getTime() : null
  const endTime = filters.end ? new Date(filters.end).getTime() : null
  const query = filters.query ? filters.query.toLowerCase() : ''

  return records.filter((record) => {
    if (filters.room && record.roomName !== filters.room) return false
    if (filters.friend) {
      const names = [record.talkerName, record.talkerAlias].filter(Boolean)
      if (!names.includes(filters.friend)) return false
    }
    if (query && !String(record.text || '').toLowerCase().includes(query)) return false
    if (startTime && new Date(record.timestamp).getTime() < startTime) return false
    if (endTime && new Date(record.timestamp).getTime() > endTime) return false
    return true
  })
}

// 暴露给 migrate 脚本
export { getDb, DB_VERSION }
