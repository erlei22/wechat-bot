# 区分真人和 AI

AI 回复要带可识别标记，让用户知道是机器人在说话。

## 待办

- [ ] 复用 `AI_REPLY_MARKER` env，在 `throttledSay` 出口统一加前缀 / 后缀。
- [ ] 标记本身要简短不打扰，避免每条都很长。
- [ ] 考虑只在群聊加标记，私聊管理回复可以不加。

## 完成记录

- 2026-06-24：`config/env.js` 增加 `aiReplyMarker`（`AI_REPLY_MARKER`，默认 `🤖 `，空串可关闭）。`sendMessage.js` 的 `markAiReply` 给 AI 对话回复统一加前缀（已带或为空则跳过）；活动生命周期的群回复也带该标记。
