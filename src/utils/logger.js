/**
 * 结构化日志工具
 *
 * 通过 .env 控制行为：
 *   LOG_LEVEL=debug   — 详细日志：所有判断条件、AI 入参出参，用于排查不回复等问题
 *   LOG_LEVEL=info    — 默认：关键事件（消息到达、回复发出、错误）
 *   LOG_LEVEL=warn    — 只打警告和错误
 *   LOG_LEVEL=error   — 只打错误
 *
 *   LOG_FILE=true     — 同时写入 logs/bot-YYYY-MM-DD.log（文件无颜色码，随时可删）
 *   LOG_FILE=false    — 默认，只打控制台
 *
 * logs/ 目录已加入 .gitignore，删掉整个目录不影响功能。
 */

import fs from 'fs'
import path from 'path'
import dotenv from 'dotenv'

const env = { ...dotenv.config().parsed, ...process.env }

// ---------------------------------------------------------------------------
// 级别配置
// ---------------------------------------------------------------------------
const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 }
const current = LEVELS[env.LOG_LEVEL?.toLowerCase()] ?? LEVELS.info

const COLORS = {
  debug: '\x1b[36m',  // cyan
  info: '\x1b[32m',  // green
  warn: '\x1b[33m',  // yellow
  error: '\x1b[31m',  // red
  reset: '\x1b[0m',
}

// ---------------------------------------------------------------------------
// 文件写入（可选）
// ---------------------------------------------------------------------------
const fileEnabled = env.LOG_FILE === 'true'
const logDir = path.resolve(process.cwd(), 'logs')
let _logFileStream = null

function getLogStream() {
  if (!fileEnabled) return null
  if (_logFileStream) return _logFileStream
  fs.mkdirSync(logDir, { recursive: true })
  const date = new Date().toLocaleDateString('sv') // YYYY-MM-DD
  const logPath = path.join(logDir, `bot-${date}.log`)
  _logFileStream = fs.createWriteStream(logPath, { flags: 'a', encoding: 'utf8' })
  return _logFileStream
}

// 每日零点自动切换日志文件
function resetStreamAtMidnight() {
  const now = new Date()
  const ms = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1) - now
  setTimeout(() => {
    _logFileStream?.end()
    _logFileStream = null
    resetStreamAtMidnight()
  }, ms)
}
if (fileEnabled) resetStreamAtMidnight()

// ---------------------------------------------------------------------------
// 格式化
// ---------------------------------------------------------------------------
function ts() {
  return new Date().toLocaleTimeString('zh-CN', { hour12: false })
}

function serialize(data) {
  if (data === undefined) return ''
  if (data instanceof Error) return (data.stack || data.message)
  if (typeof data === 'object') return JSON.stringify(data)
  return String(data)
}

function write(level, label, data) {
  if (LEVELS[level] > current) return

  const timeStr = ts()
  const dataStr = serialize(data)
  const plain = `[${timeStr}][${level.toUpperCase()}] ${label}${dataStr ? ' ' + dataStr : ''}`

  // 控制台：带颜色
  const colored = `${COLORS[level]}${plain}${COLORS.reset}`
  if (level === 'error') console.error(colored)
  else if (level === 'warn') console.warn(colored)
  else console.log(colored)

  // 文件：纯文本，无颜色码
  getLogStream()?.write(plain + '\n')
}

// ---------------------------------------------------------------------------
// 导出
// ---------------------------------------------------------------------------
export const logger = {
  debug: (label, data) => write('debug', label, data),
  info: (label, data) => write('info', label, data),
  warn: (label, data) => write('warn', label, data),
  error: (label, data) => write('error', label, data),
  isDebug: () => current >= LEVELS.debug,
}
