import { env } from '../src/config/env.js'

const sys = env.DEEPSEEK_SYSTEM_MESSAGE || ''
console.log('system message 长度:', sys.length)
console.log('末尾30字:', JSON.stringify(sys.slice(-30)))
console.log('QWEATHER_API_KEY 泄漏?', sys.includes('c4e62d5738'))
console.log('LOG_LEVEL 泄漏?', sys.includes('LOG_LEVEL'))
console.log('QWEATHER_API_KEY 正确读到?', (env.QWEATHER_API_KEY || '').startsWith('c4e62'))
console.log('LOG_LEVEL 正确读到?', env.LOG_LEVEL === 'info' || env.LOG_LEVEL === 'debug')
