/**
 * 一次性迁移：把旧的 messages.jsonl 灌入新的 messages.db（sqlite）。
 *
 * 用法：
 *   node src/platforms/wechat/migrate-messages.js [dataDir]
 *
 * dataDir 默认 .data/wechat。脚本幂等：用 INSERT OR IGNORE，重复执行不会丢数据。
 * 迁移完成后旧 jsonl 改名为 messages.jsonl.bak，不删除。
 */

import fs from 'fs'
import path from 'path'
import { getDb, DB_VERSION } from '../src/platforms/wechat/store/messageStore.js'

const dataDir = process.argv[2] || '.data/wechat'
const jsonlPath = path.resolve(process.cwd(), dataDir, 'messages.jsonl')

if (!fs.existsSync(jsonlPath)) {
  console.log(`找不到 ${jsonlPath}，无需迁移。`)
  process.exit(0)
}

const lines = fs.readFileSync(jsonlPath, 'utf8').split('\n').map(l => l.trim()).filter(Boolean)
console.log(`读取到 ${lines.length} 条旧记录，开始迁移...`)

const db = getDb(dataDir)
const insert = db.prepare(`
  INSERT OR IGNORE INTO messages
    (id, v, ts, room_name, talker_name, talker_alias, msg_type, type_name, source, text)
  VALUES
    (@id, @v, @ts, @room_name, @talker_name, @talker_alias, @msg_type, @type_name, @source, @text)
`)

let ok = 0, skip = 0, fail = 0

const migrate = db.transaction((rows) => {
  for (const line of rows) {
    try {
      const old = JSON.parse(line)
      insert.run({
        id: old.id || `migrated-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        v: DB_VERSION,
        ts: old.timestamp || new Date().toISOString(),
        room_name: old.roomName || old.isRoom ? (old.roomName || null) : null,
        talker_name: old.talkerName || '',
        talker_alias: old.talkerAlias || '',
        msg_type: old.type ?? 0,
        type_name: old.typeName || '',
        // 旧 self:true 对应账号自己发；false 对应他人发
        source: old.self ? 'self' : 'human',
        text: old.text || '',
      })
      ok++
    } catch (e) {
      fail++
      if (fail <= 5) console.warn('  跳过行:', e.message)
    }
  }
})

migrate(lines)
console.log(`迁移完成：成功 ${ok} 条，失败 ${fail} 条`)

// 备份旧文件，不删除
const bakPath = jsonlPath + '.bak'
fs.renameSync(jsonlPath, bakPath)
console.log(`旧文件已备份到 ${bakPath}`)
console.log('✅ 迁移完成，下次重启 bot 将自动使用 messages.db')
