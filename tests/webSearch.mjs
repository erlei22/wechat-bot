import { webSearch } from '../src/platforms/wechat/commands/webSearch.js'

console.log('--- 全网搜索 ---')
console.log(await webSearch('上海周边徒步路线推荐 2026'))

console.log('\n--- 限定小红书 ---')
console.log(await webSearch('四明山徒步攻略', { includeDomains: ['xiaohongshu.com'], maxResults: 3 }))

console.log('\nDONE')
