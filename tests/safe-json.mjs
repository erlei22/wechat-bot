/**
 * safeJsonParse 验证，覆盖 errors.db 里出现过的失败模式
 * node tests/safe-json.mjs
 */
import { safeJsonParse } from '../src/utils/json.js'

let pass = 0, fail = 0
const check = (label, cond) => { if (cond) { pass++; console.log('OK  ', label) } else { fail++; console.log('FAIL', label) } }

check('正常 JSON', safeJsonParse('{"a":1}')?.a === 1)
check('markdown 围栏', safeJsonParse('```json\n{"a":2}\n```')?.a === 2)
check('前后有文字', safeJsonParse('好的，结果是 {"a":3} 这样')?.a === 3)
check('截断的 JSON → null（优雅跳过）', safeJsonParse('{"a":1,"b":"未闭合') === null)
check('空串 → null', safeJsonParse('') === null)
check('null 输入 → null', safeJsonParse(null) === null)
check('非 JSON 文本 → null', safeJsonParse('就是一句话') === null)

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
