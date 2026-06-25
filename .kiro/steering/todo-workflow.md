# Todo 自驱工作流

> 自动加载。当用户说「继续 / 做下一个 / 按 todo 做」时，按本流程自驱执行，无需逐步追问。
> 配合 `project-guidelines.md`（LLM vs 代码、隐私红线、工作方式）一起用。

## todo 在哪、怎么组织

- 根目录 `todo/`，`todo/README.md` 是索引（总览 + 各任务链接 + 编辑约定）。
- 按「优先级-主题」分子目录：前缀 `0-` 红线最先，`1-` 常规，`2-` 锦上添花。
- 每个任务一个 `.md`，结构：`背景 / 现状 / 待办(checklist) / 注意点`。
- `todo/done/` 沉淀已完成任务，不删，方便回看演进。

## 单个任务的执行循环（DoD = 完成定义）

1. **选取**：读 `todo/README.md`，挑优先级最高、未勾选的任务（同级按列表顺序）。一次只做一个，做完再下一个。
2. **读全**：打开该任务 md，读懂 `待办 / 注意点`；按需用 context-gatherer 或直接读相关源码，别凭记忆改。
3. **判型**：按 `project-guidelines` 的「LLM vs 代码」原则决定实现方式，权限/隐私/状态机一律代码兜底。
4. **实现**：复用既有约定（sqlite 仿 `feedbackStore.js`；回复走 `throttledSay`；配置进 `getWechatRuntimeConfig` + env 开关给安全默认值；错误走 `errorStore.logError`）。注释/回复用中文。
5. **验证**（必做，缺一不可）：
   - `node --check <改动的每个文件>` 过语法。
   - 对有确定性逻辑的改动（权限、状态机、解析、隔离），写最小运行验证，存到 `tests/<模块名>.mjs`，`node tests/<name>.mjs` 运行，通过后留档（不要放根目录，不要临时创建再删）。
   - 不臆测「应该能跑」；跑不了要说明原因（如缺 API key、需真实微信环境）。
6. **记录**（完成后立即做，保持 tracker 诚实）：
   - 在任务 md 末尾追加 `## 完成记录`：`- YYYY-MM-DD：改了什么、怎么验证的`。
   - `git mv` 该 md 到 `todo/done/`（文件已被 git 跟踪时用 git mv；未跟踪用普通移动）。
   - 更新 `todo/README.md`：对应条目从 `[ ]` 勾成 `[x]`，并把链接指向 `done/`（或挪到 Done 区）。
7. **报告**：一两句说清做了什么、怎么验证、下一个是谁。不逐文件复述。

## 选取与协作约定

- 任务多时**一个一个做，别一起做**（用户明确要求过）。
- 调研类任务（如「DeepSeek 对话优化」「复用画像库」「小红书/两步路」）产出是**调研结论 + 取舍建议**，落进任务 md 的 `## 调研结论`，需要外部 API key / 合规确认时先停下问用户。
- 涉及外部依赖（装包、外部 API、改动 live 资源）先说明再做；破坏性操作要用户确认。
- 私聊 AI 已关闭，不为私聊路径投入精力，优先群聊场景。
- 拿不准任务边界或优先级时，按本流程先做最稳妥的一步，并在报告里点明假设。

## 可用验证命令

- 语法：`node --check <file>`
- 分析模块自测：`npm run test:analysis`
- 消息测试：`npm run test`
- 格式化：`npm run format`（提交时 husky + lint-staged 会自动 prettier）

## 日常巡检（一键运维）

用户发「巡检」（或在 Agent Hooks 面板点 daily-maintenance）→ hook 注入指令 → 按
`.kiro/steering/daily-maintenance.md` 的流程自驱执行：查 bug（`logs/errors.jsonl`）→ 看今天各群聊天（`scripts/db.mjs`）→ 活动流程 → 画像更新与脏数据巡查 → 小步优化 → 中文简报。
触发词：巡检 / 日常维护 / 日常运维 / xunjian。
