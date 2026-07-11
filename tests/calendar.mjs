/**
 * 日历工具验证
 * node tests/calendar.mjs
 */
import { getDateInfo, getHolidaySchedule, parseDate } from '../src/platforms/wechat/commands/calendar.js'

// 1. parseDate
console.assert(parseDate('2026-06-24') === '2026-06-24', 'parseDate YYYY-MM-DD')
console.assert(parseDate('今天') !== null, 'parseDate 今天')
console.assert(parseDate('invalid') === null, 'parseDate invalid')
console.log('parseDate: OK')

// 2. 今天的日历信息
console.log('\n--- 今天 ---')
console.log(getDateInfo('今天'))

// 3. 春节
console.log('\n--- 2026年春节 ---')
console.log(getDateInfo('2026-02-17'))

// 4. 调休上班日
console.log('\n--- 2026-02-01（春节前调休上班） ---')
console.log(getDateInfo('2026-02-01'))

// 5. 节气
console.log('\n--- 2026年夏至（06-21） ---')
console.log(getDateInfo('2026-06-21'))

// 6. 本月安排
console.log('\n--- 2026年6月安排 ---')
console.log(getHolidaySchedule('2026-06'))

// 7. 春节那个月
console.log('\n--- 2026年2月安排 ---')
console.log(getHolidaySchedule('2026-02'))

console.log('\nALL DONE')
