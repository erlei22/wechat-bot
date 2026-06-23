/**
 * 回复限速队列
 *
 * 微信对消息发送频率敏感，连续快速发送容易触发风控。
 * 这里用串行队列 + 最小间隔 + 随机抖动模拟正常人的打字节奏。
 *
 * 用法：throttledSay(room, '内容') 代替 room.say('内容')
 */

const MIN_DELAY_MS = 1500      // 两条回复之间最短间隔
const MAX_JITTER_MS = 1500     // 额外随机抖动上限（实际延迟 = MIN + random(0, MAX)）

// 串行队列：保证消息一条一条发，不并发
let queue = Promise.resolve()

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * 将消息加入发送队列，自动限速。
 * @param {object} target  wechaty Room 或 Contact 对象
 * @param {string} text    要发送的文字
 */
export function throttledSay(target, text) {
  queue = queue.then(async () => {
    const delay = MIN_DELAY_MS + Math.random() * MAX_JITTER_MS
    await sleep(delay)
    await target.say(text)
  })
  return queue
}
