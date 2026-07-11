/**
 * 天气工具验证 — 和风天气 (QWeather)
 * node tests/weather.mjs
 *
 * 需要 .env 中配置 QWEATHER_API_KEY + QWEATHER_API_HOST
 */
import { getWeather } from '../src/platforms/wechat/commands/weather.js'

if (!process.env.QWEATHER_API_KEY && !process.env.QWEATHER_PRIVATE_KEY) {
    // .env 未加载时检查 fallback
    const msg = await getWeather('上海')
    console.assert(msg.includes('QWEATHER'), '无 Key 时应提示配置')
    console.log('no-key fallback OK')
} else {
    console.log('--- 上海 3天 ---')
    console.log(await getWeather('上海', 3))
    console.log('\n--- 成都 1天 ---')
    console.log(await getWeather('成都', 1))
}

console.log('DONE')
