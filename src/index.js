import { Command } from 'commander'
import fs from 'fs'
import path, { dirname } from 'path'
import { fileURLToPath } from 'url'
import { env, getWechatRuntimeConfig } from './config/env.js'
import { analyzeWechatMessages } from './analysis/wechatAnalyzer.js'
import { larkListMessages, larkLogin, larkSearchMessages, larkSendText, larkStatus } from './adapters/lark.js'
import { runOpenCli, runWxCli } from './adapters/opencli.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const { version, name } = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../package.json'), 'utf8'))

// ---------------------------------------------------------------------------
// Start wechat bot
// ---------------------------------------------------------------------------

async function startWechat() {
  if (!env.DEEPSEEK_API_KEY) {
    console.log('请先在 .env 中配置 DEEPSEEK_API_KEY')
    return
  }
  const { startWechatBot } = await import('./platforms/wechat/bot.js')
  startWechatBot()
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function printAnalysisResult(result) {
  console.log(`分析对象：${result.target}`)
  console.log(JSON.stringify(result.stats, null, 2))
  if (result.analysis) {
    console.log('\n分析结果：')
    console.log(result.analysis)
  }
}

const program = new Command(name)
program.alias('wb').description('基于 WeChaty + DeepSeek 的微信机器人').version(version, '-v, --version')

// 默认：直接启动
program.action(async () => {
  await startWechat()
})

program
  .command('start')
  .description('启动微信机器人，扫码登录')
  .action(async () => {
    await startWechat()
  })

program
  .command('analyze')
  .description('分析本地捕获的微信聊天记录')
  .option('--room <name>', '按群聊名称分析')
  .option('--friend <name>', '按好友昵称或备注分析')
  .option('--query <keyword>', '只分析包含关键词的消息')
  .option('--start <iso>', '开始时间 ISO 8601')
  .option('--end <iso>', '结束时间 ISO 8601')
  .option('--limit <number>', '最多读取最近 N 条本地消息', '5000')
  .option('--stats-only', '只输出统计，不调用 AI')
  .action(async (options) => {
    const config = getWechatRuntimeConfig()
    const result = await analyzeWechatMessages({
      ...options,
      dataDir: config.dataDir,
      limit: Number(options.limit),
    })
    printAnalysisResult(result)
  })

// ── lark ───────────────────────────────────────────────────────────────────

const lark = program.command('lark').description('飞书 IM 登录、发消息和读取消息')

lark
  .command('login')
  .description('使用 lark-cli device flow 登录飞书')
  .option('--scope <scope>', '指定 scope')
  .option('--domain <domain>', '按 domain 授权', 'im')
  .option('--no-wait', '只生成授权链接，不阻塞等待')
  .option('--device-code <code>', '继续上一次 --no-wait 的 device_code')
  .action(async (options) => { await larkLogin(options) })

lark
  .command('status')
  .description('查看当前飞书授权状态')
  .action(async () => { await larkStatus() })

lark
  .command('send')
  .description('发送飞书文本消息')
  .option('--as <identity>', 'user 或 bot', 'user')
  .option('--chat-id <chatId>', '群聊 ID')
  .option('--user-id <userId>', '用户 open_id')
  .requiredOption('--text <text>', '文本内容')
  .action(async (options) => { await larkSendText(options) })

lark
  .command('messages')
  .description('读取飞书群聊或 P2P 消息')
  .option('--as <identity>', 'user 或 bot', 'user')
  .option('--chat-id <chatId>', '群聊 ID')
  .option('--user-id <userId>', '用户 open_id')
  .option('--start <iso>', '开始时间')
  .option('--end <iso>', '结束时间')
  .option('--page-size <number>', '分页大小', '50')
  .option('--format <format>', 'json | pretty | table | ndjson | csv', 'pretty')
  .action(async (options) => { await larkListMessages(options) })

lark
  .command('search')
  .description('搜索飞书消息')
  .option('--query <keyword>', '关键词')
  .option('--chat-id <chatId>', '限制群聊')
  .option('--chat-type <type>', 'group 或 p2p')
  .option('--start <iso>', '开始时间')
  .option('--end <iso>', '结束时间')
  .option('--page-all', '自动翻页')
  .option('--page-limit <number>', '最多翻页数', '20')
  .option('--format <format>', 'json | pretty | table | ndjson | csv', 'pretty')
  .action(async (options) => { await larkSearchMessages(options) })

// ── opencli / wx ───────────────────────────────────────────────────────────

program
  .command('opencli')
  .description('透传调用 OpenCLI')
  .allowUnknownOption(true)
  .argument('[args...]')
  .action(async (args) => { await runOpenCli(args) })

program
  .command('wx')
  .description('通过 OpenCLI wx-cli 访问本地微信缓存')
  .allowUnknownOption(true)
  .argument('[args...]')
  .action(async (args) => { await runWxCli(args) })

program.parseAsync().catch((error) => {
  console.error(error.message)
  process.exitCode = 1
})
