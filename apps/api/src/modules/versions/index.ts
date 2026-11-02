import type { PrismaClient } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import { validateStory, validateStructure } from "@campus/engine";
import { LIMITS, type Story, type PublishedSnapshot } from "@campus/contracts";
import {
  transact,
  ensure,
  receipt,
  remember,
  versionDto,
  snapshotDigest,
  BusinessError,
  type Tx,
} from "../../infrastructure/core";
import { authoringService } from "../authoring";
import {
  requireUser,
  body,
  revisionSchema,
  requestIdSchema,
} from "../../infrastructure/http";
export async function loadVersion(
  tx: Tx,
  versionId: string,
): Promise<PublishedSnapshot> {
  const v = await tx.publishedVersion.findUnique({ where: { id: versionId } });
  ensure(v, 404, "NOT_FOUND", "发布版本不存在");
  const story = v.story as unknown as Story;
  ensure(
    story.rulesVersion === "1.0" &&
      story.schemaVersion === "1.0" &&
      v.rulesVersion === story.rulesVersion &&
      v.schemaVersion === story.schemaVersion,
    422,
    "UNSUPPORTED_VERSION",
    "版本使用的规则暂不受支持",
  );
  ensure(
    !validateStructure(story).length,
    422,
    "INVALID_SNAPSHOT",
    "发布内容损坏",
  );
  const dto = versionDto(v);
  ensure(
    snapshotDigest(dto.story, dto.assets) === dto.snapshotDigest,
    422,
    "INVALID_SNAPSHOT",
    "发布版本摘要校验失败",
  );
  return dto;
}
export function versionService(
  db: PrismaClient,
  options: {
    validate?: typeof validateStory;
    afterCheck?: () => Promise<void>;
  } = {},
) {
  const author = authoringService(db),
    check = options.validate ?? validateStory;
  return {
    async publish(
      actorId: string,
      activityId: string,
      input: { expectedRevision: number; requestId: string },
    ) {
      const key = {
        actorId,
        kind: "version.publish",
        scopeId: activityId,
        requestId: input.requestId,
      };
      const prior = await transact(db, async (tx) => {
        const a = await tx.activity.findUnique({ where: { id: activityId } });
        ensure(
          a && a.ownerId === actorId,
          404,
          "NOT_FOUND",
          "活动不存在或无权访问",
        );
        return receipt<PublishedSnapshot>(tx, key, input);
      });
      if (prior) return prior;
      const candidate = await transact(db, (tx) =>
        author.captureOwned(tx, actorId, activityId, input.expectedRevision),
      );
      const result = check(candidate.story, {
        maxStates: LIMITS.states,
        maxTimeMs: LIMITS.timeMs,
      });
      if (
        !result.complete ||
        !result.publishable ||
        result.issues.some((x) => x.severity === "error")
      )
        throw new BusinessError(
          422,
          "PUBLISH_BLOCKED",
          "发布检查未通过",
          result,
        );
      if (options.afterCheck) await options.afterCheck(); // injected concurrency seam, not an HTTP flag
      return transact(db, async (tx) => {
        const old = await receipt<PublishedSnapshot>(tx, key, input);
        if (old) return old;
        await author.assertOwnedRevision(
          tx,
          actorId,
          activityId,
          input.expectedRevision,
        );
        const latest = await tx.publishedVersion.aggregate({
          where: { activityId },
          _max: { versionNumber: true },
        });
        const v = await tx.publishedVersion.create({
          data: {
            activityId,
            versionNumber: (latest._max.versionNumber ?? 0) + 1,
            sourceRevision: candidate.revision,
            story: candidate.story as any,
            assets: candidate.assets as any,
            snapshotDigest: snapshotDigest(candidate.story, candidate.assets),
            schemaVersion: candidate.story.schemaVersion,
            rulesVersion: candidate.story.rulesVersion,
          },
        });
        const dto = versionDto(v);
        await remember(tx, key, input, dto);
        return dto;
      });
    },
    async list(activityId: string) {
      ensure(
        await db.activity.findUnique({ where: { id: activityId } }),
        404,
        "NOT_FOUND",
        "活动不存在",
      );
      const rows = await db.publishedVersion.findMany({
        where: { activityId },
        orderBy: { versionNumber: "desc" },
        take: LIMITS.listItems + 1,
      });
      ensure(
        rows.length <= LIMITS.listItems,
        422,
        "LIST_LIMIT",
        "版本超过首版列表上限",
      );
      return rows.map(versionDto);
    },
  };
}
export async function registerVersionRoutes(
  app: FastifyInstance,
  db: PrismaClient,
) {
  const s = versionService(db);
  app.post<{
    Params: { activityId: string };
    Body: { expectedRevision: number; requestId: string };
  }>(
    "/api/v1/activities/:activityId/versions",
    {
      schema: {
        body: body({
          expectedRevision: revisionSchema,
          requestId: requestIdSchema,
        }),
      },
    },
    async (req, reply) =>
      reply
        .code(201)
        .send({
          data: await s.publish(
            (await requireUser(db, req)).id,
            req.params.activityId,
            req.body,
          ),
        }),
  );
  app.get<{ Params: { activityId: string } }>(
    "/api/v1/activities/:activityId/versions",
    async (req) => {
      await requireUser(db, req);
      return { data: await s.list(req.params.activityId) };
    },
  );
  app.get<{ Params: { versionId: string } }>(
    "/api/v1/versions/:versionId",
    async (req) => {
      await requireUser(db, req);
      return {
        data: await transact(db, (tx) => loadVersion(tx, req.params.versionId)),
      };
    },
  );
}
