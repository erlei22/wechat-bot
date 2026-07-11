/**
 * messageStore 最小验证：sqlite 写入、群过滤、关键词、limit、source 字段
 * 用法：node tests/messageStore.mjs
 */
import fs from 'fs'
import * as m from '../src/platforms/wechat/messageStore.js'

const dir = '.data/test-msgstore'
fs.rmSync(dir, { recursive: true, force: true })

m.logAiReply({ roomName: '测试群', text: '这是 AI 回复', dataDir: dir })
m.logAiReply({ roomName: '测试群', text: 'AI 的第二条', dataDir: dir })
m.logAiReply({ roomName: '另一个群', text: '另一群 AI', dataDir: dir })

const all = m.loadWechatMessages({ dataDir: dir })
console.assert(all.length === 3, `全量应为 3 条，实为 ${all.length}`)

const byRoom = m.loadWechatMessages({ dataDir: dir, room: '测试群' })
console.assert(byRoom.length === 2, `测试群应为 2 条，实为 ${byRoom.length}`)

const byQuery = m.loadWechatMessages({ dataDir: dir, query: '第二条' })
console.assert(byQuery.length === 1, `关键词应为 1 条，实为 ${byQuery.length}`)

const limited = m.loadWechatMessages({ dataDir: dir, limit: 2 })
console.assert(limited.length === 2, `limit=2 应为 2 条，实为 ${limited.length}`)

console.assert(byRoom[0].source === 'ai', `source 应为 ai，实为 ${byRoom[0].source}`)
console.assert(byRoom[0].typeName === 'Text', `typeName 应为 Text`)
console.assert(byRoom[0].roomName === '测试群', `roomName 应为 测试群`)

const filtered = m.filterWechatMessages(all, { room: '测试群' })
console.assert(filtered.length === 2, `filterWechatMessages 应为 2，实为 ${filtered.length}`)

fs.rmSync(dir, { recursive: true, force: true })
console.log('messageStore: ALL PASS')
