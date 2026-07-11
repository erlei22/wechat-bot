/**
 * 天气查询 — 基于 和风天气 (QWeather) API
 *
 * 支持两种认证方式（优先 JWT）：
 *
 * 方式 A — JWT（推荐，更安全）：
 *   QWEATHER_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----"
 *   QWEATHER_KEY_ID=控制台里的凭据ID
 *   QWEATHER_API_HOST=https://你的项目ID.qweatherapi.com
 *
 * 方式 B — API KEY（旧方式，仍可用）：
 *   QWEATHER_API_KEY=你的APIKey
 *   QWEATHER_API_HOST=https://devapi.qweather.com  # 默认值
 *
 * 免费套餐：实时天气 + 3 天预报，每天 1000 次调用。
 * 缓存：内存，30 分钟，避免重复调用。
 */

import dotenv from 'dotenv'
import { createPrivateKey, sign } from 'node:crypto'

const env = { ...dotenv.config().parsed, ...process.env }

// 和风天气 API 主机，新账号在控制台有专属域名（天气 + GeoAPI 均走同一个 host）
const API_HOST = (env.QWEATHER_API_HOST || 'https://devapi.qweather.com').replace(/\/$/, '')
// 旧账号 GeoAPI 走独立域名；新账号（有专属 host）直接用 API_HOST
const GEO_HOST = env.QWEATHER_API_HOST ? API_HOST : 'https://geoapi.qweather.com'

// ---------------------------------------------------------------------------
// JWT 生成（Ed25519，和风天气当前认证方式）
// 每个 JWT 有效期 30 分钟，提前 1 分钟刷新
// ---------------------------------------------------------------------------
let _jwtCache = null

function buildJWT(privateKeyPem, keyId) {
  if (_jwtCache && _jwtCache.exp - 60 > Math.floor(Date.now() / 1000)) {
    return _jwtCache.token // 未到期直接复用
  }

  const header = Buffer.from(JSON.stringify({ alg: 'EdDSA', typ: 'JWT' })).toString('base64url')
  const now = Math.floor(Date.now() / 1000)
  const exp = now + 1800 // 30 分钟
  const payload = Buffer.from(JSON.stringify({ sub: keyId, iat: now, exp })).toString('base64url')
  const sigInput = `${header}.${payload}`

  const privateKey = createPrivateKey(privateKeyPem.replace(/\\n/g, '\n'))
  const sigBuf = sign(null, Buffer.from(sigInput), privateKey)
  const token = `${sigInput}.${sigBuf.toString('base64url')}`

  _jwtCache = { token, exp }
  return token
}

// ---------------------------------------------------------------------------
// API 请求（X-QW-Api-Key 放 Header，Gzip 自动解压）
// ---------------------------------------------------------------------------
function authHeaders() {
  const privateKey = env.QWEATHER_PRIVATE_KEY
  const keyId = env.QWEATHER_KEY_ID

  if (privateKey && keyId) {
    const jwt = buildJWT(privateKey, keyId)
    return { Authorization: `Bearer ${jwt}`, 'Accept-Encoding': 'gzip' }
  }
  const apiKey = env.QWEATHER_API_KEY
  if (apiKey) {
    return { 'X-QW-Api-Key': apiKey, 'Accept-Encoding': 'gzip' }
  }
  return { 'Accept-Encoding': 'gzip' }
}

function isConfigured() {
  return (env.QWEATHER_PRIVATE_KEY && env.QWEATHER_KEY_ID) || env.QWEATHER_API_KEY
}

// ---------------------------------------------------------------------------
// 缓存（仅天气数据，GeoAPI 禁止缓存——见和风开发者许可协议）
// 实时天气：20 分钟；3 天预报：2 小时
// ---------------------------------------------------------------------------
const _cache = new Map()
const CACHE_NOW_MS = 20 * 60 * 1000
const CACHE_DAILY_MS = 2 * 60 * 60 * 1000

function cacheGet(key) {
  const entry = _cache.get(key)
  if (!entry) return null
  if (Date.now() > entry.expiry) { _cache.delete(key); return null }
  return entry.value
}

function cacheSet(key, value, ttl) {
  _cache.set(key, { value, expiry: Date.now() + ttl })
}

