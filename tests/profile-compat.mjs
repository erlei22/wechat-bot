import * as m from '../src/platforms/wechat/store/profileStore.js'

// 旧格式画像（notes 是纯字符串，无 group）
const p = m.loadProfile('小白', '.data/wechat')
console.log('--- 小白 原始 notes ---')
console.log(JSON.stringify(p.notes))

console.log('\n--- formatProfileForPrompt（带 scope）---')
console.log(m.formatProfileForPrompt(p, '虹桥爱博徒步搭子群'))

console.log('\n--- formatProfileForPrompt（无 scope）---')
console.log(m.formatProfileForPrompt(p))

console.log('\n--- isProfileRelevant ---')
console.log('含"八卦":', m.isProfileRelevant('你真的很八卦', p, '虹桥爱博徒步搭子群'))
console.log('不相关:', m.isProfileRelevant('今天天气真好', p, '虹桥爱博徒步搭子群'))

// 混合格式（一条旧，一条新）
const mixed = {
  name: '测试',
  tags: ['运动'],
  notes: [
    '旧记录没有group',
    { text: 'A群里的事', group: 'A群' },
    { text: 'B群里的事', group: 'B群' },
  ]
}
console.log('\n--- 混合格式，scope=A群 ---')
console.log(m.formatProfileForPrompt(mixed, 'A群'))
// 期望：旧记录 + A群记录都显示，B群记录不显示
