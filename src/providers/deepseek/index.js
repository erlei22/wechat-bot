import OpenAI from 'openai'
import dotenv from 'dotenv'
import fs from 'fs'
import path from 'path'

const env = { ...dotenv.config().parsed, ...process.env }

const envPath = path.join(path.resolve(), '.env')
if (!fs.existsSync(envPath)) {
  console.log('❌ 请先根据文档，创建并配置 .env 文件！')
  process.exit(1)
}

const openai = new OpenAI({
  apiKey: env.DEEPSEEK_API_KEY,
  ...(env.DEEPSEEK_URL ? { baseURL: env.DEEPSEEK_URL } : {}),
})
const MODEL = env.DEEPSEEK_MODEL || 'deepseek-v4-flash'
const SYSTEM = env.DEEPSEEK_SYSTEM_MESSAGE || ''
// 单次群聊回复的最大 token 数，防止过长回复。可通过 DEEPSEEK_MAX_TOKENS 覆盖。
const MAX_TOKENS = parseInt(env.DEEPSEEK_MAX_TOKENS || '800', 10)

/** 记录缓存命中率，帮助了解 KV cache 效果（DeepSeek disk cache 默认开启）。 */
function logCacheUsage(usage, label = '') {
  if (!usage) return
  const hit = usage.prompt_cache_hit_tokens ?? 0
  const miss = usage.prompt_cache_miss_tokens ?? 0
  const total = hit + miss
  if (total > 0) {
    const pct = ((hit / total) * 100).toFixed(1)
    console.log(`💾 cache${label ? ' [' + label + ']' : ''}: hit=${hit} miss=${miss} (${pct}%)`)
  }
}

/**
 * 单轮回复（用于无工具场景，如 /help 生成、分析等）。
 * @param {string} prompt
 * @param {string} [systemAppend]  追加到 system 末尾的稳定内容（如活动防编造规则），
 *                                  放在 system 里以便被 DeepSeek prefix cache 复用。
 */
export async function getDeepseekReply(prompt, systemAppend = '') {
  console.log('🚀 prompt:', prompt.slice(0, 120))
  const systemContent = systemAppend ? `${SYSTEM}\n${systemAppend}`.trim() : SYSTEM
  const res = await openai.chat.completions.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    messages: [
      { role: 'system', content: systemContent },
      { role: 'user', content: prompt },
    ],
  })
  logCacheUsage(res.usage, 'single')
  const reply = res.choices[0].message.content
  console.log('🚀 reply:', reply.slice(0, 120))
  return reply
}

/**
 * 带工具调用的回复（群聊主路径）。
 * 支持单轮工具调用：DeepSeek 决定调用哪些工具 → 执行 → 生成最终回复。
 *
 * @param {string}   prompt        用户消息（含动态上下文：群名/发送者/画像/活动）
 * @param {Array}    tools         OpenAI-format 工具定义（静态，有利于 prefix cache）
 * @param {Function} toolHandler   async (name, args) => string 工具执行结果
 * @param {string}   [systemAppend] 追加到 system 末尾的稳定规则文本（防编造护栏等）
 * @param {Array}    [history]     多轮对话历史（{role, content}[]，由 conversationStore 提供）
 *                                 插入在 system 之后、当前 user 之前，让模型感知上下文关联。
 */
export async function getDeepseekReplyWithTools(prompt, tools, toolHandler, systemAppend = '', history = []) {
  console.log('🚀 prompt (tools):', prompt.slice(0, 120))
  if (history.length) console.log(`💬 history: ${history.length / 2} 轮`)

  const systemContent = systemAppend ? `${SYSTEM}\n${systemAppend}`.trim() : SYSTEM
  const messages = [
    { role: 'system', content: systemContent },
    ...history,               // 历史对话（按群隔离，最近 N 轮 user/assistant 交替）
    { role: 'user', content: prompt },
  ]

  const res = await openai.chat.completions.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    messages,
    tools,
    tool_choice: 'auto',
  })

  logCacheUsage(res.usage, 'tools-1st')
  const choice = res.choices[0]

  // 没有工具调用 → 直接返回文本
  if (choice.finish_reason !== 'tool_calls') {
    const reply = choice.message.content
    console.log('🚀 reply:', reply.slice(0, 120))
    return reply
  }

  // 执行所有工具调用
  messages.push(choice.message)
  for (const call of choice.message.tool_calls) {
    let result
    try {
      const args = JSON.parse(call.function.arguments)
      result = await toolHandler(call.function.name, args)
    } catch (e) {
      result = `工具执行失败: ${e.message}`
    }
    messages.push({
      role: 'tool',
      tool_call_id: call.id,
      content: String(result),
    })
  }

  // 工具结果回写后，生成最终回复
  const final = await openai.chat.completions.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    messages,
  })

  logCacheUsage(final.usage, 'tools-2nd')
  const reply = final.choices[0].message.content
  console.log('🚀 reply (after tools):', reply.slice(0, 120))
  return reply
}
