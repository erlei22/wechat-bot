---
inclusion: manual
---

# 日常巡检流程（Daily Maintenance）

> 触发：用户发「巡检」（或在 Agent Hooks 面板点 daily-maintenance）。
> 目标：自驱完成「查 bug → 看今天聊天 → 优化活动/画像/流程」，最后给一份简报。
> 原则：每步都用工具实际查，不要凭记忆或臆测；配合 `project-guidelines` 与 `todo-workflow`。

按顺序执行，能当场修的当场修，大改先记 `todo/`。

## 1. 查 bug
- 读最近错误：`tail -n 50 logs/errors.jsonl`（文件版错误日志，JSONL）。
- 按 `scope` 分组，找高频或新出现的错误；定位根因（不是头痛医头）。
- 能修的直接修，改完 `node --check <file>` 验证；有确定性逻辑写 `tests/*.mjs` 验证。
- 修不了的（如 wechat4u 协议超时等外部问题）在简报里点明，不强修。

## 2. 看今天聊天记录
- 对每个白名单群，查今天消息：
  `node scripts/db.mjs messages "SELECT ts,talker_name,text FROM messages WHERE room_name='群名' AND substr(ts,1,10)=date('now') ORDER BY ts"`
  （ts 为 UTC；如需按本地日界，用 date('now','localtime') 自行调整）
- 关注四类信号：
  1. 新发起 / 正在筹备的活动（有没有该记没记的）
  2. 参与、集合、拼车等协调摩擦
  3. 画像信号（有人透露职业/城市/有车/忌口等）
  4. 对 bot 的吐槽、答非所问、不回复

## 3. 活动流程
- 看 `.data/wechat/events/*.json`：过期活动是否该归档、名单是否准、发起/参与有无卡点。
- 对照今天聊天里的真实协调，发现摩擦 → 优化 `eventLifecycle`（代码兜底 + LLM 语义，权限/确认不破坏）。

## 4. 画像更新与脏数据巡查
- 今天活跃的人，画像该补的补、该修的修（结合滚动上下文，别单句揣测）。
- 巡查投毒：侮辱、谈论他人、夸大；命中用 `/画像 删 <昵称> <字段>` 或 `resetProfileField` 清理。
- 不破坏既有防投毒四层规则。

## 5. 流程 / 代码优化
- 基于 1–4 的发现，提出并实施小步改进；复用既有约定（store 仿 feedbackStore、回复走 throttledSay、配置走 env 开关）。
- 较大的改动先在 `todo/` 建任务，按 `todo-workflow` 推进。

## 6. 简报
一段话向用户汇报：
- bug：查到几条、修了哪些、哪些外部不修
- 今天群里：活动/协调概况、值得注意的事
- 画像：更新/清理了什么
- 优化：做了哪些改动、还有哪些建议（需 key / 破坏性操作先问）

## 注意
- 隐私按群隔离不变；私聊不启用 AI，不碰。
- 临时验证脚本放 `tests/`，临时数据跑完清理。
- 破坏性操作（删数据、改 live）先确认。
