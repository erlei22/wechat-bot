/**
 * 日历工具 — 基于 chinese-days
 *
 * 功能：公历/农历换算、节气、节假日/工作日、调休安排。
 * 数据来源：chinese-days（打包了国务院官方调休安排，按版本更新）。
 * 全部本地计算，无网络请求，零延迟。
 *
 * 更新节假日数据：npm update chinese-days
 */

import cd from 'chinese-days'

// ---------------------------------------------------------------------------
// 辅助
// ---------------------------------------------------------------------------

/** 把 "2026-06-24" 或 "今天" 解析成 YYYY-MM-DD；不合法返回 null */
export function parseDate(input) {
  if (!input || input === '今天' || input === 'today') {
    return new Date().toLocaleDateString('sv')  // sv locale → YYYY-MM-DD
  }
  // 简单验证格式
  const m = String(input).trim().match(/^(\d{4})[.\-\/](\d{1,2})[.\-\/](\d{1,2})$/)
  if (!m) return null
  const [, y, mo, d] = m
  return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`
}

/** getDayDetail.name 格式 "Spring Festival,春节,4" → "春节" 或直接返回 */
function parseDayName(name) {
  if (!name) return ''
  const parts = name.split(',')
  // 有中文名取第二段，否则返回第一段
  return parts.length >= 2 ? parts[1] : parts[0]
}

/** 日期加减天数 */
function addDays(dateStr, n) {
  const d = new Date(dateStr)
  d.setDate(d.getDate() + n)
  return d.toLocaleDateString('sv')
}

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六']

// ---------------------------------------------------------------------------
// 核心功能
// ---------------------------------------------------------------------------

/**
 * 查询某天的详细日历信息（默认今天）。
 * 返回：公历、农历、节气、节日、工作日/假日/调休。
 */
export function getDateInfo(dateInput) {
  const date = parseDate(dateInput)
  if (!date) return `日期格式有误，请用 YYYY-MM-DD，如 2026-06-24`

  const [y, mo, d] = date.split('-').map(Number)
  const dow = new Date(date).getDay()

  // 农历
  const lunar = cd.getLunarDate(date)
  const lunarStr = lunar
    ? `${lunar.lunarYearCN}年（${lunar.yearCyl}）${lunar.zodiac}年 ${lunar.lunarMonCN}${lunar.lunarDayCN}`
    : '—'

  // 节气（只在节气当天显示）
  const termList = cd.getSolarTermsInRange(date, date)
  const todayTerm = termList.find(t => t.index === 1)  // index=1 表示该节气第一天
  const termStr = todayTerm ? `🌿 ${todayTerm.name}` : ''

  // 节日（农历 + 法定）
  const lunarFests = cd.getLunarFestivals(date) || []
  const festNames = lunarFests.flatMap(f => f.name || [])

  const detail = cd.getDayDetail(date)
  const dayName = detail?.name ? parseDayName(detail.name) : ''
  // 非普通星期名才算节日
  const solarFestNames = ['Sunday', 'Saturday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday']
  if (dayName && !solarFestNames.includes(dayName)) festNames.push(dayName)

  const festStr = festNames.length ? `🎉 ${[...new Set(festNames)].join(' / ')}` : ''

  // 工作日状态
  const isHoliday = cd.isHoliday(date)
  const isWorkday = cd.isWorkday(date)
  const isInLieu = cd.isInLieu(date)     // 调休补班日

  let workStatus
  if (isInLieu) workStatus = '🔄 调休上班'
  else if (isHoliday) workStatus = '🏖 假日'
  else if (!isWorkday) workStatus = '📅 休息日'
  else workStatus = '💼 工作日'

  const lines = [
    `📅 ${date} 星期${WEEKDAYS[dow]}`,
    `🌙 农历：${lunarStr}`,
    termStr,
    festStr,
    workStatus,
  ].filter(Boolean)

  return lines.join('\n')
}

/**
 * 查询本月（或指定月份）的节假日和调休安排。
 * dateInput: "2026-06"、"2026-06-01" 均可，默认当月。
 */
export function getHolidaySchedule(dateInput) {
  let year, month

  if (!dateInput) {
    const now = new Date()
    year = now.getFullYear()
    month = now.getMonth() + 1
  } else {
    const m = String(dateInput).trim().match(/^(\d{4})[.\-\/](\d{1,2})/)
    if (!m) return `格式有误，请用 YYYY-MM，如 2026-06`
    year = Number(m[1])
    month = Number(m[2])
  }

  const start = `${year}-${String(month).padStart(2, '0')}-01`
  const lastDay = new Date(year, month, 0).getDate()
  const end = `${year}-${String(month).padStart(2, '0')}-${lastDay}`

  const holidays = cd.getHolidaysInRange(start, end)
  const terms = cd.getSolarTerms(start, end)
  const workdays = cd.getWorkdaysInRange(start, end)

  const lines = [`📅 ${year}年${month}月日历概览`]

  // 节气
  if (terms.length) {
    lines.push(`🌿 节气：${terms.map(t => `${t.date.slice(5)} ${t.name}`).join(' / ')}`)
  }

  // 调休上班日
  const liuDays = workdays.filter(d => cd.isInLieu(d))
  if (liuDays.length) {
    lines.push(`🔄 调休上班：${liuDays.map(d => d.slice(5)).join(', ')}`)
  }

  // 节假日（按节日名分组）
  const holidayDetails = new Map()
  for (const d of holidays) {
    const detail = cd.getDayDetail(d)
    const name = detail?.name ? parseDayName(detail.name) : '休息日'
    if (!holidayDetails.has(name)) holidayDetails.set(name, [])
    holidayDetails.get(name).push(d.slice(5))
  }

  for (const [name, days] of holidayDetails) {
    const common = ['Sunday', 'Saturday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday']
    if (common.includes(name)) continue  // 跳过普通周末
    lines.push(`🏖 ${name}：${days.join(', ')}`)
  }

  const totalHolidays = holidays.filter(d => !cd.isInLieu(d)).length
  const weekendOnly = holidays.filter(d => {
    const dow = new Date(d).getDay()
    return (dow === 0 || dow === 6) && !cd.isHoliday(d)
  }).length

  lines.push(`\n共 ${lastDay} 天 | 工作日 ${workdays.length} 天 | 休息日 ${lastDay - workdays.length} 天`)

  return lines.join('\n')
}
