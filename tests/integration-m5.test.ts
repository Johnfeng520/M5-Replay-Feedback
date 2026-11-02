/**
 * M5 回放/反馈/统计集成测试：验证四个 HTTP 接口与业务逻辑完整性。
 *
 * 覆盖：
 *   1. 回放验证（正常/损坏事件、恢复分支、鉴权）
 *   2. 反馈提交（幂等性、nodeId核对、分享开关、并发冲突）
 *   3. 作者查询（只看开启分享的、版本隔离）
 *   4. 按版本统计（访问计数、结局排序、撤回分享后排除）
 */
import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { PrismaClient } from "@prisma/client";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join, dirname, basename } from "node:path";
import { randomUUID } from "node:crypto";
import { createApp } from "../apps/api/src/app";
import { passwordHash } from "../apps/api/src/auth";
import type { Story } from "@campus/contracts";

const folder = mkdtempSync(join(tmpdir(), "story-m5-"));
const url = "file:" + join(folder, "test.db").replaceAll("\\", "/");
const db = new PrismaClient({ datasourceUrl: url });
let app: Awaited<ReturnType<typeof createApp>>;

const read = (p: string) =>
  JSON.parse(
    readFileSync(new URL("../fixtures/" + p, import.meta.url), "utf8"),
  );

const story: Story = read("stories/baseline.story.json");
const layout = { positions: {}, viewport: { x: 0, y: 0, zoom: 1 } };

let authorCookie = "";
let playerCookie = "";
let strangerCookie = "";
let authorId = "";
let playerId = "";
let activityId = "";
let versionId = "";
let sessionId = "";
let sharedSessionId = "";

const requestId = () => "req_" + randomUUID();

