import cd from 'chinese-days'
const a = cd.getSolarTerms('2026-06-01', '2026-07-01')
console.log('getSolarTerms:', JSON.stringify(a))
const b = cd.getSolarTermsInRange('2026-06-01', '2026-07-01')
console.log('getSolarTermsInRange count:', b.length, 'first:', JSON.stringify(b[0]))
