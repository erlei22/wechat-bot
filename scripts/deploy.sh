#!/usr/bin/env bash
# =============================================================================
# deploy.sh — 将本地改动推到腾讯云服务器
#
# 用法：
#   ./scripts/deploy.sh              # 完整部署（代码 + 数据 + 重启）
#   ./scripts/deploy.sh --code-only  # 只推代码，不同步数据
#   ./scripts/deploy.sh --data-only  # 只同步数据文件，不推代码
#
# 首次使用前：
#   1. 修改下面的 SERVER_USER 和 SERVER_HOST
#   2. 确保本机的 SSH 公钥已加到服务器 ~/.ssh/authorized_keys（免密登录）
#   3. chmod +x scripts/deploy.sh
# =============================================================================

set -euo pipefail

# ── 配置项，按实际情况修改 ──────────────────────────────────────────────────
SERVER_USER="ubuntu"            # 服务器登录用户
SERVER_HOST="your.server.ip"    # 服务器 IP 或域名
SERVER_DIR="/home/ubuntu/wechat-bot"  # 服务器上的项目目录
# ─────────────────────────────────────────────────────────────────────────────

SSH_TARGET="${SERVER_USER}@${SERVER_HOST}"
MODE="${1:-}"

echo "🚀 目标：${SSH_TARGET}:${SERVER_DIR}"

sync_code() {
  echo ""
  echo "📦 推送代码（git pull）..."
  # 本地先 push，再让服务器 pull
  git push
  ssh "${SSH_TARGET}" "cd ${SERVER_DIR} && git pull"
  echo "   安装/更新依赖..."
  ssh "${SSH_TARGET}" "cd ${SERVER_DIR} && npm install --omit=dev"
}

sync_data() {
  echo ""
  echo "📂 同步数据文件（rsync）..."

  # 同步 .env（密钥配置）
  rsync -avz --progress \
    .env \
    "${SSH_TARGET}:${SERVER_DIR}/.env"

  # 同步 SQLite 数据库（messages.db）
  # 注意：如果服务器上的 bot 正在写入，可能有短暂锁。建议先 pm2 stop 再同步。
  rsync -avz --progress \
    .data/wechat/messages.db \
    "${SSH_TARGET}:${SERVER_DIR}/.data/wechat/messages.db"

  # 同步微信 session（memory-card，避免重新扫码）
  if [ -f "WechatEveryDay.memory-card.json" ]; then
    rsync -avz --progress \
      WechatEveryDay.memory-card.json \
      "${SSH_TARGET}:${SERVER_DIR}/WechatEveryDay.memory-card.json"
    echo "   ✓ 微信 session 已同步"
  else
    echo "   ⚠️  本地没有 WechatEveryDay.memory-card.json，跳过（服务器需重新扫码登录）"
  fi
}

restart_bot() {
  echo ""
  echo "🔄 重启 PM2 进程..."
  ssh "${SSH_TARGET}" "cd ${SERVER_DIR} && pm2 restart ecosystem.config.cjs --update-env"
  ssh "${SSH_TARGET}" "pm2 status wechat-bot"
}

# ── 执行 ──────────────────────────────────────────────────────────────────────
case "$MODE" in
  --code-only)
    sync_code
    restart_bot
    ;;
  --data-only)
    sync_data
    ;;
  *)
    # 默认：完整部署
    sync_code
    sync_data
    restart_bot
    ;;
esac

echo ""
echo "✅ 完成"
