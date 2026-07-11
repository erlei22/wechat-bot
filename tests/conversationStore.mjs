/**
 * conversationStore 单元测试
 * 运行：node tests/conversationStore.mjs
 */
import { getHistory, addTurn, clearHistory, clearAllHistory, getHistorySize } from '../src/platforms/wechat/store/conversationStore.js'

let passed = 0
let failed = 0

function assert(label, condition) {
  if (condition) {
    console.log(`  ✅ ${label}`)
    passed++
  } else {
    console.error(`  ❌ ${label}`)
    failed++
  }
}

function deepEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b)
}

// ── 空历史 ──────────────────────────────────────────
console.log('\n[1] 空历史')
assert('新群返回空数组', deepEqual(getHistory('群A', 3), []))
assert('turns=0 返回空数组', deepEqual(getHistory('群A', 0), []))
assert('roomKey 为空返回空数组', deepEqual(getHistory('', 3), []))

// ── 单轮 ────────────────────────────────────────────
console.log('\n[2] 单轮对话')
addTurn('群A', '今天天气怎么样？', '今天晴天，适合出门。', 3)
const h1 = getHistory('群A', 3)
assert('长度为 2（一对 user/assistant）', h1.length === 2)
assert('第一条是 user', h1[0].role === 'user' && h1[0].content === '今天天气怎么样？')
assert('第二条是 assistant', h1[1].role === 'assistant' && h1[1].content === '今天晴天，适合出门。')

// ── 多轮滑动窗口 ────────────────────────────────────
console.log('\n[3] 滑动窗口（maxTurns=3）')
addTurn('群A', '第二个问题', '第二个回答', 3)
addTurn('群A', '第三个问题', '第三个回答', 3)
assert('3 轮后 size=3', getHistorySize('群A') === 3)

// 加第 4 轮，最早的应被丢弃
addTurn('群A', '第四个问题', '第四个回答', 3)
assert('4 轮后 size 仍=3（滑动窗口）', getHistorySize('群A') === 3)
const h2 = getHistory('群A', 3)
assert('最早轮（天气）已被淘汰', h2[0].content !== '今天天气怎么样？')
assert('最新轮在末尾', h2[h2.length - 1].content === '第四个回答')

// ── turns 参数截断 ───────────────────────────────────
console.log('\n[4] turns 参数截断')
const h3 = getHistory('群A', 1)
assert('turns=1 只返回 2 条（最近一轮）', h3.length === 2)
assert('取到的是最后一轮', h3[0].content === '第四个问题')

// ── 群隔离 ───────────────────────────────────────────
console.log('\n[5] 群隔离')
addTurn('群B', '群 B 的问题', '群 B 的回答', 3)
assert('群 B 有 1 轮', getHistorySize('群B') === 1)
assert('群 A 历史不受群 B 影响', getHistorySize('群A') === 3)

// ── clearHistory ────────────────────────────────────
console.log('\n[6] clearHistory')
clearHistory('群B')
assert('clearHistory 后群 B 为 0', getHistorySize('群B') === 0)
assert('群 A 不受影响', getHistorySize('群A') === 3)

// ── clearAllHistory ──────────────────────────────────
console.log('\n[7] clearAllHistory')
clearAllHistory()
assert('clearAllHistory 后群 A 为 0', getHistorySize('群A') === 0)
assert('clearAllHistory 后群 B 为 0', getHistorySize('群B') === 0)

// ── maxTurns=0 不保存 ────────────────────────────────
console.log('\n[8] maxTurns=0 禁用')
addTurn('群C', '问题', '回答', 0)
assert('maxTurns=0 时 addTurn 不写入', getHistorySize('群C') === 0)

// ── 结果汇总 ─────────────────────────────────────────
console.log(`\n共 ${passed + failed} 项，通过 ${passed}，失败 ${failed}`)
if (failed > 0) process.exit(1)
