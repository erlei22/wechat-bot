# 私聊不启用 AI

私聊场景默认关闭 AI 自动回复，仅保留管理指令。

## 现状

- 由 `PRIVATE_CHAT_AI` env 控制，当前已关闭。
- 项目准则要求：不要为私聊 AI 路径投入精力，优先群聊。

## 待办

- [ ] 在 `sendMessage.js` 入口处增加保险判断：私聊 + 非管理指令 + AI 关闭，直接静默。
- [ ] 文档注明这条策略，避免误开。

## 完成记录

- 2026-06-24：`config/env.js` 增加 `privateChatAI`（`PRIVATE_CHAT_AI`，默认 false）。`sendMessage.js` 私聊分支在 `!privateChatAI` 时静默返回，管理指令不受影响（在上方处理）。已在 steering 注明：不要为私聊 AI 路径投入精力。
