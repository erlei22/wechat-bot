/**
 * 安全解析 LLM 返回的 JSON。
 *
 * LLM 偶发返回：带 markdown 代码围栏、前后有解释文字、或被 max_tokens 截断。
 * 这个函数尽力解析，失败返回 null，让调用方优雅跳过而不是抛异常刷错误日志。
 */
export function safeJsonParse(text) {
  if (!text || typeof text !== 'string') return null

  // 1. 直接解析
  try {
    return JSON.parse(text)
  } catch {}

  // 2. 去掉 markdown 代码围栏后再试
  const fenced = text.replace(/```(?:json)?/gi, '').trim()
  if (fenced !== text) {
    try {
      return JSON.parse(fenced)
    } catch {}
  }

  // 3. 抠出第一个 { 到最后一个 } 的片段
  const start = fenced.indexOf('{')
  const end = fenced.lastIndexOf('}')
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(fenced.slice(start, end + 1))
    } catch {}
  }

  // 4. 实在不行就放弃（通常是被 max_tokens 截断，无法修复）
  return null
}
