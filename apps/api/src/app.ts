import Fastify from "fastify";
import { registerAuthoringRoutes } from "./modules/authoring";
import { registerVersionRoutes } from "./modules/versions";
import { registerSaveRoutes } from "./modules/saves";
import contract from "../../../packages/contracts/openapi.json";
import { requireUser, currentUser } from "./infrastructure/http";
import { mediaRoot } from "./infrastructure/assets";
import { ensure } from "./infrastructure/core";
import { registerStatic } from "./infrastructure/static";
import cookie from "@fastify/cookie";
import type { PrismaClient } from "@prisma/client";
import { verifyPassword, newToken, tokenHash } from "./auth";
import { registerPlayerRoutes } from "./modules/player";
import { registerValidationRoutes } from "./modules/validation";
import { registerReviewRoutes } from "./modules/review/routes";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
const repoRoot = resolve(import.meta.dirname, "../../..");
export async function createApp(db: PrismaClient) {
  const app = Fastify({
    logger: false,
    bodyLimit: 256 * 1024,
    ajv: { customOptions: { removeAdditional: false, coerceTypes: false } },
  });
  await app.register(cookie);
  const rewrite = (v: any): any =>
    Array.isArray(v)
      ? v.map(rewrite)
      : v && typeof v === "object"
        ? Object.fromEntries(
            Object.entries(v).map(([k, x]) => [
              k,
              k === "$ref" && typeof x === "string"
                ? x.replace("#/components/schemas/", "") + "#"
                : rewrite(x),
            ]),
          )
        : v;
  for (const [name, schema] of Object.entries(contract.components.schemas))
    app.addSchema({ $id: name, ...rewrite(schema) });
  app.get<{ Params: { hash: string } }>(
    "/api/v1/media/:hash",
    async (req, reply) => {
      await requireUser(db, req);
      ensure(
        /^[a-f0-9]{64}$/.test(req.params.hash),
        404,
        "NOT_FOUND",
        "素材不存在",
      );
      const data = await readFile(resolve(mediaRoot(), req.params.hash)).catch(
        () => null,
      );
      ensure(data, 404, "NOT_FOUND", "素材不存在");
      const png = data[0] === 137 && data[1] === 80,
        jpg = data[0] === 255 && data[1] === 216;
      const type = png
        ? "image/png"
        : jpg
          ? "image/jpeg"
          : data.toString("ascii", 0, 4) === "RIFF"
            ? "audio/wav"
            : data.toString("ascii", 0, 3) === "ID3" || data[0] === 255
              ? "audio/mpeg"
              : "application/octet-stream";
      return reply
        .header("X-Content-Type-Options", "nosniff")
        .type(type)
        .send(data);
    },
  );
  app.setErrorHandler((error, req, reply) => {
    const status =
      error.statusCode && error.statusCode < 500 ? error.statusCode : 500;
    reply.code(status).send({
      error: {
        code:
          status === 400
            ? "BAD_REQUEST"
            : status < 500
              ? error.code || "BUSINESS_ERROR"
              : "INTERNAL_ERROR",
        message: status === 500 ? "服务暂不可用" : error.message,
        requestId: req.id,
        ...(status < 500 && (error as any).details
          ? { details: (error as any).details }
          : {}),
      },
    });
  });
  app.addHook("preHandler", async (req, reply) => {
    if (
      !["GET", "HEAD", "OPTIONS"].includes(req.method) &&
      req.headers.origin !== process.env.WEB_ORIGIN
    ) {
      return reply.code(403).send({
        error: {
          code: "ORIGIN_FORBIDDEN",
          message: "请求来源不被允许",
          requestId: req.id,
        },
      });
    }
  });
  const fail = (
    reply: any,
    req: any,
    status: number,
    code: string,
    message: string,
  ) => reply.code(status).send({ error: { code, message, requestId: req.id } });
  const userFor = (req: any) => currentUser(db, req);
  app.get("/api/v1/health", async () => {
    await db.$queryRaw`SELECT 1`;
    return {
      data: { status: "ok", stage: "integrated-m4", contractVersion: "1.0" },
    };
  });
  app.post<{ Body: { email: string; password: string } }>(
    "/api/v1/auth/login",
    {
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["email", "password"],
          properties: {
            email: { type: "string", maxLength: 200 },
            password: { type: "string", maxLength: 200 },
          },
        },
      },
    },
    async (req, reply) => {
      const user = await db.user.findUnique({
        where: { email: req.body.email },
      });
      if (!user || !verifyPassword(req.body.password, user.passwordHash))
        return fail(reply, req, 401, "UNAUTHENTICATED", "账号或密码错误");
      const token = newToken();
      const expiresAt = new Date(Date.now() + 8 * 60 * 60 * 1000);
      await db.authSession.create({
        data: { tokenHash: tokenHash(token), userId: user.id, expiresAt },
      });
      reply.setCookie("sid", token, {
        httpOnly: true,
        sameSite: "strict",
        path: "/",
        secure: process.env.NODE_ENV === "production",
        expires: expiresAt,
      });
      return { data: { id: user.id, email: user.email } };
    },
  );
  app.get("/api/v1/auth/me", async (req, reply) => {
    const user = await userFor(req);
    if (!user) return fail(reply, req, 401, "UNAUTHENTICATED", "请先登录");
    return { data: { id: user.id, email: user.email } };
  });
  app.post("/api/v1/auth/logout", async (req, reply) => {
    if (req.cookies.sid)
      await db.authSession.deleteMany({
        where: { tokenHash: tokenHash(req.cookies.sid) },
      });
    reply.clearCookie("sid", { path: "/" });
    return reply.code(204).send();
  });
  // A development fixture endpoint, never a substitute for drafts or published versions.
  if (process.env.NODE_ENV !== "production")
    app.get<{ Params: { name: string } }>(
      "/api/v1/dev/fixtures/:name",
      async (req, reply) => {
        if (!(await userFor(req)))
          return fail(reply, req, 401, "UNAUTHENTICATED", "请先登录");
        const names: Record<string, string> = {
          baseline: "baseline",
          second: "second",
        };
        const name = names[req.params.name];
        if (!name) return fail(reply, req, 404, "NOT_FOUND", "样例不存在");
        const story = JSON.parse(
          await readFile(
            resolve(repoRoot, "fixtures/stories", name + ".story.json"),
            "utf8",
          ),
        );
        const layout = JSON.parse(
          await readFile(
            resolve(repoRoot, "fixtures/stories", name + ".layout.json"),
            "utf8",
          ),
        );
        return { data: { story, layout, fixtureOnly: true } };
      },
    );
  await registerAuthoringRoutes(app, db);
  await registerVersionRoutes(app, db);
  await registerSaveRoutes(app, db);
  await registerPlayerRoutes(app, db);
  await registerValidationRoutes(app, db, { userFor, fail });
  await registerReviewRoutes(app, db);
  registerStatic(app);
  return app;
}
