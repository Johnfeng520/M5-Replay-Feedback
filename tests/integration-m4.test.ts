import { beforeAll, afterAll, it, expect, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { writeFile, readFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, dirname, basename } from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { createApp } from "../apps/api/src/app";
import { passwordHash } from "../apps/api/src/auth";
import { authoringService } from "../apps/api/src/modules/authoring";
import {
  validationService,
  snapshotDigestOf,
} from "../apps/api/src/modules/validation/service";
import { versionService, loadVersion } from "../apps/api/src/modules/versions";
import { playerService } from "../apps/api/src/modules/player";
import { saveService } from "../apps/api/src/modules/saves";
import { appendEvent } from "../apps/api/src/modules/events";
import { snapshotDigest, transact } from "../apps/api/src/infrastructure/core";
import { validateStory } from "@campus/engine";
import type {
  Story,
  Asset,
  Session,
  PublishedSnapshot,
} from "@campus/contracts";
import { backup, restore } from "../scripts/backup-lib";
import { registerStatic } from "../apps/api/src/infrastructure/static";
import { captureAssets } from "../apps/api/src/infrastructure/assets";
import Fastify from "fastify";
import type { HTTPMethods } from "fastify";
import Ajv from "ajv";
import contract from "../packages/contracts/openapi.json";

const folder = mkdtempSync(join(tmpdir(), "story-m4-"));
const url = "file:" + join(folder, "test.db").replaceAll("\\", "/");
const db = new PrismaClient({ datasourceUrl: url });
const read = (name: string) =>
  JSON.parse(
    readFileSync(new URL("../fixtures/" + name, import.meta.url), "utf8"),
  );
const story: Story = read("stories/baseline.story.json"),
  layout = read("stories/baseline.layout.json");
const author = authoringService(db),
  versions = versionService(db),
  player = playerService(db),
  saves = saveService(db);
let a: string, b: string, c: string, ac: string, bc: string, cc: string;
let app: Awaited<ReturnType<typeof createApp>>;
const requestId = () => randomUUID();
const request = async (
  method: HTTPMethods,
  path: string,
  payload?: Record<string, unknown>,
  cookie = ac,
) =>
  app.inject({
    method,
    url: "/api/v1" + path,
    headers: { origin: process.env.WEB_ORIGIN, cookie },
    payload,
  });
async function prepared(content: Story = story) {
  const draft: any = await author.create(a, {
    title: content.title,
    requestId: requestId(),
  });
  return author.save(a, draft.activityId, {
    expectedRevision: 1,
    story: content,
    layout,
  });
}
async function published() {
  const d = await prepared();
  return versions.publish(a, d.activityId, {
    expectedRevision: d.revision,
    requestId: requestId(),
  });
}
const session = (v: PublishedSnapshot, who = b) =>
  player.createSession({
    versionId: v.versionId,
    playerId: who,
    requestId: requestId(),
    shareWithCreator: false,
  });
const choose = (
  s: Session,
  choiceId: string,
  expectedSeq = s.seq,
  id = requestId(),
) =>
  player.executeChoice({
    sessionId: s.id,
    playerId: s.playerId,
    choiceId,
    expectedSeq,
    requestId: id,
  });
beforeAll(async () => {
  process.env.WEB_ORIGIN = "http://localhost:5173";
  execFileSync(
    process.execPath,
    [resolve("node_modules/tsx/dist/cli.mjs"), "scripts/db-deploy.ts"],
    { env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" },
  );
  const ids = [];
  for (const email of ["a@example.test", "b@example.test", "c@example.test"])
    ids.push(
      (
        await db.user.create({
          data: { email, passwordHash: passwordHash("local-test-password") },
        })
      ).id,
    );
  [a, b, c] = ids;
  app = await createApp(db);
  const cookies = [];
  for (const email of ["a@example.test", "b@example.test", "c@example.test"]) {
    const r = await request(
      "POST",
      "/auth/login",
      { email, password: "local-test-password" },
      "",
    );
    expect(r.statusCode).toBe(200);
    cookies.push(r.cookies.map((x) => x.name + "=" + x.value).join("; "));
  }
  [ac, bc, cc] = cookies;
}, 90000);
afterAll(async () => {
  await app?.close();
  await db.$disconnect();
  if (
    dirname(resolve(folder)) !== resolve(tmpdir()) ||
    !basename(folder).startsWith("story-m4-")
  )
    throw new Error("临时目录不合法");
  rmSync(folder, { recursive: true, force: true });
});

it("真实 HTTP：创作、保存重载、检查与发布贯通，摘要一致", async () => {
  const r = await request("POST", "/activities", {
    title: "接口创建",
    requestId: requestId(),
  });
  expect(r.statusCode).toBe(201);
  const d = r.json().data;
  const saved = await request("PUT", `/activities/${d.activityId}/draft`, {
    expectedRevision: 1,
    story,
    layout,
  });
  expect(saved.statusCode).toBe(200);
  expect(saved.json().data.revision).toBe(2);
  expect(
    (await request("GET", `/activities/${d.activityId}/draft`)).json().data
      .story,
  ).toEqual(story);
  const check = await request("POST", `/activities/${d.activityId}/checks`, {
    expectedRevision: 2,
  });
  expect(check.statusCode).toBe(200);
  expect(check.json().data.publishable).toBe(true);
  const publish = await request(
    "POST",
    `/activities/${d.activityId}/versions`,
    { expectedRevision: 2, requestId: requestId() },
  );
  expect(publish.statusCode).toBe(201);
  expect(publish.json().data.snapshotDigest).toBe(
    check.json().data.snapshotDigest,
  );
  expect(
    (
      await request(
        "GET",
        `/versions/${publish.json().data.versionId}`,
        undefined,
        bc,
      )
    ).json().data.story,
  ).toEqual(story);
});
it("真实 HTTP 响应符合共享 OpenAPI，覆盖各模块交接的数据结构", async () => {
  const ajv = new Ajv({ strict: false, validateFormats: false });
  ajv.addSchema({ $id: "urn:campus:stage", components: contract.components });
  const check = async (
    method: HTTPMethods,
    route: string,
    path: string,
    payload?: Record<string, unknown>,
    cookie = ac,
  ) => {
    const response = await request(method, path, payload, cookie);
    expect(response.statusCode).toBeLessThan(300);
    const schema = (contract.paths as any)["/api/v1" + route][
      method.toLowerCase()
    ].responses[String(response.statusCode)].content?.["application/json"]
      .schema;
    if (schema) {
      const validate = ajv.compile({
        components: contract.components,
        ...schema,
      });
      expect(
        validate(response.json()),
        method + " " + path + " " + JSON.stringify(validate.errors),
      ).toBe(true);
    }
    return response.statusCode === 204 ? null : response.json().data;
  };
  await check("GET", "/health", "/health");
  await check("GET", "/auth/me", "/auth/me");
  await check("GET", "/assets", "/assets");
  const d = await check("POST", "/activities", "/activities", {
    title: "契约对接",
    requestId: requestId(),
  });
  await check(
    "PUT",
    "/activities/{activityId}/draft",
    `/activities/${d.activityId}/draft`,
    { expectedRevision: 1, story, layout },
  );
  await check(
    "GET",
    "/activities/{activityId}/draft",
    `/activities/${d.activityId}/draft`,
  );
  await check(
    "POST",
    "/activities/{activityId}/checks",
    `/activities/${d.activityId}/checks`,
    { expectedRevision: 2 },
  );
  const v = await check(
    "POST",
    "/activities/{activityId}/versions",
    `/activities/${d.activityId}/versions`,
    { expectedRevision: 2, requestId: requestId() },
  );
  await check("GET", "/activities", "/activities");
  await check(
    "GET",
    "/activities/{activityId}/versions",
    `/activities/${d.activityId}/versions`,
  );
  await check("GET", "/versions/{versionId}", `/versions/${v.versionId}`);
  const s = await check(
    "POST",
    "/versions/{versionId}/sessions",
    `/versions/${v.versionId}/sessions`,
    { shareWithCreator: false, requestId: requestId() },
    bc,
  );
  await check(
    "GET",
    "/sessions/{sessionId}",
    `/sessions/${s.id}`,
    undefined,
    bc,
  );
  await check(
    "POST",
    "/sessions/{sessionId}/choices",
    `/sessions/${s.id}/choices`,
    { choiceId: "c_search", expectedSeq: 0, requestId: requestId() },
    bc,
  );
  await check(
    "GET",
    "/sessions/{sessionId}/events",
    `/sessions/${s.id}/events`,
    undefined,
    bc,
  );
  await check(
    "PATCH",
    "/sessions/{sessionId}/sharing",
    `/sessions/${s.id}/sharing`,
    { shareWithCreator: true },
    bc,
  );
  const save = await check(
    "POST",
    "/sessions/{sessionId}/saves",
    `/sessions/${s.id}/saves`,
    { expectedSeq: 1, requestId: requestId(), label: "契约" },
    bc,
  );
  await check("GET", "/saves", "/saves", undefined, bc);
  await check(
    "POST",
    "/saves/{saveId}/restores",
    `/saves/${save.id}/restores`,
    { requestId: requestId(), shareWithCreator: false },
    bc,
  );
});
it("活动创建幂等且同键不同载荷冲突", async () => {
  const input = { title: "唯一活动", requestId: requestId() };
  const one = await author.create(a, input),
    two = await author.create(a, input);
  expect(two).toEqual(one);
  await expect(
    author.create(a, { ...input, title: "另一活动" }),
  ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
});
it("草稿权限隔离、并发修订只允许一次写入", async () => {
  const d = await prepared();
  expect(
    (await request("GET", `/activities/${d.activityId}/draft`, undefined, bc))
      .statusCode,
  ).toBe(404);
  expect(
    (
      await request(
        "PUT",
        `/activities/${d.activityId}/draft`,
        { expectedRevision: d.revision, story, layout },
        bc,
      )
    ).statusCode,
  ).toBe(404);
  const results = await Promise.allSettled(
    ["one", "two"].map((title) =>
      author.save(a, d.activityId, {
        expectedRevision: d.revision,
        story: { ...story, title },
        layout,
      }),
    ),
  );
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(results.find((r) => r.status === "rejected")).toMatchObject({
    reason: { code: "REVISION_CONFLICT" },
  });
  expect((await author.get(a, d.activityId)).revision).toBe(d.revision + 1);
});
it("拒绝伪造 playerId/state 等额外字段和未登录发布", async () => {
  const v = await published(),
    s = await session(v);
  expect(
    (
      await request(
        "POST",
        `/sessions/${s.id}/choices`,
        {
          choiceId: "c_search",
          expectedSeq: 0,
          requestId: requestId(),
          state: {},
          playerId: a,
        },
        bc,
      )
    ).statusCode,
  ).toBe(400);
  expect(
    (
      await request(
        "POST",
        `/activities/${v.activityId}/versions`,
        { expectedRevision: 2, requestId: requestId() },
        "",
      )
    ).statusCode,
  ).toBe(401);
  expect(
    (
      await request(
        "POST",
        `/activities/${v.activityId}/versions`,
        { expectedRevision: 2, requestId: requestId() },
        bc,
      )
    ).statusCode,
  ).toBe(404);
});
it("摘要规范化排序且包含素材，不受对象插入顺序影响", () => {
  const asset = {
    id: "image",
    path: "/api/v1/media/x",
    kind: "background",
    contentHash: "a".repeat(64),
  } as unknown as Asset;
  const reversed = Object.fromEntries(Object.entries(story).reverse()) as Story;
  expect(snapshotDigest(story)).toBe(snapshotDigest(reversed));
  expect(snapshotDigest(story, [asset])).not.toBe(snapshotDigest(story));
  expect(snapshotDigest(story, [asset])).not.toBe(
    snapshotDigest(story, [{ ...asset, contentHash: "b".repeat(64) }]),
  );
  expect(snapshotDigestOf(story, [asset])).toBe(snapshotDigest(story, [asset]));
  expect(snapshotDigest(story)).toMatch(/^[a-f0-9]{64}$/);
});
it("发布素材按内容固定，源文件变更被发现，越界路径被拒绝", async () => {
  const root = join(folder, "assets"),
    storage = join(folder, "fixed-media");
  await mkdir(root);
  const bytes = Buffer.from("image fixture"),
    hash = createHash("sha256").update(bytes).digest("hex");
  await writeFile(join(root, "one.png"), bytes);
  const asset: Asset = {
    id: "bg",
    kind: "background",
    path: "/one.png",
    contentHash: hash,
    license: "test",
    source: "original test bytes",
  };
  const content = structuredClone(story);
  content.nodes[0].media.backgroundId = "bg";
  const manifest = await captureAssets(content, {
    publicRoot: root,
    storageRoot: storage,
    catalog: [asset],
  });
  expect(manifest[0].path).toBe("/api/v1/media/" + hash);
  expect(await readFile(join(storage, hash))).toEqual(bytes);
  await writeFile(join(root, "one.png"), "changed");
  await expect(
    captureAssets(content, {
      publicRoot: root,
      storageRoot: storage,
      catalog: [asset],
    }),
  ).rejects.toMatchObject({ code: "ASSET_INVALID" });
  expect(await readFile(join(storage, hash))).toEqual(bytes);
  await expect(
    captureAssets(content, {
      publicRoot: root,
      storageRoot: storage,
      catalog: [{ ...asset, path: "../test.db" }],
    }),
  ).rejects.toMatchObject({ code: "ASSET_INVALID" });
});
it("发布捕获修订后发生编辑：最终事务拒绝旧候选，不产生版本", async () => {
  const d = await prepared();
  const s = versionService(db, {
    afterCheck: async () => {
      await author.save(a, d.activityId, {
        expectedRevision: d.revision,
        story: { ...story, title: "更新" },
        layout,
      });
    },
  });
  await expect(
    s.publish(a, d.activityId, {
      expectedRevision: d.revision,
      requestId: requestId(),
    }),
  ).rejects.toMatchObject({ code: "REVISION_CONFLICT" });
  expect(
    await db.publishedVersion.count({ where: { activityId: d.activityId } }),
  ).toBe(0);
});
it("发布拒绝真实阻塞剧情、缺失素材和结构错误", async () => {
  for (const content of [
    read("invalid/blocked-state.story.json"),
    read("invalid/missing-target.story.json"),
  ]) {
    const d = await prepared(content);
    await expect(
      versions.publish(a, d.activityId, {
        expectedRevision: d.revision,
        requestId: requestId(),
      }),
    ).rejects.toMatchObject({ code: "PUBLISH_BLOCKED" });
    expect(
      await db.publishedVersion.count({ where: { activityId: d.activityId } }),
    ).toBe(0);
  }
  const content = structuredClone(story);
  content.nodes[0].media.backgroundId = "missing";
  const d = await prepared(content);
  await expect(
    versions.publish(a, d.activityId, {
      expectedRevision: d.revision,
      requestId: requestId(),
    }),
  ).rejects.toMatchObject({ code: "ASSET_INVALID" });
});
it("检查预算耗尽，即使没有问题列表也不能发布", async () => {
  const d = await prepared();
  const s = versionService(db, {
    validate: (content) =>
      validateStory(content, { maxStates: 1, maxTimeMs: 5000 }),
  });
  await expect(
    s.publish(a, d.activityId, {
      expectedRevision: d.revision,
      requestId: requestId(),
    }),
  ).rejects.toMatchObject({
    code: "PUBLISH_BLOCKED",
    details: {
      complete: false,
      publishable: false,
      truncationReason: "STATE_LIMIT",
    },
  });
  expect(
    await db.publishedVersion.count({ where: { activityId: d.activityId } }),
  ).toBe(0);
});
it("时间截断边界可控：刚好预算可继续，超过预算拒绝通过", () => {
  const clock = vi.spyOn(Date, "now");
  try {
    clock.mockReturnValueOnce(1000).mockReturnValue(1005);
    expect(
      validateStory(story, { maxStates: 6000, maxTimeMs: 5 }).complete,
    ).toBe(true);
    clock.mockReset().mockReturnValueOnce(1000).mockReturnValue(1006);
    const r = validateStory(story, { maxStates: 6000, maxTimeMs: 5 });
    expect(r).toMatchObject({
      complete: false,
      publishable: false,
      truncationReason: "TIME_LIMIT",
    });
    expect(
      r.issues.some((i) =>
        ["NO_ENDING_REACHABLE", "ENDING_UNREACHABLE"].includes(i.code),
      ),
    ).toBe(false);
  } finally {
    clock.mockRestore();
  }
});
it("发布幂等回执先于旧修订校验，v2不覆盖v1", async () => {
  const d = await prepared(),
    input = { expectedRevision: d.revision, requestId: requestId() };
  const v1 = await versions.publish(a, d.activityId, input);
  const updated = await author.save(a, d.activityId, {
    expectedRevision: d.revision,
    story: { ...story, title: "新版" },
    layout,
  });
  expect(await versions.publish(a, d.activityId, input)).toEqual(v1);
  await expect(
    versions.publish(a, d.activityId, {
      ...input,
      expectedRevision: updated.revision,
    }),
  ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
  const v2 = await versions.publish(a, d.activityId, {
    expectedRevision: updated.revision,
    requestId: requestId(),
  });
  expect(v2.versionNumber).toBe(2);
  expect(v2.story.title).toBe("新版");
  expect(await transact(db, (tx) => loadVersion(tx, v1.versionId))).toEqual(v1);
});
it("玩家创建幂等，同一版本不同玩家的进度独立", async () => {
  const v = await published(),
    input = {
      versionId: v.versionId,
      playerId: b,
      shareWithCreator: false,
      requestId: requestId(),
    };
  const s = await player.createSession(input);
  expect(await player.createSession(input)).toEqual(s);
  await expect(
    player.createSession({ ...input, shareWithCreator: true }),
  ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
  const other = await session(v, c);
  await choose(s, "c_search");
  expect((await player.getSession(c, other.id)).session.seq).toBe(0);
  expect(
    (await player.getSession(c, other.id)).session.state.values.v_key,
  ).toBe(false);
});
it("服务端条件防作弊，非法选择不改变状态、不写事件", async () => {
  const s = await session(await published());
  expect(
    (
      await request(
        "POST",
        `/sessions/${s.id}/choices`,
        { choiceId: "c_enter", expectedSeq: 0, requestId: requestId() },
        bc,
      )
    ).statusCode,
  ).toBe(422);
  expect((await player.getSession(b, s.id)).session).toEqual(s);
  expect(await db.playEvent.count({ where: { sessionId: s.id } })).toBe(0);
  expect(
    (await request("GET", `/sessions/${s.id}`, undefined, cc)).statusCode,
  ).toBe(404);
});
it("选择重试命中原回执，即使已经前进；同键不同选择拒绝", async () => {
  const s = await session(await published()),
    id = requestId();
  const first = await choose(s, "c_search", 0, id);
  await choose(s, "c_return", 1);
  expect(await choose(s, "c_search", 0, id)).toEqual(first);
  await expect(choose(s, "c_quit", 0, id)).rejects.toMatchObject({
    code: "IDEMPOTENCY_CONFLICT",
  });
  expect((await player.getSession(b, s.id)).session.seq).toBe(2);
  expect(await db.playEvent.count({ where: { sessionId: s.id } })).toBe(2);
});
it("相同 expectedSeq 的并发不同请求只提交一个，状态与事件一致", async () => {
  const s = await session(await published());
  const result = await Promise.allSettled([
    choose(s, "c_search"),
    choose(s, "c_quit"),
  ]);
  expect(result.filter((x) => x.status === "fulfilled")).toHaveLength(1);
  expect(result.find((x) => x.status === "rejected")).toMatchObject({
    reason: { code: "SEQUENCE_CONFLICT" },
  });
  const events = await db.playEvent.findMany({ where: { sessionId: s.id } });
  expect(events).toHaveLength(1);
  expect(events[0].after).toEqual(
    (await player.getSession(b, s.id)).session.state,
  );
});
it("并发同请求只产生一条事件并返回同一回执", async () => {
  const s = await session(await published()),
    id = requestId();
  const results = await Promise.all([
    choose(s, "c_search", 0, id),
    choose(s, "c_search", 0, id),
  ]);
  expect(results[0]).toEqual(results[1]);
  expect(await db.playEvent.count({ where: { sessionId: s.id } })).toBe(1);
});
it("两个独立数据库客户端竞争同一序号，数据库仍只提交一次", async () => {
  const s = await session(await published()),
    second = new PrismaClient({ datasourceUrl: url });
  try {
    const other = playerService(second);
    const result = await Promise.allSettled([
      choose(s, "c_search"),
      other.executeChoice({
        sessionId: s.id,
        playerId: b,
        choiceId: "c_quit",
        expectedSeq: 0,
        requestId: requestId(),
      }),
    ]);
    expect(result.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    const failed = result.find(
      (x) => x.status === "rejected",
    ) as PromiseRejectedResult;
    expect(["SEQUENCE_CONFLICT", "CONCURRENT_WRITE"]).toContain(
      failed.reason.code,
    );
    expect(await db.playEvent.count({ where: { sessionId: s.id } })).toBe(1);
    expect((await player.getSession(b, s.id)).session.seq).toBe(1);
  } finally {
    await second.$disconnect();
  }
}, 45000);
it("事件写入后故障：状态、事件及回执一起回滚，同键重试可成功", async () => {
  const s = await session(await published()),
    id = requestId();
  const broken = playerService(db, {
    appendEvent: async (...args) => {
      await appendEvent(...args);
      throw new Error("故障注入");
    },
  });
  await expect(
    broken.executeChoice({
      sessionId: s.id,
      playerId: b,
      choiceId: "c_search",
      expectedSeq: 0,
      requestId: id,
    }),
  ).rejects.toThrow("故障注入");
  expect((await player.getSession(b, s.id)).session).toEqual(s);
  expect(await db.playEvent.count({ where: { sessionId: s.id } })).toBe(0);
  expect((await choose(s, "c_search", 0, id)).seq).toBe(1);
});
it("完整合法路径与两种结局可实际执行", async () => {
  const v = await published(),
    s = await session(v);
  for (const [i, choice] of [
    "c_search",
    "c_return",
    "c_enter",
    "c_find",
  ].entries())
    await choose(s, choice, i);
  const result = (await player.getSession(b, s.id)).session;
  expect(result.status).toBe("ended");
  expect(result.state.nodeId).toBe("n_good");
  expect(result.state.values.v_key).toBe(false);
  const other = await session(v);
  expect((await choose(other, "c_quit")).status).toBe("ended");
});
it("存档只捕获服务器状态，修订过期拒绝，成功回执可重复读取", async () => {
  const s = await session(await published());
  await choose(s, "c_search");
  await expect(
    saves.createSave(b, s.id, {
      expectedSeq: 0,
      requestId: requestId(),
      label: "旧进度",
    }),
  ).rejects.toMatchObject({ code: "SEQUENCE_CONFLICT" });
  const input = { expectedSeq: 1, requestId: requestId(), label: "桌面" };
  const save = await saves.createSave(b, s.id, input);
  await choose(s, "c_return", 1);
  expect(await saves.createSave(b, s.id, input)).toEqual(save);
  expect(save.state.nodeId).toBe("n_desk");
  expect(save.sourceSeq).toBe(1);
  expect((await saves.list(c)).some((x) => x.id === save.id)).toBe(false);
});
it("发布新版后恢复原版新分支，seq=0、来源明确、不覆盖原会话", async () => {
  const v = await published(),
    s = await session(v);
  await choose(s, "c_search");
  const save = await saves.createSave(b, s.id, {
    expectedSeq: 1,
    requestId: requestId(),
    label: "原版",
  });
  await author.save(a, v.activityId, {
    expectedRevision: v.sourceRevision,
    story: { ...story, title: "新版标题" },
    layout,
  });
  await versions.publish(a, v.activityId, {
    expectedRevision: v.sourceRevision + 1,
    requestId: requestId(),
  });
  await choose(s, "c_return", 1);
  const input = { requestId: requestId(), shareWithCreator: false },
    restored = await saves.restoreSave(b, save.id, input);
  expect(restored.id).not.toBe(s.id);
  expect(restored.versionId).toBe(v.versionId);
  expect(restored.seq).toBe(0);
  expect(restored.initialState).toEqual(save.state);
  expect(restored.source).toEqual({
    saveId: save.id,
    sessionId: s.id,
    eventSeq: 1,
  });
  expect(await saves.restoreSave(b, save.id, input)).toEqual(restored);
  await expect(
    saves.restoreSave(b, save.id, { ...input, shareWithCreator: true }),
  ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
  expect((await player.getSession(b, s.id)).session.seq).toBe(2);
  const next = await choose(restored, "c_return");
  expect(next.seq).toBe(1);
  const event = await db.playEvent.findFirstOrThrow({
    where: { sessionId: restored.id },
  });
  expect(event.before).toEqual(save.state);
});
it("恢复错误权限或损坏状态时拒绝，不产生新分支", async () => {
  const s = await session(await published()),
    save = await saves.createSave(b, s.id, {
      expectedSeq: 0,
      requestId: requestId(),
      label: "校验",
    });
  await expect(
    saves.restoreSave(c, save.id, {
      requestId: requestId(),
      shareWithCreator: false,
    }),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  await db.save.update({
    where: { id: save.id },
    data: { state: { nodeId: "missing", values: {} } },
  });
  const count = await db.playSession.count();
  await expect(
    saves.restoreSave(b, save.id, {
      requestId: requestId(),
      shareWithCreator: false,
    }),
  ).rejects.toMatchObject({ code: "INVALID_STATE" });
  expect(await db.playSession.count()).toBe(count);
});
it("恢复事务的尾部失败，创建的新会话与操作回执一起回滚", async () => {
  const s = await session(await published()),
    save = await saves.createSave(b, s.id, {
      expectedSeq: 0,
      requestId: requestId(),
      label: "回滚",
    }),
    id = requestId();
  const count = await db.playSession.count();
  const broken = saveService(db, {
    beforeReceipt: async () => {
      throw new Error("恢复失败注入");
    },
  });
  await expect(
    broken.restoreSave(b, save.id, { requestId: id, shareWithCreator: false }),
  ).rejects.toThrow("恢复失败注入");
  expect(await db.playSession.count()).toBe(count);
  expect(
    await db.operationReceipt.count({
      where: { kind: "save.restore", scopeId: save.id, requestId: id },
    }),
  ).toBe(0);
  expect(
    (
      await saves.restoreSave(b, save.id, {
        requestId: id,
        shareWithCreator: false,
      })
    ).seq,
  ).toBe(0);
});
it("共享默认关闭，授权后创作者可读取，撤销立即阻止后续读取", async () => {
  const s = await session(await published());
  await choose(s, "c_search");
  const path = `/sessions/${s.id}/events`;
  expect((await request("GET", path)).statusCode).toBe(404);
  expect(
    (
      await request(
        "PATCH",
        `/sessions/${s.id}/sharing`,
        { shareWithCreator: true },
        bc,
      )
    ).statusCode,
  ).toBe(200);
  const shared = await request("GET", path);
  expect(shared.statusCode).toBe(200);
  expect(shared.json().data.events).toHaveLength(1);
  expect(shared.json().data.events[0]).not.toHaveProperty("requestHash");
  expect(shared.json().data.events[0]).not.toHaveProperty("response");
  expect((await request("GET", path, undefined, cc)).statusCode).toBe(404);
  await request(
    "PATCH",
    `/sessions/${s.id}/sharing`,
    { shareWithCreator: false },
    bc,
  );
  expect((await request("GET", path)).statusCode).toBe(404);
  expect((await player.getSession(b, s.id)).session.seq).toBe(1);
});
it("固定版本损坏/规则版本不支持时显式拒绝", async () => {
  const v = await published();
  await db.publishedVersion.update({
    where: { id: v.versionId },
    data: { story: { ...story, title: "篡改" } },
  });
  await expect(session(v)).rejects.toMatchObject({ code: "INVALID_SNAPSHOT" });
  await db.publishedVersion.update({
    where: { id: v.versionId },
    data: { story: { ...story, rulesVersion: "99" } },
  });
  await expect(session(v)).rejects.toMatchObject({
    code: "UNSUPPORTED_VERSION",
  });
  // Fixture fault injection is repaired so backup verification later only sees coherent data.
  await db.publishedVersion.update({
    where: { id: v.versionId },
    data: { story: story as any },
  });
});
it("第二个服务实例从同数据库恢复实际进度，不依赖进程内存", async () => {
  const s = await session(await published());
  await choose(s, "c_search");
  const fresh = new PrismaClient({ datasourceUrl: url });
  const second = await createApp(fresh);
  try {
    const r = await second.inject({
      url: `/api/v1/sessions/${s.id}`,
      headers: { cookie: bc },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().data.session.seq).toBe(1);
    expect(r.json().data.session.state.nodeId).toBe("n_desk");
  } finally {
    await second.close();
    await fresh.$disconnect();
  }
});
it("SQLite 一致备份与新目录恢复保留版本/存档/事件，拒绝覆盖和篡改包", async () => {
  const media = join(folder, "media");
  await mkdir(media);
  // A real immutable media file is included in the snapshot and verified on restore.
  const bytes = Buffer.from("integration-media"),
    hash = createHash("sha256").update(bytes).digest("hex");
  await writeFile(join(media, hash), bytes);
  const v = await published();
  const assets = [
    {
      id: "backup-test",
      path: "/api/v1/media/" + hash,
      kind: "background",
      contentHash: hash,
    },
  ];
  await db.publishedVersion.update({
    where: { id: v.versionId },
    data: { assets, snapshotDigest: snapshotDigest(v.story, assets as any) },
  });
  const s = await session(v);
  await choose(s, "c_search");
  const saved = await saves.createSave(b, s.id, {
    expectedSeq: 1,
    requestId: requestId(),
    label: "备份",
  });
  const source = join(folder, "backup"),
    dest = join(folder, "restored");
  const manifest = await backup(db, media, source);
  expect(manifest.media).toHaveLength(1);
  const restored = await restore(source, dest),
    copy = new PrismaClient({
      datasourceUrl: "file:" + restored.database.replaceAll("\\", "/"),
    });
  try {
    expect((await playerService(copy).getSession(b, s.id)).session.seq).toBe(1);
    expect(
      (
        await saveService(copy).restoreSave(b, saved.id, {
          requestId: requestId(),
          shareWithCreator: false,
        })
      ).initialState,
    ).toEqual(saved.state);
    expect(await copy.playEvent.count({ where: { sessionId: s.id } })).toBe(1);
    expect(await readFile(join(dest, "media", hash))).toEqual(bytes);
  } finally {
    await copy.$disconnect();
  }
  await expect(restore(source, dest)).rejects.toMatchObject({ code: "EEXIST" });
  await writeFile(join(source, "snapshot.db"), "broken");
  await expect(restore(source, join(folder, "broken-restore"))).rejects.toThrow(
    "数据库备份校验失败",
  );
});
it("生产静态目录仅提供构建产物，源代码/配置和未知 API 不会泄漏", async () => {
  const root = join(folder, "public");
  await mkdir(root);
  await writeFile(join(root, "index.html"), "<title>Stage</title>");
  await writeFile(join(folder, ".env"), "PRIVATE");
  const server = Fastify();
  registerStatic(server, root);
  try {
    expect((await server.inject("/")).body).toContain("Stage");
    for (const path of [
      "/api/v1/missing",
      "/.env",
      "/%2e%2e/.env",
      "/apps/api/src/db.ts",
    ])
      expect((await server.inject(path)).statusCode).toBe(404);
  } finally {
    await server.close();
  }
});
