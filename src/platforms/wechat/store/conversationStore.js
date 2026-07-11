/**
 * 群聊多轮对话历史（内存缓存）。
 *
 * 按群名隔离，不跨群共享。进程重启后历史清空（无需持久化，轻量设计）。
 * 数据结构：Map<roomKey, Array<{user: string, assistant: string}>>
 *
 * 设计说明：
 *   - user 字段存纯提问文字（不含动态上下文前缀），节省 token。
 *   - assistant 字段存机器人原始回复（不含 AI 标记，避免标记污染历史）。
 *   - 滑动窗口：超出 maxTurns 时自动丢弃最早的轮次。
 */

// roomKey => [{user: string, assistant: string}]
const _history = new Map()

/**
 * 获取指定群的历史消息（OpenAI messages 格式：展开成 user/assistant 交替）。
 * @param {string} roomKey - 群名（隔离键）
 * @param {number} turns   - 最多取最近 N 轮（0 或负数返回空数组）
 * @returns {Array<{role: string, content: string}>}
 */
export function getHistory(roomKey, turns = 3) {
  if (!roomKey || turns <= 0) return []
  const list = _history.get(roomKey) || []
  return list.slice(-turns).flatMap(({ user, assistant }) => [
    { role: 'user', content: user },
    { role: 'assistant', content: assistant },
  ])
}

/**
 * 保存一轮对话到历史（滑动窗口）。
 * @param {string} roomKey   - 群名（隔离键）
 * @param {string} question  - 用户提问（仅纯文字，不含上下文前缀）
 * @param {string} response  - 机器人回复文本
 * @param {number} maxTurns  - 最大保留轮数
 */
export function addTurn(roomKey, question, response, maxTurns = 3) {
  if (!roomKey || maxTurns <= 0) return
  const list = _history.get(roomKey) || []
  list.push({ user: question, assistant: response })
  // 滑动窗口：只保留最近 maxTurns 轮
  if (list.length > maxTurns) list.splice(0, list.length - maxTurns)
  _history.set(roomKey, list)
}

/**
 * 清空某个群的历史（预留给管理命令或测试使用）。
 * @param {string} roomKey
 */
export function clearHistory(roomKey) {
  _history.delete(roomKey)
}

/**
 * 清空所有群的历史（进程重置或测试用）。
 */
export function clearAllHistory() {
  _history.clear()
}

/**
 * 获取当前群的历史轮数（调试用）。
 * @param {string} roomKey
 * @returns {number}
 */
export function getHistorySize(roomKey) {
  return (_history.get(roomKey) || []).length
}
