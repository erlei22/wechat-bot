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
