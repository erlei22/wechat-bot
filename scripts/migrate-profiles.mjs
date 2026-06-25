/**
 * 人物画像格式迁移脚本
 *
 * 把旧格式的 profiles/*.json 升级到最新 schema：
 *   - notes: string[] → {text, group}[]
 *   - 补齐所有新字段（gender, ageRange, birthday, zodiac, mbti,
 *     occupation, company, city, district, diet, sports, schedule,
 *     hobbies, hasCar, canDrive, carInfo, personality, closeFriends）
 *
 * 用法：
 *   node scripts/migrate-profiles.mjs [dataDir]
 *   dataDir 默认 .data/wechat
 *
 * 幂等：已有的字段值不会被覆盖为空。
 */

import fs from 'fs'
import path from 'path'

const dataDir = process.argv[2] || '.data/wechat'
const profilesDir = path.resolve(process.cwd(), dataDir, 'profiles')

if (!fs.existsSync(profilesDir)) {
  console.log(`找不到目录: ${profilesDir}`)
  process.exit(0)
}

// 最新 schema 的默认值
const DEFAULTS = {
  gender: 'unknown',
  ageRange: '',
  birthday: '',
  zodiac: '',
  mbti: '',
  occupation: '',
  company: '',
  city: '',
  district: '',
  diet: '',
  sports: [],
  schedule: '',
  hobbies: [],
  hasCar: null,
  canDrive: null,
  carInfo: '',
  personality: '',
  closeFriends: [],
  groups: [],
  tags: [],
  notes: [],
  messageCount: 0,
}

const files = fs.readdirSync(profilesDir).filter(f => f.endsWith('.json') && !f.endsWith('.bak'))
console.log(`找到 ${files.length} 个画像文件，开始迁移...\n`)

let migrated = 0, skipped = 0

for (const file of files) {
  const filePath = path.join(profilesDir, file)
  let profile

  try {
    profile = JSON.parse(fs.readFileSync(filePath, 'utf8'))
  } catch (e) {
    console.warn(`⚠️  跳过（JSON 解析失败）: ${file} — ${e.message}`)
    skipped++
    continue
  }

  const changes = []

  // 1. notes 格式升级：string → {text, group, count, firstSeen, lastSeen}
  if (Array.isArray(profile.notes)) {
    let touched = false
    profile.notes = profile.notes.map((n) => {
      if (typeof n === 'string') {
        touched = true
        return { text: n, group: null, count: 1, firstSeen: profile.firstSeen || new Date().toISOString(), lastSeen: profile.lastSeen || new Date().toISOString() }
      }
      // 已是对象但缺 count/时间戳 → 补
      if (n && typeof n === 'object' && n.count === undefined) {
        touched = true
        return { text: n.text, group: n.group ?? null, count: 1, firstSeen: n.firstSeen || profile.firstSeen || new Date().toISOString(), lastSeen: n.lastSeen || profile.lastSeen || new Date().toISOString() }
      }
      return n
    })
    if (touched) changes.push('notes: 补 count/时间戳')
  }

  // 2. 补齐缺失字段
  for (const [key, defaultVal] of Object.entries(DEFAULTS)) {
    if (profile[key] === undefined) {
      profile[key] = defaultVal
      changes.push(`${key}: 新增`)
    }
  }

  // 3. 确保 firstSeen/lastSeen 存在
  if (!profile.firstSeen) { profile.firstSeen = new Date().toISOString(); changes.push('firstSeen: 补充') }
  if (!profile.lastSeen) { profile.lastSeen = profile.firstSeen; changes.push('lastSeen: 补充') }

  if (changes.length === 0) {
    skipped++
    continue
  }

  fs.writeFileSync(filePath, JSON.stringify(profile, null, 2), 'utf8')
  console.log(`✅ ${file} (${changes.length} 处变更)`)
  if (changes.length <= 6) {
    changes.forEach(c => console.log(`   • ${c}`))
  } else {
    console.log(`   • ${changes.slice(0, 3).join(', ')} ... 等 ${changes.length} 处`)
  }
  migrated++
}

console.log(`\n完成：迁移 ${migrated} 个，跳过 ${skipped} 个（已是最新格式）`)
