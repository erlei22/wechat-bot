/**
 * 验证 query 意图：有活动→播报，无活动→不插话(null)
 * node tests/event-query.mjs
 */
import { applyEventIntent } from '../src/platforms/wechat/lifecycle/eventLifecycle.js'
import fs from 'fs'

const dataDir = '.data/test-eventquery'
const room = '测试群'
fs.rmSync(dataDir, { recursive: true, force: true })
fs.mkdirSync(`${dataDir}/events`, { recursive: true })

let pass = 0, fail = 0
const check = (l, c) => { if (c) { pass++; console.log('OK  ', l) } else { fail++; console.log('FAIL', l) } }

// 无活动 → query 返回 null（不主动插话）
const r1 = applyEventIntent({ action: 'query' }, { senderKey: '甲', roomName: room, dataDir })
check('无活动时 query 不插话(null)', r1 === null)

// 造一个活动文件（未来日期）
const future = new Date(Date.now() + 3 * 864e5).toISOString().slice(0, 10)
fs.writeFileSync(`${dataDir}/events/${room}.json`, JSON.stringify([{
  id: '1', title: '周末爬山', type: '徒步', date: future, time: '08:00', location: '佘山',
  initiator: '麻薯', participants: ['麻薯'], status: 'upcoming', room,
}]))

const r2 = applyEventIntent({ action: 'query' }, { senderKey: '甲', roomName: room, dataDir })
check('有活动时 query 返回播报', typeof r2 === 'string' && r2.includes('周末爬山'))
console.log('  播报内容:', r2?.split('\n')[0])

fs.rmSync(dataDir, { recursive: true, force: true })
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
