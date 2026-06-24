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
