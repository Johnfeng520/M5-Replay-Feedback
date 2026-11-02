/**
 * M5 四个 HTTP 接口（modules/review/routes.ts）
 *
 * 与 packages/contracts/openapi.json 一一对应（x-owner=M5 的四个 planned 操作）：
 *   GET  /api/v1/sessions/{sessionId}/replay
 *   POST /api/v1/sessions/{sessionId}/feedback            201
 *   GET  /api/v1/activities/{activityId}/feedback?versionId=
 *   GET  /api/v1/activities/{activityId}/summary?versionId=
 *
 * 事件读取（GET /sessions/{id}/events）与分享开关（PATCH /sessions/{id}/sharing）
 * 已由 M2 在 modules/player/routes.ts 实现并沿用，这里不重复注册，避免重复路由。
 *
 * 鉴权统一走 requireUser（匿名 401）；会话级读取权限复用 M2 的
 * player.readForReview(tx, actorId, id)：本人，或"活动作者 + 玩家已开启分享"。
 * 非授权一律 404，不泄露资源是否真实存在。
 */
import type { FastifyInstance } from "fastify";
import type { PrismaClient } from "@prisma/client";
import type { PlayEvent, Story } from "@campus/contracts";
import {
  requireUser,
  body,
  requestIdSchema,
  sequenceSchema,
} from "../../infrastructure/http";
import { ensure, transact } from "../../infrastructure/core";
import { playerService } from "../player";
import { readEventStream } from "../events";
import { verifyReplay } from "../replay";
import { feedbackService } from "../feedback";

const sessionParams = {
  type: "object",
  required: ["sessionId"],
  properties: { sessionId: { type: "string", minLength: 1, maxLength: 64 } },
} as const;

const activityParams = {
  type: "object",
  required: ["activityId"],
  properties: { activityId: { type: "string", minLength: 1, maxLength: 64 } },
} as const;

const versionQuery = {
  type: "object",
  required: ["versionId"],
  properties: { versionId: { type: "string", minLength: 1, maxLength: 64 } },
} as const;

export async function registerReviewRoutes(
  app: FastifyInstance,
  db: PrismaClient,
) {
  const player = playerService(db);
  const feedback = feedbackService(db);

  app.get<{ Params: { sessionId: string } }>(
    "/api/v1/sessions/:sessionId/replay",
    { schema: { params: sessionParams } },
    async (req) => {
      const actor = (await requireUser(db, req)).id;
      return {
        data: await transact(db, async (tx) => {
          const session = await player.readForReview(
            tx,
            actor,
            req.params.sessionId,
          );
          const stream = await readEventStream(tx, session);
          // 固定版本快照：只读 PublishedVersion.story，绝不替换成当前草稿。
          const version = await tx.publishedVersion.findUnique({
            where: { id: session.versionId },
            select: { story: true },
          });
          ensure(version, 404, "NOT_FOUND", "版本不存在");
          return verifyReplay(
            version.story as unknown as Story,
            session,
            // Prisma 的 Json 列在读取层是 JsonValue；事件结构已由 appendEvent 的
            // EventWriter 签名约束过，这里只是把读路径的宽类型收窄回契约类型。
            stream.events as unknown as PlayEvent[],
          );
        }),
      };
    },
  );

  app.post<{
    Params: { sessionId: string };
    Body: {
      requestId: string;
      eventSeq: number;
      nodeId: string;
      category: "bug" | "confusing" | "suggestion";
      text: string;
    };
  }>(
    "/api/v1/sessions/:sessionId/feedback",
    {
      schema: {
        params: sessionParams,
        body: body({
          requestId: requestIdSchema,
          eventSeq: sequenceSchema,
          nodeId: { type: "string", minLength: 1, maxLength: 64 },
          category: {
            type: "string",
            enum: ["bug", "confusing", "suggestion"],
          },
          text: { type: "string", minLength: 1, maxLength: 1000 },
        }),
      },
    },
    async (req, reply) => {
      const actor = (await requireUser(db, req)).id;
      return reply.code(201).send({
        data: await feedback.submit(actor, req.params.sessionId, req.body),
      });
    },
  );

  app.get<{
    Params: { activityId: string };
    Querystring: { versionId: string };
  }>(
    "/api/v1/activities/:activityId/feedback",
    { schema: { params: activityParams, querystring: versionQuery } },
    async (req) => {
      const actor = (await requireUser(db, req)).id;
      return {
        data: await feedback.listForOwner(
          actor,
          req.params.activityId,
          req.query.versionId,
        ),
      };
    },
  );

  app.get<{
    Params: { activityId: string };
    Querystring: { versionId: string };
  }>(
    "/api/v1/activities/:activityId/summary",
    { schema: { params: activityParams, querystring: versionQuery } },
    async (req) => {
      const actor = (await requireUser(db, req)).id;
      return {
        data: await feedback.summarize(
          actor,
          req.params.activityId,
          req.query.versionId,
        ),
      };
    },
  );
}
