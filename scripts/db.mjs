/**
 * SQLite 数据库管理脚本
 *
 * 用法：
 *   node scripts/db.mjs <db> <sql>
 *   node scripts/db.mjs <db> --file <sql文件>
 *
 * db 可以是：
 *   messages   → .data/wechat/messages.db
 *   errors     → .data/wechat/errors.db
 *   feedback   → .data/wechat/feedback.db
 *   <文件路径>  → 直接指定路径，如 .data/wechat/messages.db
 *
 * 示例：
 *   # 清空空文本消息
 *   node scripts/db.mjs messages "DELETE FROM messages WHERE text = '' OR text IS NULL"
 *
 *   # 查看最近20条消息
 *   node scripts/db.mjs messages "SELECT ts, room_name, talker_alias, text FROM messages ORDER BY ts DESC LIMIT 20"
 *
 *   # 统计各群消息数
 *   node scripts/db.mjs messages "SELECT room_name, COUNT(*) as cnt FROM messages GROUP BY room_name ORDER BY cnt DESC"
 *
 *   # 查看错误日志
 *   node scripts/db.mjs errors "SELECT * FROM error_log ORDER BY created_at DESC LIMIT 20"
 *
 *   # 执行 sql 文件
 *   node scripts/db.mjs messages --file scripts/sql/cleanup.sql
 */

import Database from 'better-sqlite3'
import fs from 'fs'
import path from 'path'
import readline from 'readline'

const DATA_DIR = '.data/wechat'

const DB_ALIASES = {
  messages: path.join(DATA_DIR, 'messages.db'),
  feedback: path.join(DATA_DIR, 'feedback.db'),
}

// ── 解析参数 ─────────────────────────────────────────────────────────────────
const [, , dbArg, ...rest] = process.argv

if (!dbArg) {
  console.log(`用法：node scripts/db.mjs <db> <sql>`)
  console.log(`      node scripts/db.mjs <db> --file <sql文件>`)
  console.log(`\n可用 db 别名：${Object.keys(DB_ALIASES).join(', ')}`)
  console.log(`\n常用示例：`)
  console.log(`  node scripts/db.mjs messages "SELECT COUNT(*) FROM messages"`)
  console.log(`  node scripts/db.mjs messages "DELETE FROM messages WHERE text = '' OR text IS NULL"`)
  console.log(`  node scripts/db.mjs errors   "SELECT * FROM error_log ORDER BY created_at DESC LIMIT 10"`)
  process.exit(0)
}

const dbPath = path.resolve(process.cwd(), DB_ALIASES[dbArg] ?? dbArg)
if (!fs.existsSync(dbPath)) {
  console.error(`找不到数据库文件: ${dbPath}`)
  process.exit(1)
}

let sql
if (rest[0] === '--file') {
  const sqlFile = rest[1]
  if (!sqlFile || !fs.existsSync(sqlFile)) {
    console.error(`找不到 SQL 文件: ${sqlFile}`)
    process.exit(1)
  }
  sql = fs.readFileSync(sqlFile, 'utf8')
} else {
  sql = rest.join(' ').trim()
}

// ── 交互模式（不带 SQL 参数时） ───────────────────────────────────────────────
async function interactiveMode(db) {
  console.log(`已连接：${dbPath}`)
  console.log('输入 SQL 回车执行，输入 .exit 退出，输入 .tables 查看所有表\n')
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: 'sql> ' })
  rl.prompt()
  rl.on('line', (line) => {
    const input = line.trim()
    if (!input) { rl.prompt(); return }
    if (input === '.exit' || input === '.quit') { rl.close(); return }
    if (input === '.tables') {
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all()
      console.log(tables.map(t => t.name).join('\n'))
      rl.prompt(); return
    }
    runSql(db, input)
    rl.prompt()
  })
  rl.on('close', () => process.exit(0))
}

// ── 执行 SQL ─────────────────────────────────────────────────────────────────
function runSql(db, sqlStr) {
  // 支持多条语句（用 ; 分隔），逐条执行
  const statements = sqlStr.split(';').map(s => s.trim()).filter(Boolean)
  for (const stmt of statements) {
    const upper = stmt.toUpperCase()
    try {
      if (upper.startsWith('SELECT') || upper.startsWith('PRAGMA') || upper.startsWith('EXPLAIN')) {
        const rows = db.prepare(stmt).all()
        if (!rows.length) { console.log('（无结果）'); continue }
        // 表格输出
        const cols = Object.keys(rows[0])
        const widths = cols.map(c => Math.max(c.length, ...rows.map(r => String(r[c] ?? '').slice(0, 60).length)))
        const hr = widths.map(w => '-'.repeat(w + 2)).join('+')
        console.log(hr)
        console.log(cols.map((c, i) => ` ${c.padEnd(widths[i])} `).join('|'))
        console.log(hr)
        for (const row of rows) {
          console.log(cols.map((c, i) => ` ${String(row[c] ?? '').slice(0, 60).padEnd(widths[i])} `).join('|'))
        }
        console.log(hr)
        console.log(`${rows.length} 行`)
      } else {
        const info = db.prepare(stmt).run()
        console.log(`✅ 执行成功，影响 ${info.changes} 行`)
      }
    } catch (e) {
      console.error(`❌ 执行失败: ${e.message}`)
    }
  }
}

// ── 主流程 ────────────────────────────────────────────────────────────────────
const db = new Database(dbPath)

if (!sql) {
  await interactiveMode(db)
} else {
  runSql(db, sql)
}
