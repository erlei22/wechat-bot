/**
 * PM2 进程管理配置
 * 用法：
 *   pm2 start ecosystem.config.cjs        # 启动
 *   pm2 restart wechat-bot                # 重启
 *   pm2 stop wechat-bot                   # 停止
 *   pm2 logs wechat-bot                   # 查看日志
 *   pm2 monit                             # 实时监控
 *   pm2 startup && pm2 save               # 配置开机自启（首次部署执行一次）
 */
module.exports = {
  apps: [
    {
      name: 'wechat-bot',
      script: './cli.js',
      args: 'wx',

      // 单实例，微信账号不能并发登录
      instances: 1,

      // 内存超过 500M 自动重启（防内存泄漏）
      max_memory_restart: '500M',

      // 崩溃后等待 5 秒再重启，避免循环崩溃打满日志
      restart_delay: 5000,

      // 指数退避重启：连续崩溃时拉长等待间隔（单位 ms），最大 16000ms
      exp_backoff_restart_delay: 100,

      // 连续崩溃超过 10 次停止尝试，需人工介入
      max_restarts: 10,

      // 不监听文件变化（生产环境不需要热重载）
      watch: false,

      // 日志写到项目 logs/ 目录，和现有 errorStore 日志放一起方便查
      out_file: './logs/pm2-out.log',
      error_file: './logs/pm2-error.log',
      // 合并 stdout + stderr 到一个文件，方便 tail -f
      merge_logs: true,
      // 日志加时间戳
      log_date_format: 'YYYY-MM-DD HH:mm:ss',

      // 环境变量：.env 由 dotenv 自动读取，这里只覆盖需要在生产环境强制开启的项
      env: {
        NODE_ENV: 'production',
        // 生产环境开启日志文件落盘
        LOG_FILE: 'true',
        LOG_LEVEL: 'info',
      },

      // 优雅关闭：给进程 10 秒清理（关闭微信连接、flush 日志）
      kill_timeout: 10000,

      // 进程退出后自动重启（默认 true，显式写出方便理解）
      autorestart: true,
    },
  ],
}
