import { logger } from '../src/utils/logger.js'
import fs from 'fs'

// 测试控制台输出（已经通过 LOG_LEVEL=debug 可见）
logger.debug('[MSG IN]', { room: '测试群', sender: '小明', isRoom: false, isAlias: true, botName: '@机器人' })
logger.info('[GROUP]', { room: '测试群', sender: '小明', q: '今天天气怎么样' })
logger.info('[REPLY ←]', { room: '测试群', preview: '上海今天多云，24°C' })
logger.warn('[GATE]', '群不在白名单')
logger.error('[ERROR]', new Error('test error'))

// 测试文件写入（LOG_FILE=true 时）
await new Promise(r => setTimeout(r, 100))
if (process.env.LOG_FILE === 'true') {
  const files = fs.readdirSync('logs')
  console.log('\nlogs/ 文件:', files)
  const content = fs.readFileSync('logs/' + files[0], 'utf8')
  console.log('文件内容（前4行）:\n' + content.split('\n').slice(0, 4).join('\n'))
  fs.rmSync('logs', { recursive: true })
  console.log('logs/ 已清理')
} else {
  console.log('\n（LOG_FILE=false，跳过文件验证）')
}

console.log('DONE')
