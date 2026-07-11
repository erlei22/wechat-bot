# tests/

存放开发过程中写的最小运行验证脚本（`.mjs`）。

## 约定

- 每个脚本对应一个模块或一次 todo 任务的验证，文件名用中文或短横线命名，如 `eventLifecycle.mjs`、`msgstore.mjs`。
- 脚本自带清理（测试用的临时数据目录在结束时 `fs.rmSync`），直接 `node tests/<name>.mjs` 运行。
- 不用的脚本可以留着，空了统一删；不要散落在根目录。
- 不是正式测试框架，不跑 CI，纯本地调试用。

## 已有脚本

（按任务顺序）

| 文件 | 测试内容 |
|---|---|
| `eventLifecycle.mjs` | 活动创建→确认、权限、join 引导、删除确认 |
| `profileStore-gender.mjs` | 性别字段注入与 formatProfileForPrompt |
| `profileStore-schema.mjs` | createEmptyProfile 字段完整性 |
| `messageStore.mjs` | sqlite 写入、群过滤、关键词、limit、source |
