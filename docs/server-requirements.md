# 项目服务器需求说明

## 项目简介

基于 [Wechaty](https://wechaty.js.org/) 的微信群聊 AI 助手（bot）。常驻运行，监听微信群消息，调用 DeepSeek API 生成回复，并提供活动管理、用户画像、天气查询等功能。

## 技术栈

| 项目 | 版本 / 说明 |
|------|------------|
| 运行时 | Node.js（建议 v18+，项目用过 v19） |
| 框架 | Wechaty 1.20 + puppet-wechat4u（网页微信协议） |
| 数据库 | SQLite（better-sqlite3），单文件，无需独立数据库服务 |
| AI 接口 | DeepSeek API（外部 HTTP 调用，无本地 GPU 需求） |
| 进程管理 | PM2 |
| 包管理 | npm |

## 运行方式

单进程，常驻后台，PM2 守护：

```
pm2 start ecosystem.config.cjs
```

- 实例数：**1**（微信账号不能多实例并发登录）
- 设定内存上限：500M，超出自动重启
- 崩溃后自动重启，指数退避间隔

## 存储需求

| 路径 | 内容 | 估算大小 |
|------|------|---------|
| `.data/wechat/messages.db` | 消息历史 SQLite | 初始几 MB，长期运行可能增长到几十 MB |
| `.data/wechat/profiles/` | 用户画像 JSON，约 20 个文件 | < 1 MB |
| `.data/wechat/events/` | 群活动数据 JSON | < 1 MB |
| `.data/wechat/config/` | 白名单、配置 JSON | < 1 MB |
| `WechatEveryDay.memory-card.json` | 微信登录 session | < 1 MB |
| `logs/` | 运行日志 + 错误日志 | 每天几 MB，定期清理 |

**总磁盘需求：代码 + 依赖约 500MB（node_modules），运行数据 < 100MB**

## 网络需求

| 目标 | 说明 |
|------|------|
| `api.deepseek.com`（或 siliconflow） | AI 接口，HTTPS 出站 |
| `m77p44dxp4.re.qweatherapi.com` | 天气 API，HTTPS 出站 |
| `api.tavily.com` | 网页搜索 API，HTTPS 出站 |
| 微信服务器 | Wechaty puppet 维持长连接 |

**只需要出站访问，不需要开放任何入站端口（无 Web 服务）。**

## 对服务器的要求

| 项目 | 最低 | 推荐 |
|------|------|------|
| CPU | 1 核 | 2 核 |
| 内存 | 1 GB | 2 GB |
| 磁盘 | 20 GB | 40 GB |
| 带宽 | 1 Mbps | 3 Mbps |
| 操作系统 | Ubuntu 20.04+ / Debian 11+ | Ubuntu 22.04 LTS |
| 公网 IP | 需要（固定 IP 更稳定，微信对 IP 有风险控制） | 固定 IP |
| 地域 | **国内（大陆）** | 上海 / 广州（微信连接延迟低） |

> ⚠️ **必须用国内服务器**：Wechaty 网页微信协议需要与微信服务器保持稳定连接，海外 IP 容易触发微信封号或频繁掉线。

## 部署方式

- 代码托管在 git，通过 `git pull` 更新代码
- 敏感文件（`.env`、`messages.db`、微信 session）通过 `rsync` + SSH 单独同步
- 项目提供 `scripts/deploy.sh` 一键部署脚本

## 不需要的东西

- 不需要 Docker（直接跑 Node.js）
- 不需要 Nginx / Web 服务器
- 不需要 MySQL / Redis / PostgreSQL
- 不需要 GPU
- 不需要备案（无入站 HTTP 服务）
