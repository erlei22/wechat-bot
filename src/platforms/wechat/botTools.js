import { getUpcomingGroupEvents, formatEventsForPrompt } from './eventStore.js'
import { loadProfile, formatProfileForPrompt } from './profileStore.js'
import { saveFeedback } from './feedbackStore.js'

// ---------------------------------------------------------------------------
// Tool definitions (OpenAI function calling format)
// ---------------------------------------------------------------------------

export const BOT_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'get_upcoming_events',
      description: '查询本群的近期活动列表，包括时间、地点、参与者、车主等信息',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_person_profile',
      description: '获取某个群成员的画像，了解他们的兴趣、标签和过往记录',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: '成员昵称或备注名' },
        },
        required: ['name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'submit_feedback',
      description: '当用户表达对机器人的建议、吐槽、功能意见或改进想法时，将反馈内容记录下来',
      parameters: {
        type: 'object',
        properties: {
          content: { type: 'string', description: '用户反馈的原始内容，保留用户的表达方式' },
        },
        required: ['content'],
      },
    },
  },
]

// ---------------------------------------------------------------------------
// Tool executor
// ---------------------------------------------------------------------------

/**
 * Execute a tool call and return a string result for DeepSeek to use.
 * @param {string} toolName
 * @param {object} args
 * @param {object} ctx        - { roomName, dataDir }
 */
export async function executeTool(toolName, args, ctx) {
  const { roomName, dataDir } = ctx

  switch (toolName) {
    case 'get_upcoming_events': {
      const events = getUpcomingGroupEvents(roomName, dataDir)
      if (!events.length) return '本群暂无近期活动'
      return formatEventsForPrompt(events, dataDir)
    }

    case 'get_person_profile': {
      const profile = loadProfile(args.name, dataDir)
      if (!profile) return `还没有关于 ${args.name} 的记录`
      // 按群隔离：群里查询只返回本群学到的记录，私聊用 '私聊' 作用域
      const scope = roomName || '私聊'
      return formatProfileForPrompt(profile, scope) || `${args.name} 的记录还不够丰富`
    }

    case 'submit_feedback': {
      const id = saveFeedback({ sender: ctx.senderKey, room: roomName, content: args.content }, dataDir)
      return `反馈已记录（#${id}），谢谢！`
    }

    default:
      return `未知工具: ${toolName}`
  }
}
