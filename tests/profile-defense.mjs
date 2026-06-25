/**
 * 画像防投毒验证：applyExtraction 的代码兜底层
 * node tests/profile-defense.mjs
 *
 * 用真实的 .data/wechat/profiles 做第三方姓名检测（麻薯、小白等是已知成员）
 */
import { applyExtraction, createEmptyProfile } from '../src/platforms/wechat/store/profileStore.js'

const dataDir = '.data/wechat'
let pass = 0, fail = 0
const check = (label, cond) => {
  if (cond) { pass++; console.log('OK  ', label) }
  else { fail++; console.log('FAIL', label) }
}

// 1. 侮辱/指控词 → notes 被丢
{
  const p = createEmptyProfile('测试甲')
  applyExtraction(p, { newNotes: ['这人就是个骗子', '喜欢爬山'], newTags: ['渣男'] }, { roomName: 'A群', dataDir, selfKey: '测试甲' })
  const notes = p.notes.map(n => n.text)
  check('侮辱note"骗子"被拦', !notes.some(t => t.includes('骗子')))
  check('正常note"喜欢爬山"保留', notes.some(t => t.includes('爬山')))
  check('侮辱tag"渣男"被拦', !p.tags.includes('渣男'))
}

// 2. 第三方姓名 → 丢弃（麻薯是已知成员，小白说麻薯的事不该进小白画像）
{
  const p = createEmptyProfile('小白')
  applyExtraction(p, { newNotes: ['麻薯很有钱', '自己喜欢摄影'] }, { roomName: 'A群', dataDir, selfKey: '小白' })
  const notes = p.notes.map(n => n.text)
  check('谈论他人"麻薯很有钱"被拦', !notes.some(t => t.includes('麻薯')))
  check('自述"摄影"保留', notes.some(t => t.includes('摄影')))
}

// 3. gender 枚举校验
{
  const p = createEmptyProfile('测试乙')
  applyExtraction(p, { gender: 'attacker-injected' }, { roomName: 'A群', dataDir, selfKey: '测试乙' })
  check('非法gender降级为unknown', p.gender === 'unknown')
  applyExtraction(p, { gender: 'female' }, { roomName: 'A群', dataDir, selfKey: '测试乙' })
  check('合法gender=female生效', p.gender === 'female')
}

// 4. mbti 正则校验
{
  const p = createEmptyProfile('测试丙')
  applyExtraction(p, { mbti: '乱写的' }, { roomName: 'A群', dataDir, selfKey: '测试丙' })
  check('非法mbti被拒', p.mbti === '')
  applyExtraction(p, { mbti: 'infp' }, { roomName: 'A群', dataDir, selfKey: '测试丙' })
  check('合法mbti=INFP生效', p.mbti === 'INFP')
}

// 5. 正常硬事实落库 + 群隔离
{
  const p = createEmptyProfile('测试丁')
  applyExtraction(p, { occupation: '程序员', city: '上海', hasCar: true, sports: ['徒步'] }, { roomName: 'B群', dataDir, selfKey: '测试丁' })
  check('职业=程序员', p.occupation === '程序员')
  check('城市=上海', p.city === '上海')
  check('有车=true', p.hasCar === true)
  check('运动含徒步', p.sports.includes('徒步'))
}

// 6. closeFriends 允许群成员名（合理），但过滤侮辱
{
  const p = createEmptyProfile('测试戊')
  applyExtraction(p, { closeFriends: ['麻薯', '小白'] }, { roomName: 'A群', dataDir, selfKey: '测试戊' })
  check('closeFriends允许群成员名', p.closeFriends.includes('麻薯') && p.closeFriends.includes('小白'))
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
