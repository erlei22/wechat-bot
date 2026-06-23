import { loadGroupEvents, saveGroupEvents, getUpcomingGroupEvents, formatEventsForPrompt } from './eventStore.js'
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
      name: 'join_event',
      description: '将某人加入某个活动的参与者列表',
      parameters: {
        type: 'object',
        properties: {
          event_id: { type: 'string', description: '活动 ID' },
          participant_name: { type: 'string', description: '要加入的人的昵称' },
        },
        required: ['event_id', 'participant_name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'leave_event',
      description: '将某人从活动参与者列表中移除',
      parameters: {
        type: 'object',
        properties: {
          event_id: { type: 'string', description: '活动 ID' },
          participant_name: { type: 'string', description: '要退出的人的昵称' },
        },
        required: ['event_id', 'participant_name'],
      },
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

    case 'join_event': {
      const events = loadGroupEvents(roomName, dataDir)
      const idx = events.findIndex((e) => e.id === args.event_id)
      if (idx < 0) return `找不到活动 ID: ${args.event_id}`
      if (!events[idx].participants) events[idx].participants = []
      if (events[idx].participants.includes(args.participant_name)) {
        return `${args.participant_name} 已经在「${events[idx].title}」的名单里了`
      }
      events[idx].participants.push(args.participant_name)
      events[idx].updatedAt = new Date().toISOString()
      saveGroupEvents(roomName, events, dataDir)
      return `已将 ${args.participant_name} 加入「${events[idx].title}」。当前参与者：${events[idx].participants.join('、')}`
    }

    case 'leave_event': {
      const events = loadGroupEvents(roomName, dataDir)
      const idx = events.findIndex((e) => e.id === args.event_id)
      if (idx < 0) return `找不到活动 ID: ${args.event_id}`
      const before = events[idx].participants || []
      events[idx].participants = before.filter((p) => p !== args.participant_name)
      events[idx].updatedAt = new Date().toISOString()
      saveGroupEvents(roomName, events, dataDir)
      const remaining = events[idx].participants.join('、') || '（空）'
      return `已将 ${args.participant_name} 从「${events[idx].title}」移除。剩余参与者：${remaining}`
    }

    case 'get_person_profile': {
      const profile = loadProfile(args.name, dataDir)
      if (!profile) return `还没有关于 ${args.name} 的记录`
      return formatProfileForPrompt(profile) || `${args.name} 的记录还不够丰富`
    }

    case 'submit_feedback': {
      const id = saveFeedback({ sender: ctx.senderKey, room: roomName, content: args.content }, dataDir)
      return `反馈已记录（#${id}），谢谢！`
    }

    default:
      return `未知工具: ${toolName}`
  }
}
