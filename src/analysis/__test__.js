import assert from 'assert'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { analyzeWechatMessages, buildWechatStats } from './wechatAnalyzer.js'

const records = [
  {
    timestamp: '2026-05-12T08:00:00.000Z',
    roomName: '研发群',
    talkerName: 'Alice',
    talkerAlias: 'Alice',
    receiverName: '',
    text: '今天排查登录问题',
    typeName: 'Text',
  },
  {
    timestamp: '2026-05-12T09:00:00.000Z',
    roomName: '研发群',
    talkerName: 'Bob',
    talkerAlias: 'Bob',
    receiverName: '',
    text: '我来补日志',
    typeName: 'Text',
  },
  {
    timestamp: '2026-05-12T10:00:00.000Z',
    roomName: '',
    talkerName: 'Carol',
    talkerAlias: 'Carol',
    receiverName: 'me',
    text: '周会改到下午',
    typeName: 'Text',
  },
]

const stats = buildWechatStats(records)
assert.equal(stats.totalMessages, 3)
assert.equal(stats.textMessages, 3)
assert.equal(stats.topSpeakers[0].name, 'Alice')

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wechat-bot-analysis-'))
fs.mkdirSync(tmpDir, { recursive: true })
fs.writeFileSync(path.join(tmpDir, 'messages.jsonl'), records.map((record) => JSON.stringify(record)).join('\n'), 'utf8')

const result = await analyzeWechatMessages({
  dataDir: tmpDir,
  room: '研发群',
  statsOnly: true,
})

assert.equal(result.target, '群聊「研发群」')
assert.equal(result.stats.totalMessages, 2)
assert.equal(result.analysis, '')

console.log('analysis tests passed')
