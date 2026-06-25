/**
 * 置信度 + 去重计数 + 字段重置 验证
 * node tests/profile-confidence.mjs
 */
import { applyExtraction, createEmptyProfile, formatProfileForPrompt, resetProfileField, saveProfile, loadProfile, deleteProfile } from '../src/platforms/wechat/store/profileStore.js'

const dataDir = '.data/wechat'
let pass = 0, fail = 0
const check = (label, cond) => { if (cond) { pass++; console.log('OK  ', label) } else { fail++; console.log('FAIL', label) } }

// 1. 去重计数：同一条记录观察两次 → count=2，不重复堆叠
{
  const p = createEmptyProfile('测试甲')
  applyExtraction(p, { newNotes: ['周末喜欢去爬山'] }, { roomName: 'A群', dataDir, selfKey: '测试甲' })
  applyExtraction(p, { newNotes: ['周末喜欢去爬山徒步'] }, { roomName: 'A群', dataDir, selfKey: '测试甲' })
  check('相似记录合并为1条', p.notes.length === 1)
  check('count 累加到2', p.notes[0].count === 2)
  check('保留更完整文本', p.notes[0].text.includes('徒步'))
}

// 2. 注入：确认(≥2)的注入，单次的最多带1条
{
  const p = createEmptyProfile('测试乙')
  // 两条确认 + 三条待定
  applyExtraction(p, { newNotes: ['爱喝精酿'] }, { roomName: 'A群', dataDir, selfKey: '测试乙' })
  applyExtraction(p, { newNotes: ['爱喝精酿啤酒'] }, { roomName: 'A群', dataDir, selfKey: '测试乙' }) // →count2
  applyExtraction(p, { newNotes: ['今天心情不错'] }, { roomName: 'A群', dataDir, selfKey: '测试乙' })
  applyExtraction(p, { newNotes: ['在看一本书'] }, { roomName: 'A群', dataDir, selfKey: '测试乙' })
  const out = formatProfileForPrompt(p, 'A群')
  check('确认记录"精酿"被注入', out.includes('精酿'))
  // 待定最多注入1条，所以"今天心情"和"在看书"不会都出现
  const tentativeCount = ['今天心情不错', '在看一本书'].filter(t => out.includes(t.slice(0,4))).length
  check('待定记录最多注入1条', tentativeCount <= 1)
}

// 3. resetProfileField 清字段
{
  const p = createEmptyProfile('测试丙')
  p.occupation = '程序员'; p.personality = '毒舌'; p.tags = ['标签1']
  saveProfile('测试丙', p, dataDir)
  check('清除职业', resetProfileField('测试丙', '职业', dataDir) === true && loadProfile('测试丙', dataDir).occupation === '')
  check('清除标签(数组)', resetProfileField('测试丙', '标签', dataDir) === true && loadProfile('测试丙', dataDir).tags.length === 0)
  check('清除不存在字段返回true但无害', resetProfileField('测试丙', '性格', dataDir) === true)
  deleteProfile('测试丙', dataDir) // 清理测试数据
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