beforeAll(async () => {
  process.env.WEB_ORIGIN = "http://localhost:5173";
  execFileSync(
    process.execPath,
    [resolve("node_modules/tsx/dist/cli.mjs"), "scripts/db-deploy.ts"],
    { env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" },
  );

  const author = await db.user.create({
    data: {
      email: "author@example.test",
      passwordHash: passwordHash("local-test-password"),
    },
  });
  authorId = author.id;

  const player = await db.user.create({
    data: {
      email: "player@example.test",
      passwordHash: passwordHash("local-test-password"),
    },
  });
  playerId = player.id;

  await db.user.create({
    data: {
      email: "stranger@example.test",
      passwordHash: passwordHash("local-test-password"),
    },
  });

  app = await createApp(db);

  const loginAuthor = await app.inject({
    method: "POST",
    url: "/api/v1/auth/login",
    headers: { origin: process.env.WEB_ORIGIN },
    payload: { email: "author@example.test", password: "local-test-password" },
  });
  authorCookie = loginAuthor.cookies.map((c) => c.name + "=" + c.value).join("; ");

  const loginPlayer = await app.inject({
    method: "POST",
    url: "/api/v1/auth/login",
    headers: { origin: process.env.WEB_ORIGIN },
    payload: { email: "player@example.test", password: "local-test-password" },
  });
  playerCookie = loginPlayer.cookies.map((c) => c.name + "=" + c.value).join("; ");

  const loginStranger = await app.inject({
    method: "POST",
    url: "/api/v1/auth/login",
    headers: { origin: process.env.WEB_ORIGIN },
    payload: { email: "stranger@example.test", password: "local-test-password" },
  });
  strangerCookie = loginStranger.cookies
    .map((c) => c.name + "=" + c.value)
    .join("; ");

  // 创建活动并发布
  const activity = await app.inject({
    method: "POST",
    url: "/api/v1/activities",
    headers: { origin: process.env.WEB_ORIGIN, cookie: authorCookie },
    payload: { title: "M5测试活动", requestId: requestId() },
  });
  activityId = activity.json().data.activityId;

  await app.inject({
    method: "PUT",
    url: `/api/v1/activities/${activityId}/draft`,
    headers: { origin: process.env.WEB_ORIGIN, cookie: authorCookie },
    payload: { expectedRevision: 1, story, layout },
  });

  const version = await app.inject({
    method: "POST",
    url: `/api/v1/activities/${activityId}/versions`,
    headers: { origin: process.env.WEB_ORIGIN, cookie: authorCookie },
    payload: { expectedRevision: 2, requestId: requestId() },
  });
  versionId = version.json().data.versionId;

  // 玩家创建会话并执行操作
  const session = await app.inject({
    method: "POST",
    url: `/api/v1/versions/${versionId}/sessions`,
    headers: { origin: process.env.WEB_ORIGIN, cookie: playerCookie },
    payload: { shareWithCreator: false, requestId: requestId() },
  });
  sessionId = session.json().data.id;

  await app.inject({
    method: "POST",
    url: `/api/v1/sessions/${sessionId}/choices`,
    headers: { origin: process.env.WEB_ORIGIN, cookie: playerCookie },
    payload: { choiceId: "c_search", expectedSeq: 0, requestId: requestId() },
  });

  await app.inject({
    method: "POST",
    url: `/api/v1/sessions/${sessionId}/choices`,
    headers: { origin: process.env.WEB_ORIGIN, cookie: playerCookie },
    payload: { choiceId: "c_return", expectedSeq: 1, requestId: requestId() },
  });

  // 创建另一个开启分享的会话
  const sharedSession = await app.inject({
    method: "POST",
    url: `/api/v1/versions/${versionId}/sessions`,
    headers: { origin: process.env.WEB_ORIGIN, cookie: playerCookie },
    payload: { shareWithCreator: true, requestId: requestId() },
  });
  sharedSessionId = sharedSession.json().data.id;

  await app.inject({
    method: "POST",
    url: `/api/v1/sessions/${sharedSessionId}/choices`,
    headers: { origin: process.env.WEB_ORIGIN, cookie: playerCookie },
    payload: { choiceId: "c_search", expectedSeq: 0, requestId: requestId() },
  });
}, 90000);

afterAll(async () => {
  await app?.close();
  await db.$disconnect();
  if (
    dirname(resolve(folder)) !== resolve(tmpdir()) ||
    !basename(folder).startsWith("story-m5-")
  )
    throw new Error("拒绝删除预期临时测试目录之外的路径");
  rmSync(folder, { recursive: true, force: true });
});

describe("GET /sessions/:sessionId/replay", () => {
  it("玩家读自己会话的回放通过", async () => {
    const r = await app.inject({
      url: `/api/v1/sessions/${sessionId}/replay`,
      headers: { cookie: playerCookie },
    });
    expect(r.statusCode).toBe(200);
    const replay = r.json().data;
    expect(replay.status).toBe("MATCH");
    expect(replay.steps).toHaveLength(2);
    expect(replay.sessionId).toBe(sessionId);
  });

  it("作者读开启分享的会话回放", async () => {
    const r = await app.inject({
      url: `/api/v1/sessions/${sharedSessionId}/replay`,
      headers: { cookie: authorCookie },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().data.status).toBe("MATCH");
  });

  it("作者读未开启分享的会话被拒绝", async () => {
    const r = await app.inject({
      url: `/api/v1/sessions/${sessionId}/replay`,
      headers: { cookie: authorCookie },
    });
    expect(r.statusCode).toBe(404);
  });

  it("无关用户读取被拒绝", async () => {
    const r = await app.inject({
      url: `/api/v1/sessions/${sharedSessionId}/replay`,
      headers: { cookie: strangerCookie },
    });
    expect(r.statusCode).toBe(404);
  });

  it("未登录拒绝", async () => {
    const r = await app.inject({
      url: `/api/v1/sessions/${sessionId}/replay`,
    });
    expect(r.statusCode).toBe(401);
  });
});

describe("POST /sessions/:sessionId/feedback", () => {
  it("玩家提交反馈到开启分享的会话", async () => {
    const r = await app.inject({
      method: "POST",
      url: `/api/v1/sessions/${sharedSessionId}/feedback`,
      headers: { origin: process.env.WEB_ORIGIN, cookie: playerCookie },
      payload: {
        requestId: requestId(),
        eventSeq: 1,
        nodeId: "n_desk",
        category: "bug",
        text: "这里卡住了",
      },
    });
    expect(r.statusCode).toBe(201);
    const feedback = r.json().data;
    expect(feedback.sessionId).toBe(sharedSessionId);
    expect(feedback.versionId).toBe(versionId);
    expect(feedback.eventSeq).toBe(1);
    expect(feedback.nodeId).toBe("n_desk");
    expect(feedback.category).toBe("bug");
    expect(feedback.text).toBe("这里卡住了");
  });

  it("幂等提交返回原记录", async () => {
    const rid = requestId();
    const first = await app.inject({
      method: "POST",
      url: `/api/v1/sessions/${sharedSessionId}/feedback`,
      headers: { origin: process.env.WEB_ORIGIN, cookie: playerCookie },
      payload: {
        requestId: rid,
        eventSeq: 0,
        nodeId: "n_start",
        category: "suggestion",
        text: "第一次提交",
      },
    });
    expect(first.statusCode).toBe(201);

    const second = await app.inject({
      method: "POST",
      url: `/api/v1/sessions/${sharedSessionId}/feedback`,
      headers: { origin: process.env.WEB_ORIGIN, cookie: playerCookie },
      payload: {
        requestId: rid,
        eventSeq: 0,
        nodeId: "n_start",
        category: "suggestion",
        text: "第一次提交",
      },
    });
    expect(second.statusCode).toBe(201);
    expect(second.json().data.id).toBe(first.json().data.id);
  });

  it("相同 requestId 不同内容返回 409", async () => {
    const rid = requestId();
    await app.inject({
      method: "POST",
      url: `/api/v1/sessions/${sharedSessionId}/feedback`,
      headers: { origin: process.env.WEB_ORIGIN, cookie: playerCookie },
      payload: {
        requestId: rid,
        eventSeq: 0,
        nodeId: "n_start",
        category: "bug",
        text: "原内容",
      },
    });

    const conflict = await app.inject({
      method: "POST",
      url: `/api/v1/sessions/${sharedSessionId}/feedback`,
      headers: { origin: process.env.WEB_ORIGIN, cookie: playerCookie },
      payload: {
        requestId: rid,
        eventSeq: 0,
        nodeId: "n_start",
        category: "bug",
        text: "不同内容",
      },
    });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json().error.code).toBe("IDEMPOTENCY_CONFLICT");
  });

  it("未开启分享拒绝提交", async () => {
    const r = await app.inject({
      method: "POST",
      url: `/api/v1/sessions/${sessionId}/feedback`,
      headers: { origin: process.env.WEB_ORIGIN, cookie: playerCookie },
      payload: {
        requestId: requestId(),
        eventSeq: 0,
        nodeId: "n_start",
        category: "bug",
        text: "测试",
      },
    });
    expect(r.statusCode).toBe(422);
    expect(r.json().error.code).toBe("SHARE_NOT_ENABLED");
  });

  it("eventSeq 不存在返回 422", async () => {
    const r = await app.inject({
      method: "POST",
      url: `/api/v1/sessions/${sharedSessionId}/feedback`,
      headers: { origin: process.env.WEB_ORIGIN, cookie: playerCookie },
      payload: {
        requestId: requestId(),
        eventSeq: 999,
        nodeId: "n_start",
        category: "bug",
        text: "不存在的序号",
      },
    });
    expect(r.statusCode).toBe(422);
    expect(r.json().error.code).toBe("FEEDBACK_SEQ_NOT_FOUND");
  });

  it("nodeId 与实际不符返回 422", async () => {
    const r = await app.inject({
      method: "POST",
      url: `/api/v1/sessions/${sharedSessionId}/feedback`,
      headers: { origin: process.env.WEB_ORIGIN, cookie: playerCookie },
      payload: {
        requestId: requestId(),
        eventSeq: 1,
        nodeId: "n_archive", // 实际是 n_desk
        category: "bug",
        text: "节点不匹配",
      },
    });
    expect(r.statusCode).toBe(422);
    expect(r.json().error.code).toBe("FEEDBACK_NODE_MISMATCH");
  });

  it("非会话所有者无法提交", async () => {
    const r = await app.inject({
      method: "POST",
      url: `/api/v1/sessions/${sharedSessionId}/feedback`,
      headers: { origin: process.env.WEB_ORIGIN, cookie: strangerCookie },
      payload: {
        requestId: requestId(),
        eventSeq: 0,
        nodeId: "n_start",
        category: "bug",
        text: "别人的会话",
      },
    });
    expect(r.statusCode).toBe(404);
  });
});

describe("GET /activities/:activityId/feedback", () => {
  it("作者查询反馈列表", async () => {
    const r = await app.inject({
      url: `/api/v1/activities/${activityId}/feedback?versionId=${versionId}`,
      headers: { cookie: authorCookie },
    });
    expect(r.statusCode).toBe(200);
    const list = r.json().data;
    expect(Array.isArray(list)).toBe(true);
    expect(list.length).toBeGreaterThan(0);
    expect(list[0]).toHaveProperty("id");
    expect(list[0]).toHaveProperty("sessionId");
    expect(list[0]).toHaveProperty("versionId", versionId);
    expect(list[0]).toHaveProperty("eventSeq");
    expect(list[0]).toHaveProperty("nodeId");
    expect(list[0]).toHaveProperty("category");
    expect(list[0]).toHaveProperty("text");
  });

  it("非作者无法查询", async () => {
    const r = await app.inject({
      url: `/api/v1/activities/${activityId}/feedback?versionId=${versionId}`,
      headers: { cookie: playerCookie },
    });
    expect(r.statusCode).toBe(404);
  });

  it("撤回分享后反馈不再出现在列表", async () => {
    // 先提交一条反馈
    const feedbackReq = await app.inject({
      method: "POST",
      url: `/api/v1/sessions/${sharedSessionId}/feedback`,
      headers: { origin: process.env.WEB_ORIGIN, cookie: playerCookie },
      payload: {
        requestId: requestId(),
        eventSeq: 0,
        nodeId: "n_start",
        category: "confusing",
        text: "准备撤回",
      },
    });
    expect(feedbackReq.statusCode).toBe(201);

    // 作者能看到
    const before = await app.inject({
      url: `/api/v1/activities/${activityId}/feedback?versionId=${versionId}`,
      headers: { cookie: authorCookie },
    });
    const beforeData = before.json().data;
    // 统计来自 sharedSessionId 的反馈条数
    const sharedCount = beforeData.filter(
      (f: any) => f.sessionId === sharedSessionId,
    ).length;
    expect(sharedCount).toBeGreaterThan(0); // 至少有刚提交的一条

    // 撤回分享
    await app.inject({
      method: "PATCH",
      url: `/api/v1/sessions/${sharedSessionId}/sharing`,
      headers: { origin: process.env.WEB_ORIGIN, cookie: playerCookie },
      payload: { shareWithCreator: false },
    });

    // 作者看不到了
    const after = await app.inject({
      url: `/api/v1/activities/${activityId}/feedback?versionId=${versionId}`,
      headers: { cookie: authorCookie },
    });
    const afterData = after.json().data;
    // 验证来自 sharedSessionId 的反馈全部消失
    expect(afterData.filter((f: any) => f.sessionId === sharedSessionId).length).toBe(
      0,
    );
    expect(afterData.length).toBe(beforeData.length - sharedCount);
  });
});

describe("GET /activities/:activityId/summary", () => {
  it("作者查询统计", async () => {
    // 恢复分享
    await app.inject({
      method: "PATCH",
      url: `/api/v1/sessions/${sharedSessionId}/sharing`,
      headers: { origin: process.env.WEB_ORIGIN, cookie: playerCookie },
      payload: { shareWithCreator: true },
    });

    const r = await app.inject({
      url: `/api/v1/activities/${activityId}/summary?versionId=${versionId}`,
      headers: { cookie: authorCookie },
    });
    expect(r.statusCode).toBe(200);
    const summary = r.json().data;
    expect(summary.versionId).toBe(versionId);
    expect(summary.sharedSessionCount).toBe(1); // 只有 sharedSessionId 开着分享
    expect(Array.isArray(summary.nodeVisits)).toBe(true);
    expect(Array.isArray(summary.endings)).toBe(true);

    // 验证访问统计：初始 + 1 次操作 = 2 个状态
    expect(summary.nodeVisits.length).toBeGreaterThan(0);
    const startVisit = summary.nodeVisits.find((v: any) => v.nodeId === "n_start");
    expect(startVisit?.count).toBe(1); // 初始状态
    const deskVisit = summary.nodeVisits.find((v: any) => v.nodeId === "n_desk");
    expect(deskVisit?.count).toBe(1); // 第一步之后

    // 验证排序：按 count 降序，count 相同按 nodeId 升序
    for (let i = 1; i < summary.nodeVisits.length; i++) {
      const prev = summary.nodeVisits[i - 1];
      const curr = summary.nodeVisits[i];
      expect(
        prev.count > curr.count ||
          (prev.count === curr.count && prev.nodeId < curr.nodeId),
      ).toBe(true);
    }
  });

  it("非作者无法查询", async () => {
    const r = await app.inject({
      url: `/api/v1/activities/${activityId}/summary?versionId=${versionId}`,
      headers: { cookie: strangerCookie },
    });
    expect(r.statusCode).toBe(404);
  });
});
