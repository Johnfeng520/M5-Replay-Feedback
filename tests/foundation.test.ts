import { beforeAll, afterAll, it, expect } from "vitest";
import { PrismaClient } from "@prisma/client";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join, dirname, basename } from "node:path";
import { createApp } from "../apps/api/src/app";
import { passwordHash } from "../apps/api/src/auth";
const folder = mkdtempSync(join(tmpdir(), "story-foundation-"));
const url = "file:" + join(folder, "test.db").replaceAll("\\", "/");
const db = new PrismaClient({ datasourceUrl: url });
let app: Awaited<ReturnType<typeof createApp>>;
beforeAll(async () => {
  process.env.WEB_ORIGIN = "http://localhost:5173";
  execFileSync(
    process.execPath,
    [resolve("node_modules/tsx/dist/cli.mjs"), "scripts/db-deploy.ts"],
    { env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" },
  );
  await db.user.create({
    data: {
      email: "test@example.test",
      passwordHash: passwordHash("local-test-password"),
    },
  });
  app = await createApp(db);
}, 90000);
afterAll(async () => {
  await app?.close();
  await db.$disconnect();
  if (
    dirname(resolve(folder)) !== resolve(tmpdir()) ||
    !basename(folder).startsWith("story-foundation-")
  ) {
    throw new Error("拒绝删除预期临时测试目录之外的路径");
  }
  rmSync(folder, { recursive: true, force: true });
});
it("数据库健康检查", async () => {
  const r = await app.inject("/api/v1/health");
  expect(r.statusCode).toBe(200);
});
it("未登录拒绝样例读取", async () => {
  const r = await app.inject("/api/v1/dev/fixtures/baseline");
  expect(r.statusCode).toBe(401);
});
it("错误来源拒绝写入", async () => {
  const r = await app.inject({
    method: "POST",
    url: "/api/v1/auth/login",
    headers: { origin: "https://untrusted.invalid" },
    payload: { email: "test@example.test", password: "local-test-password" },
  });
  expect(r.statusCode).toBe(403);
});
it("错误密码拒绝", async () => {
  const r = await app.inject({
    method: "POST",
    url: "/api/v1/auth/login",
    headers: { origin: process.env.WEB_ORIGIN },
    payload: { email: "test@example.test", password: "wrong" },
  });
  expect(r.statusCode).toBe(401);
});
it("登录 查询样例 与退出", async () => {
  const login = await app.inject({
    method: "POST",
    url: "/api/v1/auth/login",
    headers: { origin: process.env.WEB_ORIGIN },
    payload: { email: "test@example.test", password: "local-test-password" },
  });
  expect(login.statusCode).toBe(200);
  const cookie = login.cookies.map((c) => c.name + "=" + c.value).join("; ");
  const me = await app.inject({ url: "/api/v1/auth/me", headers: { cookie } });
  expect(me.json().data.email).toBe("test@example.test");
  const fixture = await app.inject({
    url: "/api/v1/dev/fixtures/second",
    headers: { cookie },
  });
  expect(fixture.json().data.story.entryNodeId).toBe("radio_start");
  await app.inject({
    method: "POST",
    url: "/api/v1/auth/logout",
    headers: { cookie, origin: process.env.WEB_ORIGIN },
  });
  expect(
    (await app.inject({ url: "/api/v1/auth/me", headers: { cookie } }))
      .statusCode,
  ).toBe(401);
});
it("同一事务内失败回滚", async () => {
  await expect(
    db.$transaction(async (tx) => {
      await tx.user.create({
        data: { email: "rollback@example.test", passwordHash: "fixture-only" },
      });
      throw new Error("injected failure");
    }),
  ).rejects.toThrow("injected failure");
  expect(
    await db.user.findUnique({ where: { email: "rollback@example.test" } }),
  ).toBeNull();
});
