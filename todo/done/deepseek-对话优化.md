# DeepSeek 对话方式优化（调研）

对照 DeepSeek 官方文档，看当前对话方式有没有可优化的地方。

## 关注点

- 多轮对话怎么组织（system / user / assistant 顺序）。
- 上下文缓存 / KV cache 折扣怎么用，能不能省 token。
- function calling 的最佳实践，特别是工具结果回写格式。
- 长文本截断策略。

## 待办

- [ ] 跑一遍 DeepSeek 官方 docs 当前版本（注意时效，2026 年可能有更新）。
- [ ] 输出一份对比清单：当前实现 vs 推荐做法。
- [ ] 标出投入产出比高的几条优先做。

## 调研结论

基于 DeepSeek 官方文档（2026-06）和第三方资料，对比当前实现，投入产出比排序：

| 项目 | 现状 | 结论 |
|---|---|---|
| Context Caching on Disk | 默认对所有用户开启 | **无需代码改动**，自动生效 |
| `max_tokens` 未设置 | 可能输出过长回复，增加成本 | **已加**：默认 800，可 `DEEPSEEK_MAX_TOKENS` 覆盖 |
| 缓存命中率未可见 | 无法判断 cache 效果 | **已加**：从 `usage.prompt_cache_hit_tokens/miss` 打印日志 |
| ACTIVITY_GUARDRAIL 在 user message | 每次请求都在动态内容里，影响前缀稳定性 | **已改**：通过 `systemAppend` 参数放入 system message，stable prefix 更长 |
| 多轮对话历史 | 无 | **有意不做**：群聊独立消息，保持无状态更安全，无跨消息上下文污染 |
| 多轮工具调用 | 只支持单轮 | **暂不做**：现有 3 个工具均单次调用足够，加复杂度收益低 |
| 工具结果格式 | `{ role: 'tool', tool_call_id, content }` | **正确**，符合 OpenAI/DeepSeek 规范，无需改动 |

关键规则（记录备忘）：缓存是 prefix-sensitive，任何变化出现在前面都会导致后续内容全部 cache miss。目前结构：stable(system+guardrail) → dynamic(room/sender/profile/events) → question，已是最优顺序。

## 完成记录

- 2026-06-24：`deepseek/index.js` 加 `max_tokens`（默认 800，`DEEPSEEK_MAX_TOKENS` 可覆盖）、`logCacheUsage` 打印命中率、`systemAppend` 参数（稳定规则内容放 system 提升 cache prefix 稳定性）。`sendMessage.js` 的 `ACTIVITY_GUARDRAIL` 从 user message 移入 `systemAppend`。语法检查通过。
- 2026-06-24（补）：实现多轮对话历史。新增 `conversationStore.js`（内存 Map，按群隔离，滑动窗口）；`getDeepseekReplyWithTools` 加 `history` 参数，插入 system 之后 user 之前；`sendMessage.js` 群聊路径调用前 `getHistory`、回复后 `addTurn`；`config/env.js` 加 `MULTI_ROUND_TURNS`（默认 3，设 0 关闭）。`tests/conversationStore.mjs` 19 项全通过，语法检查通过。
