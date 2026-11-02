# 互动剧情创作与试玩验证平台 · 集成阶段 2026-11-02

本阶段已经接通真实数据库：**创作 → 保存 → 检查 → 固定版本发布 → 试玩 → 存档 → 原版本新分支恢复**。M1 编辑器、M2 玩家界面和 M3 检查核心已整合到同一个工程。M4 的公共权限、修订控制、事务、摘要、发布、存档、备份恢复及同源运行方式已实现。

开始开发前读 `handoff/STAGE-20261102.md`，然后读 `handoff/next/M1.md` 至 `M5.md` 中自己的文件。旧 `handoff/documents` HTML 保留为最初设计资料，当前实现状态以本 README、OpenAPI 和新阶段交接单为准。

## 首次运行

要求 Node 22.12+、npm。锁定 Prisma 6.19.0；不要为安装提示直接升级依赖。所有命令在本 README 所在目录执行。

```powershell
npm ci
Copy-Item .env.example .env
# 编辑 .env 的 DEMO_PASSWORD，至少 12 字符；已有 .env 时保留并补字段。
npm run db:generate
npm run db:deploy
npm run db:seed
npm run verify
npm run dev
```

开发页面：`http://localhost:5173/#/author`，API 默认 3001。必须使用与 `.env` 的 `WEB_ORIGIN` 完全一致的地址，localhost 与 127.0.0.1 不混用。演示账号 `creator@example.test`、`player@example.test` 的密码来自第一次 seed 的环境配置。seed 不覆盖已有密码和活动；它只创建虚构测试账号，生产环境禁止 seed。

登录后，从示例一/示例二创建活动，修改正文并保存，检查已保存内容，发布后点“试玩 v1”。两个样例是独立 JSON 内容，并未在引擎中写故事特判。编辑器发生保存错误时保留输入；检查和发布始终针对服务器已保存的修订。

## 构建后的单端口运行

```powershell
npm run build
# 将 .env 的 WEB_ORIGIN 改为 http://localhost:3001
npm start
```

打开 `http://localhost:3001`；API 同时提供 `apps/web/dist` 静态产物。该启动方式已在本机浏览器验证。Node 服务默认仅监听本机。真正对外部署时在 TLS 反向代理后运行，设置 `NODE_ENV=production`、实际 `WEB_ORIGIN`、持久化的数据库和 `MEDIA_ROOT`；Secure Cookie 需要 HTTPS。生产不注册开发 fixture API。公网域名、证书和跨机用户试用尚未交付。

## 数据、规则与接口

| 数据/模块 | 唯一位置与约束 |
|---|---|
| Story / Layout | 独立 JSON；Story 不存画布坐标、玩家进度和 versionId |
| 规则 | `packages/engine` 唯一执行语义；运行器、检查器、后续回放复用 |
| 公共契约 | `packages/contracts`：类型、JSON Schema、OpenAPI、模块 ports |
| 公共基础 | `apps/api/src/infrastructure`：权限、事务、摘要、DTO、素材固定化 |
| M1 | `modules/authoring` + `apps/web/src/author`，只维护活动与草稿 |
| M2 | `modules/player` + `features/player`，权威执行与会话状态 |
| M3 | `engine/src/stateSearch.ts` + `modules/validation`，有限状态检查 |
| M4 | `modules/versions`、`modules/saves`、`scripts/backup*`、部署入口 |
| M5 | `modules/events` 已有写入/回执/有权事件读取；完整回放/反馈/统计待扩展 |

摘要唯一实现为 `infrastructure/core.ts#snapshotDigest`：递归排序对象键，素材按 id 排序，紧凑 UTF-8 JSON `{story,assets}`，SHA-256 小写 64 位十六进制，无前缀。Layout 和玩家状态不参与。

`PublishedVersion` 固定保存 Story 与素材清单。修改草稿不会修改旧版本。素材源路径在目录登记，发布时校验内容哈希并复制为 `data/media/<hash>`，版本清单使用 `/api/v1/media/<hash>`。当前预置目录为空，纯文字流程可完整使用；媒体选择和播放 UI 留给后续增强。

服务端根据 Cookie 确认 actorId，前端不可指定 ownerId/playerId/state。写请求校验 Origin。`expectedRevision` 防止草稿覆盖，`expectedSeq` 防止进度覆盖，`requestId` 提供幂等。状态、事件及操作回执共用同一 Prisma 事务；事件失败必须向上抛出。SQLite 首版按单服务进程运行，公共队列串行化本进程写入，数据库条件更新与唯一约束仍保护独立客户端竞争。尚未承诺生产压测吞吐量。

限制集中于 contracts：20 节点、8 个布尔变量、每节点 12 选择、6000 状态/5000ms 检查预算、会话 500 次有效选择、列表 100 项；超限明确拒绝，不静默截断。

## 备份与恢复

```powershell
# backups 父目录先创建；out 必须是尚不存在的新目录。
New-Item -ItemType Directory backups -ErrorAction SilentlyContinue
npm run backup -- --out backups/stage-20261102
# restored 父目录先创建；to 也必须是新目录，不覆盖现有数据库。
New-Item -ItemType Directory restored -ErrorAction SilentlyContinue
npm run restore -- --from backups/stage-20261102 --to restored/check-20261102
# 停止当前 API 服务后，以脚本输出的 restore.env 路径启动：
npm start -- --env restored/check-20261102/restore.env
```

备份使用 SQLite `VACUUM INTO` 生成一致快照，再按快照中版本引用复制不可变素材，最后写 manifest 完成标记。恢复前校验数据库和每份素材哈希；既有目标目录明确拒绝。失败且没有 manifest 的备份不可用。恢复到新目录后先验收，再切换配置；原数据库始终保留。恢复文件包含账号与历史记录，按私有数据保管，不提交 Git 或群发。生产恢复的域名/TLS/NODE_ENV 配置需沿用实际环境。

## 当前验证与下一阶段

`npm run verify` 执行类型检查、Vitest、事件样例一致性、OpenAPI 引用/样例及前端构建。阶段共 **72 项测试**（原 43 项 + 新增集成 29 项）。新增测试含真实 HTTP 响应与 OpenAPI 对照、并发、事务故障注入、版本不变、原版恢复和备份重建；所有测试使用独立临时数据库。

`handoff/evidence` 保存本阶段日志、测试报告和浏览器截图。自动化结果是本机证据；组员电脑复验、真实用户试用、全组实名互审仍由团队补齐，不能仅用测试数宣告课程所有门禁通过。

下一阶段主线是 **M5 的规则回放 → 节点反馈 → 按版本统计**；其他成员基于已接通的接口继续完善各自模块。不要回到旧分支重建后端或再复制旧 starter。完整下一步任务、交接条件见 `handoff/next`。
