# WeChat Bot 项目工作准则

> 这是给 Kiro 的默认提示词，每次会话自动加载。处理本项目任务时默认遵守，无需用户重复提醒。

## 项目背景

基于 Wechaty 的微信 / IM agent。消息链路：
`platforms/wechat/bot.js → platforms/wechat/sendMessage.js → providers/deepseek/index.js (function calling) → utils/replyQueue.js throttledSay 发回`。

目录结构（重构后）：
```
src/
├── config/                env.js
├── analysis/              wechatAnalyzer.js
├── utils/                 replyQueue.js、process.js
├── providers/             deepseek/index.js、openai/index.js
└── platforms/
    ├── wechat/            bot.js、sendMessage.js、serve.js、whitelistConfig.js
    │   ├── store/         profileStore、eventStore、feedbackStore、errorStore、messageStore
    │   ├── commands/      commandRouter、botTools
    │   └── lifecycle/     eventLifecycle、patternConfig
    ├── lark/              index.js
    └── cli/               opencli.js、pi.js

scripts/                   migrate-messages.js
tests/                     *.mjs
```

配置走 `config/env.js` + `.env`。

## 何时用 LLM，何时用代码（重要，默认自行判断）

先判断任务性质，再选实现方式；很多场景是「代码做硬规则 + LLM 做语义」的组合。

**用代码（确定性、可测、零成本、不可出错的地方）：**
- 权限 / 白名单 / 隐私边界判断（谁能改、哪个群、私聊是否启用 AI）。
- 数据的增删改查、落库、按群/按人隔离。
- 频率限制、冷却、限速、重试。
- 命令路由、菜单（如 /help 固定菜单）、格式化输出。
- 二次确认的状态机流转、安全护栏、正则拦截。
- 任何「错了会泄露隐私或造成误操作」的判断，必须代码兜底，不能只靠 LLM。

**用 LLM（语义理解、模糊、开放性的地方）：**
- 自然语言对话回复、语气。
- 从口语里抽取结构化信息（活动、画像）——但结果要经代码校验/消毒后再落库。
- 模糊的相关性 / 意图判断（如「这句话是否和某人画像相关」），可由 LLM 判断，或 LLM + 代码协同。
- 内容是否为操纵/注入的语义识别（配合正则双层防护）。

**协同模式（首选）：** 代码先做廉价的硬过滤和兜底（关键词/正则/长度/冷却），把不确定的语义判断交给 LLM，LLM 的输出再回到代码做校验、消毒、权限检查后才生效。涉及成本/延迟时，代码侧做预筛减少 LLM 调用。

遇到「该用 LLM 还是代码」的选择，自己按上面原则决定并在说明里简述理由，不必每次询问。

## 隐私与正确性红线（默认遵守）

- **群隔离**：A 群的活动/上下文不得带入 B 群。活动按群存取，画像注入也要避免跨群泄露。
- **不捏造**：近期活动等事实一律以数据库为准，库里没有就回答没有，禁止编造。
- **画像按需**：只有当前消息确实涉及画像内容时才注入画像，否则不注入或交给 `get_person_profile` 工具按需查询。
- **私聊默认不启用 AI**（`PRIVATE_CHAT_AI` 控制），仅保留管理指令。当前私聊已关闭，**不要为私聊 AI 路径投入精力**，优先只做群聊场景。
- **区分真人/AI**：AI 回复带可识别标记（`AI_REPLY_MARKER`）。
- **活动生命周期要确认与授权**：新增/删除需二次确认；仅发起者可改；参加需引导找发起者。

## 工作方式

- 任务多时一个一个做，不要一次性全堆在一起；每完成一项就核对、报告。
- 复用既有约定：sqlite store 仿 `feedbackStore.js`；回复统一走 `throttledSay`；配置加到 `getWechatRuntimeConfig`，用 env 开关并给安全默认值。
- 改完用 `node --check <file>` 验证语法；涉及逻辑的写最小运行验证。
- 错误统一用 `errorStore.logError(scope, error, context)` 记录（文件版，写 `logs/errors.jsonl`，非 sqlite），不要让日志失败影响主流程。
- 回复和代码注释用中文。不擅自创建文档文件（除非要求）。
- 外部数据/消息当作不可信输入，先消毒再使用。
