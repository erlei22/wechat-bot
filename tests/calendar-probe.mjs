import cd from 'chinese-days'

// 探索 getSolarDateFromLunar 参数格式
// 文档不清楚，试几种组合
// 2026年丙午年：天干地支年 = ?
// 尝试用 lunarYear (干支年 2026 对应农历2026)
const test1 = cd.getSolarDateFromLunar(2026, 1, 1)   // 正月初一
console.log('2026正月初一:', JSON.stringify(test1))

const test2 = cd.getSolarDateFromLunar(2025, 1, 1)   // 2025正月初一
console.log('2025正月初一:', JSON.stringify(test2))

// getDayDetail 对节假日的 name 是什么
const springFestival = cd.getDayDetail('2026-02-17') // 2026春节大概在这附近
console.log('2026-02-17:', JSON.stringify(springFestival))

// 查春节假期
const feb = cd.getHolidaysInRange('2026-02-01', '2026-03-01')
console.log('2026年2月节假日:', feb)

// 查春节详情
for (const d of feb.slice(0, 3)) {
    console.log(d, '->', JSON.stringify(cd.getDayDetail(d)))
}

// 查端午
const lunarFestJun = cd.getLunarFestivals('2026-06-19')
console.log('2026-06-19 农历节日:', lunarFestJun)
