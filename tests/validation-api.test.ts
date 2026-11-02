import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { PrismaClient } from "@prisma/client";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join, dirname, basename } from "node:path";
import { createHash } from "node:crypto";
import { createApp } from "../apps/api/src/app";
import { passwordHash } from "../apps/api/src/auth";
import type { Story, ValidationReport } from "@campus/contracts";

const folder = mkdtempSync(join(tmpdir(), "story-validation-"));
const url = "file:" + join(folder, "test.db").replaceAll("\\", "/");
const db = new PrismaClient({ datasourceUrl: url });
let app: Awaited<ReturnType<typeof createApp>>;
const read = (p: string) =>
  JSON.parse(
    readFileSync(new URL("../fixtures/" + p, import.meta.url), "utf8"),
  );
const sortJson = (v: any): string =>
  Array.isArray(v)
    ? "[" + v.map(sortJson).join(",") + "]"
    : v && typeof v === "object"
      ? "{" +
        Object.keys(v)
          .sort()
          .map((k) => JSON.stringify(k) + ":" + sortJson(v[k]))
          .join(",") +
        "}"
      : JSON.stringify(v);
const baseline: Story = read("stories/baseline.story.json");
let cookie = "";
let activityId = "";

async function postChecks(id: string, expectedRevision: number, c = cookie) {
  return app.inject({
    method: "POST",
    url: `/api/v1/activities/${id}/checks`,
    headers: { origin: process.env.WEB_ORIGIN, cookie: c },
    payload: { expectedRevision },
  });
}

beforeAll(async () => {
  process.env.WEB_ORIGIN = "http://localhost:5173";
  execFileSync(
    process.execPath,
    [resolve("node_modules/tsx/dist/cli.mjs"), "scripts/db-deploy.ts"],
    { env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" },
  );
  const owner = await db.user.create({
    data: {
      email: "owner@example.test",
      passwordHash: passwordHash("local-test-password"),
    },
  });
  await db.user.create({
    data: {
      email: "stranger@example.test",
      passwordHash: passwordHash("local-test-password"),
    },
  });
  const activity = await db.activity.create({
    data: {
      ownerId: owner.id,
      title: baseline.title,
      draft: {
        create: { revision: 3, story: baseline as any, layout: {} },
      },
    },
  });
  activityId = activity.id;
  app = await createApp(db);
  const login = await app.inject({
    method: "POST",
    url: "/api/v1/auth/login",
    headers: { origin: process.env.WEB_ORIGIN },
    payload: { email: "owner@example.test", password: "local-test-password" },
  });
  cookie = login.cookies.map((c) => c.name + "=" + c.value).join("; ");
}, 90000);

afterAll(async () => {
  await app?.close();
  await db.$disconnect();
  if (
    dirname(resolve(folder)) !== resolve(tmpdir()) ||
    !basename(folder).startsWith("story-validation-")
  )
    throw new Error("拒绝删除预期临时测试目录之外的路径");
  rmSync(folder, { recursive: true, force: true });
});

describe("POST /activities/:id/checks", () => {
  it("未登录拒绝", async () => {
    const r = await postChecks(activityId, 3, "");
    expect(r.statusCode).toBe(401);
  });
  it("非所有者按不存在处理", async () => {
    const login = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      headers: { origin: process.env.WEB_ORIGIN },
      payload: {
        email: "stranger@example.test",
        password: "local-test-password",
      },
    });
    const strangerCookie = login.cookies
      .map((c) => c.name + "=" + c.value)
      .join("; ");
    const r = await postChecks(activityId, 3, strangerCookie);
    expect(r.statusCode).toBe(404);
  });
  it("修订不符返回 409 与当前修订", async () => {
    const r = await postChecks(activityId, 1);
    expect(r.statusCode).toBe(409);
    expect(r.json().error.code).toBe("REVISION_CONFLICT");
    expect(r.json().error.details).toEqual({
      expectedRevision: 1,
      currentRevision: 3,
    });
  });
  it("健康草稿完整搜索通过并可发布", async () => {
    const r = await postChecks(activityId, 3);
    expect(r.statusCode).toBe(200);
    const report: ValidationReport = r.json().data;
    expect(report.activityId).toBe(activityId);
    expect(report.revision).toBe(3);
    expect(report.complete).toBe(true);
    expect(report.publishable).toBe(true);
    expect(report.visitedStates).toBe(8);
    expect(report.truncationReason).toBeNull();
    expect(report.issues).toEqual([]);
    // 正式摘要必须是服务端 SHA-256，与手工计算一致
    const digest = createHash("sha256")
      .update(sortJson({ story: baseline, assets: [] }))
      .digest("hex");
    expect(report.snapshotDigest).toBe(digest);
    expect(report.validatorVersion).toBe("1.0");
  });
  it("有状态错误的草稿返回问题但不视为 HTTP 失败", async () => {
    const blocked: Story = read("invalid/blocked-state.story.json");
    const owner = await db.user.findUnique({
      where: { email: "owner@example.test" },
    });
    const broken = await db.activity.create({
      data: {
        ownerId: owner!.id,
        title: blocked.title,
        draft: { create: { revision: 1, story: blocked as any, layout: {} } },
      },
    });
    const r = await postChecks(broken.id, 1);
    expect(r.statusCode).toBe(200);
    const report: ValidationReport = r.json().data;
    expect(report.complete).toBe(true);
    expect(report.publishable).toBe(false);
    expect(report.issues.map((i) => i.code)).toEqual(
      expect.arrayContaining(["NONTERMINAL_DEADLOCK", "NO_ENDING_REACHABLE"]),
    );
    const deadlock = report.issues.find(
      (i) => i.code === "NONTERMINAL_DEADLOCK",
    )!;
    expect(deadlock.path).toEqual(["c_enter"]);
    expect(deadlock.state?.nodeId).toBe("n_archive");
  });
  it("错误来源拒绝写请求", async () => {
    const r = await app.inject({
      method: "POST",
      url: `/api/v1/activities/${activityId}/checks`,
      headers: { origin: "https://untrusted.invalid", cookie },
      payload: { expectedRevision: 3 },
    });
    expect(r.statusCode).toBe(403);
  });
});
