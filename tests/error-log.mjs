/**
 * 文件版错误日志验证
 * node tests/error-log.mjs
 */
import fs from 'fs'
import { logError, listErrors, countErrors, clearErrors, formatErrorList } from '../src/platforms/wechat/store/errorStore.js'

let pass = 0, fail = 0
const check = (l, c) => { if (c) { pass++; console.log('OK  ', l) } else { fail++; console.log('FAIL', l) } }

// 先清空（隔离测试）——注意这会清 logs/errors.jsonl，仅测试用
clearErrors()

logError('testScope', new Error('boom 1'), { room: 'A群' })
logError('testScope', 'boom 2 字符串错误')
logError('otherScope', new Error('boom 3'))

check('count 全部 = 3', countErrors() === 3)
check('count testScope = 2', countErrors({ scope: 'testScope' }) === 2)

const rows = listErrors({ limit: 10 })
check('list 倒序，最新在前', rows[0].message.includes('boom 3'))
check('context 保留', rows.find(r => r.message.includes('boom 1'))?.context?.room === 'A群')

const out = formatErrorList(listErrors({ scope: 'testScope' }))
check('format 含 scope', out.includes('testScope'))

const n = clearErrors()
check('clear 返回条数', n === 3 && countErrors() === 0)

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
