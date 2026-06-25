/**
 * 验证发起者维护名单 + query 播报名单 + 权限
 * node tests/event-roster.mjs
 */
import { applyEventIntent, processEventMessage, isConfirm } from '../src/platforms/wechat/lifecycle/eventLifecycle.js'
import { loadGroupEvents } from '../src/platforms/wechat/store/eventStore.js'
import fs from 'fs'

const dataDir = '.data/test-roster'
const room = '测试群'
fs.rmSync(dataDir, { recursive: true, force: true })
fs.mkdirSync(`${dataDir}/events`, { recursive: true })

let pass = 0, fail = 0
const check = (l, c) => { if (c) { pass++; console.log('OK  ', l) } else { fail++; console.log('FAIL', l) } }

const future = new Date(Date.now() + 3 * 864e5).toISOString().slice(0, 10)
fs.writeFileSync(`${dataDir}/events/${room}.json`, JSON.stringify([{
  id: 'e1', title: '周末爬山', type: '徒步', date: future, time: '08:00', location: '佘山',
  initiator: '麻薯', participants: ['麻薯'], status: 'upcoming', room,
}]))

// 发起者加人（participants 走 mergeEvent 追加）
const r1 = applyEventIntent({ action: 'update', targetId: 'e1', event: { participants: ['大林', '八爷'] } }, { senderKey: '麻薯', roomName: room, dataDir })
check('发起者加人成功', loadGroupEvents(room, dataDir)[0].participants.join() === '麻薯,大林,八爷')
check('回复含名单', r1.includes('名单') && r1.includes('大林'))

// 非发起者改名单 → 拒绝
const r2 = applyEventIntent({ action: 'update', targetId: 'e1', event: { participants: ['路人'] } }, { senderKey: '路人甲', roomName: room, dataDir })
check('非发起者改名单被拒', r2.includes('只有') && !loadGroupEvents(room, dataDir)[0].participants.includes('路人'))

// 发起者移除
applyEventIntent({ action: 'update', targetId: 'e1', removeParticipants: ['八爷'] }, { senderKey: '麻薯', roomName: room, dataDir })
check('发起者移除成功', !loadGroupEvents(room, dataDir)[0].participants.includes('八爷'))

// query 播报含名单
const q = applyEventIntent({ action: 'query' }, { senderKey: '甲', roomName: room, dataDir })
check('query 播报含已报名人数', q.includes('已报名') && q.includes('麻薯'))

// join 仍引导找发起者（不自动加）
const j = applyEventIntent({ action: 'join', targetId: 'e1' }, { senderKey: '新人', roomName: room, dataDir })
check('join 仍引导找发起者', j.includes('找') && !loadGroupEvents(room, dataDir)[0].participants.includes('新人'))

fs.rmSync(dataDir, { recursive: true, force: true })
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
