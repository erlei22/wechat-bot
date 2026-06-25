/**
 * .env 配置健康检查：确认 system prompt 解析正确、敏感 key 没泄漏进 prompt
 * node tests/env-check.mjs
 */
import { env } from '../src/config/env.js'

const sys = env.DEEPSEEK_SYSTEM_MESSAGE || ''
let pass = 0, fail = 0
const check = (label, cond) => { if (cond) { pass++; console.log('OK  ', label) } else { fail++; console.log('FAIL', label) } }

check('system prompt 非空', sys.length > 0)
check('含人设「温柔捧场型」', sys.includes('温柔捧场型'))
check('含「两种语气」', sys.includes('两种语气'))
check('QWEATHER key 未泄漏进 prompt', !sys.includes('c4e62'))
check('TAVILY key 未泄漏进 prompt', !sys.includes('tvly-'))
check('QWEATHER_API_KEY 正确读到', (env.QWEATHER_API_KEY || '').startsWith('c4e62'))
check('LOG_LEVEL 正确读到', !!env.LOG_LEVEL)

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