// ---------------------------------------------------------------------------
// API 请求（和风域名在国内直连无问题）
// ---------------------------------------------------------------------------
async function qFetch(url) {
  const res = await fetch(url, { headers: authHeaders() })
  if (!res.ok) throw new Error(`和风天气请求失败: ${res.status}`)
  const data = await res.json()
  if (data.code && data.code !== '200') {
    // 和风的业务错误码
    const msg = {
      '400': '请求参数有误',
      '401': 'API Key 无效或未认证',
      '402': 'API Key 超额',
      '403': '无访问权限',
      '404': '查询地点不存在',
      '429': '请求过于频繁',
      '500': '和风天气服务异常',
    }[data.code] ?? `错误码 ${data.code}`
    throw new Error(msg)
  }
  return data
}

// ---------------------------------------------------------------------------
// GeoAPI：城市名 → LocationID（不缓存，和风禁止存储 GeoAPI 数据）
// ---------------------------------------------------------------------------
async function lookupCity(city) {
  const url = `${GEO_HOST}/geo/v2/city/lookup?location=${encodeURIComponent(city)}&lang=zh`
  const data = await qFetch(url)

  if (!data.location?.length) return null

  const loc = data.location[0]
  return {
    id: loc.id,
    display: loc.name + (loc.adm1 && loc.adm1 !== loc.name ? `（${loc.adm1}）` : ''),
  }
}

// ---------------------------------------------------------------------------
// 天气查询
// ---------------------------------------------------------------------------
async function fetchNow(locId) {
  const cacheKey = `now:${locId}`
  const cached = cacheGet(cacheKey)
  if (cached) return cached
  const data = await qFetch(`${API_HOST}/v7/weather/now?location=${locId}&lang=zh`)
  cacheSet(cacheKey, data.now, CACHE_NOW_MS)
  return data.now
}

async function fetchDaily(locId) {
  const cacheKey = `3d:${locId}`
  const cached = cacheGet(cacheKey)
  if (cached) return cached
  const data = await qFetch(`${API_HOST}/v7/weather/3d?location=${locId}&lang=zh`)
  cacheSet(cacheKey, data.daily, CACHE_DAILY_MS)
  return data.daily
}

// ---------------------------------------------------------------------------
// 格式化输出
// ---------------------------------------------------------------------------
function formatWeather(cityDisplay, now, daily, days) {
  const time = new Date().toLocaleString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    hour: '2-digit',
    minute: '2-digit',
  })

  const lines = [`📍 ${cityDisplay}  ${time}`]

  // 当前天气
  const windInfo = now.windDir && now.windScale ? `${now.windDir} ${now.windScale}级` : ''
  const humidInfo = now.humidity ? `  湿度 ${now.humidity}%` : ''
  lines.push(`现在：${now.temp}°C  ${now.text}  ${windInfo}${humidInfo}`.trim())

  // 未来天气
  const dayLabels = ['今天', '明天', '后天']
  for (let i = 0; i < Math.min(days, daily.length); i++) {
    const d = daily[i]
    const label = dayLabels[i] || d.fxDate.slice(5)
    const rain = Number(d.precip) > 0 ? `  雨 ${d.precip}mm` : ''
    lines.push(`${label}（${d.fxDate.slice(5)}）：${d.tempMin}~${d.tempMax}°C  ${d.textDay}${rain}`)
  }

  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// 主入口
// ---------------------------------------------------------------------------

/**
 * 查询天气，返回格式化字符串供 DeepSeek 工具调用。
 * @param {string} city  城市名（中文，如"上海"、"成都"）
 * @param {number} days  天数 1-3，默认 3（免费套餐最多 3 天）
 */
export async function getWeather(city, days = 3) {
  if (!city?.trim()) return '请告诉我你想查哪个城市的天气'

  if (!isConfigured()) {
    return [
      '天气功能需要先配置 和风天气 API。',
      '1. 前往 https://dev.qweather.com 免费注册',
      '2. 创建项目和凭据（推荐选 JWT）',
      '3. 将以下内容填入 .env：',
      '   JWT 方式：QWEATHER_PRIVATE_KEY / QWEATHER_KEY_ID / QWEATHER_API_HOST',
      '   API KEY 方式：QWEATHER_API_KEY',
    ].join('\n')
  }

  const loc = await lookupCity(city.trim())
  if (!loc) return `没找到"${city}"，换个城市名试试？`

  const [now, daily] = await Promise.all([
    fetchNow(loc.id),
    fetchDaily(loc.id),
  ])

  return formatWeather(loc.display, now, daily, Math.min(days, 3))
}
