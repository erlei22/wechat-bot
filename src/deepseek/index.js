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

/**
 * Simple single-turn reply.
 */
export async function getDeepseekReply(prompt) {
  console.log('🚀 prompt:', prompt.slice(0, 120))
  const res = await openai.chat.completions.create({
    model: MODEL,
    messages: [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: prompt },
    ],
  })
  const reply = res.choices[0].message.content
  console.log('🚀 reply:', reply.slice(0, 120))
  return reply
}

/**
 * Tool-calling reply.
 * Supports one round of tool calls — DeepSeek decides which tools to invoke,
 * we execute them, then DeepSeek generates the final response.
 *
 * @param {string} prompt        - user message with injected context
 * @param {Array}  tools         - OpenAI-format tool definitions
 * @param {Function} toolHandler - async (name, args) => string result
 */
export async function getDeepseekReplyWithTools(prompt, tools, toolHandler) {
  console.log('🚀 prompt (tools):', prompt.slice(0, 120))

  const messages = [
    { role: 'system', content: SYSTEM },
    { role: 'user', content: prompt },
  ]

  const res = await openai.chat.completions.create({
    model: MODEL,
    messages,
    tools,
    tool_choice: 'auto',
  })

  const choice = res.choices[0]

  // No tool calls — return text directly
  if (choice.finish_reason !== 'tool_calls') {
    const reply = choice.message.content
    console.log('🚀 reply:', reply.slice(0, 120))
    return reply
  }

  // Execute each tool call
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

  // Final response after tool results
  const final = await openai.chat.completions.create({
    model: MODEL,
    messages,
  })

  const reply = final.choices[0].message.content
  console.log('🚀 reply (after tools):', reply.slice(0, 120))
  return reply
}
