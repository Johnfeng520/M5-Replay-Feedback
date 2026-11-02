# M3 → M4 发布接口：集成阶段有效约定

2026-11-02 起替代原 M3 分支的一页建议；已落地于 validation/versions 服务。

1. 唯一摘要为 `infrastructure/core.ts#snapshotDigest(story,assets)`。输入 `{story,assets}`，递归对象键排序，assets 按 id 排序，其他数组保序，紧凑 UTF-8 JSON，SHA256 小写 64 位 hex，无 `sha256:` 前缀。`validation/service.ts#snapshotDigestOf` 只委托此函数。
2. 检查接口由服务端捕获指定 activity/revision 的 story 与固定素材清单，返回同候选摘要。修订不符返回 409，包含 expected/currentRevision。
3. 发布不信任前端旧报告，也不依赖“最新报告表”。M4 捕获指定修订，调用 M3 的 `validateStory` 检查同一内容；必须 complete=true、publishable=true 且无 error。截断或错误返回 422 PUBLISH_BLOCKED。
4. 检查后，最终事务复核所有者及修订，分配版本号，保存候选内容/素材/摘要/sourceRevision，并写幂等回执。检查期间草稿变化则 409 REVISION_CONFLICT，零版本写入。
5. 同 requestId 同载荷重试返回已发布版本，先命中回执再判过期修订；不同载荷为 409 IDEMPOTENCY_CONFLICT。
6. 当前未新增检查报告表。算法语义仍为 validatorVersion=1.0，预算为6000状态/5000ms。规范化摘要改变属于对原共同契约的统一，不改变状态搜索语义。

测试：`tests/validation-api.test.ts`、`tests/integration-m4.test.ts`，包含独立摘要期望、发布检查绑定、编辑竞争、截断拒绝、旧版本不变与真实 HTTP 对接。
