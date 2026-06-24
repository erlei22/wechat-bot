import { getUpcomingGroupEvents, formatEventsForPrompt } from '../store/eventStore.js'
import { loadProfile, formatProfileForPrompt } from '../store/profileStore.js'
import { saveFeedback } from '../store/feedbackStore.js'
import { getWeather } from './weather.js'
import { getDateInfo, getHolidaySchedule } from './calendar.js'
import { webSearch } from './webSearch.js'

// ---------------------------------------------------------------------------
// Tool definitions (OpenAI function calling format)
// ---------------------------------------------------------------------------

export const BOT_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'web_search',
      description: '搜索互联网获取实时信息，适合需要最新数据、查找推荐、了解近期事件等场景。可指定搜索范围，如只搜小红书、两步路等。',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '搜索关键词，用中文搜中文内容效果更好' },
          include_domains: {
            type: 'array',
            items: { type: 'string' },
            description: '限定搜索的网站域名，如 ["xiaohongshu.com"]、["2bulu.com"]，不填则搜全网',
          },
          max_results: { type: 'number', description: '返回结果数，1-10，默认 5' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_date_info',
      description: '查询某天的详细日历信息：公历、农历、干支、节气、节日、工作日/假日/调休，默认查今天',
      parameters: {
        type: 'object',
        properties: {
          date: { type: 'string', description: '日期，格式 YYYY-MM-DD，如 2026-06-24；不填默认今天' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_holiday_schedule',
      description: '查询某月的节假日和调休安排，包括节气、补班日、节假日汇总，默认当月',
      parameters: {
        type: 'object',
        properties: {
          month: { type: 'string', description: '月份，格式 YYYY-MM，如 2026-06；不填默认本月' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_weather',
      description: '查询某个城市的天气预报，支持中英文城市名，返回当前天气和未来几天预报',
      parameters: {
        type: 'object',
        properties: {
          city: { type: 'string', description: '城市名，如"上海"、"北京"、"成都"，支持中英文' },
          days: { type: 'number', description: '查询天数，1-7，默认 3 天' },
        },
        required: ['city'],
      },
    },
  },
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
    case 'web_search':
      return await webSearch(args.query, {
        includeDomains: args.include_domains || [],
        maxResults: args.max_results || 5,
      })

    case 'get_date_info':
      return getDateInfo(args.date)

    case 'get_holiday_schedule':
      return getHolidaySchedule(args.month)

    case 'get_weather': {
      return await getWeather(args.city, args.days ?? 3)
    }

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
