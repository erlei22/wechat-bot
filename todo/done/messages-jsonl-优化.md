# `messages.jsonl` 数据结构优化

## 背景

`src/platforms/wechat/messageStore.js` 把每条消息 append 一行 JSON 到 `.data/wechat/messages.jsonl`。当前结构（实样）：

```json
{"id":"...","timestamp":"2026-06-23T07:34:01.959Z","type":7,"typeName":"Text",
 "isText":true,"isRoom":true,"roomName":"徒步小分队","talkerName":"二雷",
 "talkerAlias":"","receiverName":"","text":"好了","self":true}
```

## 现存问题

1. **格式冗余**：`type` + `typeName`、`isText` + `type===7` 重复；`isRoom` 和 `roomName` 非空也重复。
2. **查询性能差**：每次 `/统计` `/分析` 都要全文件读出来再过滤，文件越大越慢；没有索引、没法按群 / 按时间范围跳读。
3. **无切割 / 归档**：jsonl 只增不减，长期跑下去单文件会膨胀。
4. **跨群混存**：所有群消息混在一个文件里，和项目「群隔离」存储约定不一致（`eventStore.js` 是按群一文件存的，参考它）。
5. **没有 schema 版本号**：以后改字段要兼容老数据会很痛。
6. **`receiverName` 大多为空**，群消息场景几乎没用，浪费空间。
7. **AI 回复是否落库没明确标记**：`self: true` 既可能是「机器人自己发的」也可能是「登录账号自己发的」，复盘 / 训练数据会混淆。

## 待办（按优先级）

- [ ] 加 schema 版本号 `v: 1`，方便后续平滑迁移。
- [ ] 区分「真人 / AI / 系统」三类来源（`source: 'human' | 'ai' | 'system'` 替代 / 补充 `self`）。
- [ ] 评估直接换 sqlite（仿 `feedbackStore.js` / `errorStore.js`）：append-only 表 + 多列索引，查询和归档都方便很多；jsonl 只在导出 / 审计时再 dump。**首选这条**。
- [ ] 如果保留 jsonl：按群分片存储，参考 `eventStore.js`，改成 `.data/wechat/messages/<群名 hash>.jsonl`，私聊单独 `private.jsonl`；消除冗余字段。
- [ ] 索引层：每文件配 `meta.json` 记录条数、起止时间、最后偏移量，让 `/统计` 不必整文件 load。
- [ ] 按天 / 按月切割归档，老数据落 gz；查询时按需解压。
- [ ] 写 `migrate-messages.js` 一次性把现有 jsonl 灌进新结构，保留旧文件做 backup。

## 注意点

- 落库失败不能影响主流程，错误丢给 `errorStore.logError('messageStore', ...)`。
- 群名可能含特殊字符，文件名要做 hash 或 URL encode，别直接拼。
- text 字段是不可信用户输入，做查询 / 分析前都要按 project-guidelines 当不可信数据处理。
- 切到 sqlite 时，`captureWechatMessage` 的同步 `appendFileSync` 要换成异步写入，注意并发顺序。

## 完成记录

- 2026-06-24：`messageStore.js` 全量重写为 sqlite（`messages.db`）。schema v:1，字段：id/v/ts/room_name/talker_name/talker_alias/msg_type/type_name/source/text，4 个索引（ts/room/room+ts/talker）。`source` 字段取代旧 `self`（`human`/`self`/`ai`），去掉冗余字段 isText/isRoom/receiverName。`loadWechatMessages` 支持 SQL 层过滤（room/friend/start/end/query），不再全量加载。`logAiReply` 新增，供未来 AI 回复落库。`wechatAnalyzer.js` 更新为直接传 filters 给 `loadWechatMessages`，去掉二次内存过滤。写 `migrate-messages.js` 一次性迁移旧 jsonl → sqlite，旧文件备份为 `.bak`。生产代码无 jsonl 降级路径（已删），迁移脚本自己算路径。测试脚本存 `tests/messageStore.mjs`，所有断言通过。

## 补充说明（2026-06-24）

**分库分表**：不需要。SQLite 处理 10 万 + 行仍然高性能（有 4 个索引），按群 + 按时间的 SQL WHERE 就是逻辑分片。如果几年后数据量很大，最简单的方案是按年加归档表（messages_2026、messages_2027），现阶段不值得做。

**Token 消耗护栏**：存储不是问题，但传给 AI 的消息数是护栏。`wechatAnalyzer.js` 提取了 `MAX_AI_SAMPLE_MESSAGES = 120` 常量（有注释"改之前评估成本"），防止未来无意删掉 slice 导致 token 爆炸。`stats` JSON 去掉 pretty print 节省约 30% token。时间戳截到分钟（`slice(0,16)`）减少无意义字符。每次分析的 prompt 约 1600-2000 token（120条中文消息 + stats），可控。
