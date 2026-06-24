/**
 * Web 搜索工具 — 基于 Tavily API
 *
 * 国内直连可用，免费 1,000 次/月，无需绑卡。
 * 注册：https://app.tavily.com（邮箱注册，30 秒拿到 Key）
 *
 * 在 .env 中配置：
 *   TAVILY_API_KEY=tvly-xxxxxxxxxxxxxxxx
 */

import dotenv from 'dotenv'

const env = { ...dotenv.config().parsed, ...process.env }

const TAVILY_API = 'https://api.tavily.com/search'

/**
 * 搜索网页，返回格式化摘要供 DeepSeek 参考。
 * @param {string} query      搜索关键词
 * @param {object} options
 * @param {string[]} options.includeDomains  限定搜索来源，如 ['xiaohongshu.com']
 * @param {number}  options.maxResults       返回条数，默认 5
 */
export async function webSearch(query, { includeDomains = [], maxResults = 5 } = {}) {
  if (!query?.trim()) return '请告诉我要搜索什么'

  const key = env.TAVILY_API_KEY
  if (!key) {
    return '网络搜索功能需要配置 Tavily API Key。\n前往 https://app.tavily.com 免费注册，将 Key 填入 .env 的 TAVILY_API_KEY'
  }

  const body = {
    query: query.trim(),
    max_results: Math.min(maxResults, 10),
    search_depth: 'basic',
    include_answer: true,     // 返回 AI 合成摘要
    ...(includeDomains.length ? { include_domains: includeDomains } : {}),
  }

  const res = await fetch(TAVILY_API, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${key}`,
    },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    const msg = err?.detail?.error || `HTTP ${res.status}`
    if (res.status === 401) return 'Tavily API Key 无效，请检查 .env 中的 TAVILY_API_KEY'
    if (res.status === 429) return '搜索请求太频繁，稍后再试'
    throw new Error(`Tavily 搜索失败: ${msg}`)
  }

  const data = await res.json()

  const lines = [`🔍 "${query}" 的搜索结果：`]

  // 优先展示 AI 合成的简答
  if (data.answer) {
    lines.push(`\n💡 ${data.answer}`)
  }

  // 各条结果
  if (data.results?.length) {
    lines.push('')
    for (const r of data.results.slice(0, maxResults)) {
      const domain = new URL(r.url).hostname.replace('www.', '')
      lines.push(`• ${r.title}（${domain}）`)
      if (r.content) lines.push(`  ${r.content.slice(0, 100).trim()}…`)
    }
  }

  return lines.join('\n')
}
