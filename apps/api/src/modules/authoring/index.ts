import type { PrismaClient } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { LIMITS, type Story, type Layout } from "@campus/contracts";
import {
  transact,
  ownedActivity,
  ensure,
  receipt,
  remember,
  type Tx,
} from "../../infrastructure/core";
import { captureAssets, assetCatalog } from "../../infrastructure/assets";
import {
  requireUser,
  body,
  requestIdSchema,
  revisionSchema,
} from "../../infrastructure/http";
const draftDto = (d: any) => ({ ...d, updatedAt: d.updatedAt.toISOString() });
export function authoringService(db: PrismaClient) {
  return {
    async captureOwned(
      tx: Tx,
      actorId: string,
      activityId: string,
      expectedRevision: number,
    ) {
      const a = await ownedActivity(tx, actorId, activityId);
      ensure(a.draft, 404, "NOT_FOUND", "草稿不存在");
      ensure(
        a.draft.revision === expectedRevision,
        409,
        "REVISION_CONFLICT",
        "草稿已被更新，请重新读取",
      );
      return {
        activityId,
        revision: expectedRevision,
        story: a.draft.story as unknown as Story,
        assets: await captureAssets(a.draft.story as unknown as Story),
      };
    },
    async assertOwnedRevision(
      tx: Tx,
      actorId: string,
      activityId: string,
      expectedRevision: number,
    ) {
      const a = await ownedActivity(tx, actorId, activityId);
      ensure(
        a.draft?.revision === expectedRevision,
        409,
        "REVISION_CONFLICT",
        "检查期间草稿已更新，请重新发布",
      );
    },
    async list(actorId: string) {
      const rows = await db.activity.findMany({
        where: { ownerId: actorId },
        orderBy: { createdAt: "desc" },
        take: LIMITS.listItems + 1,
        include: {
          draft: { select: { revision: true } },
          versions: {
            orderBy: { versionNumber: "desc" },
            take: 1,
            select: { id: true },
          },
        },
      });
      ensure(
        rows.length <= LIMITS.listItems,
        422,
        "LIST_LIMIT",
        "活动超过首版列表上限，请整理数据",
      );
      return rows.map((x) => ({
        id: x.id,
        title: x.title,
        revision: x.draft?.revision ?? 0,
        latestVersionId: x.versions[0]?.id ?? null,
      }));
    },
    create(actorId: string, input: { title: string; requestId: string }) {
      return transact(db, async (tx) => {
        const key = {
          actorId,
          kind: "activity.create",
          scopeId: actorId,
          requestId: input.requestId,
        };
        const old = await receipt(tx, key, input);
        if (old) return old;
        const nodeId = "node_" + randomUUID();
        const story: Story = {
          schemaVersion: "1.0",
          rulesVersion: "1.0",
          title: input.title,
          entryNodeId: nodeId,
          variables: [],
          nodes: [
            {
              id: nodeId,
              title: "开始",
              body: "",
              kind: "scene",
              media: {},
              choices: [],
            },
          ],
        };
        const a = await tx.activity.create({
          data: {
            ownerId: actorId,
            title: input.title,
            draft: {
              create: {
                story: story as any,
                layout: {
                  positions: { [nodeId]: { x: 120, y: 120 } },
                  viewport: { x: 0, y: 0, zoom: 1 },
                },
              },
            },
          },
          include: { draft: true },
        });
        const result = draftDto(a.draft);
        await remember(tx, key, input, result);
        return result;
      });
    },
    get(actorId: string, id: string) {
      return transact(db, async (tx) => {
        const a = await ownedActivity(tx, actorId, id);
        ensure(a.draft, 404, "NOT_FOUND", "草稿不存在");
        return draftDto(a.draft);
      });
    },
    save(
      actorId: string,
      id: string,
      input: { expectedRevision: number; story: Story; layout: Layout },
    ) {
      return transact(db, async (tx) => {
        await ownedActivity(tx, actorId, id);
        const r = await tx.draft.updateMany({
          where: { activityId: id, revision: input.expectedRevision },
          data: {
            story: input.story as any,
            layout: input.layout as any,
            revision: { increment: 1 },
          },
        });
        ensure(
          r.count === 1,
          409,
          "REVISION_CONFLICT",
          "草稿已被更新，请保留编辑并重新读取",
        );
        await tx.activity.update({
          where: { id },
          data: { title: input.story.title },
        });
        return draftDto(
          await tx.draft.findUniqueOrThrow({ where: { activityId: id } }),
        );
      });
    },
  };
}
export async function registerAuthoringRoutes(
  app: FastifyInstance,
  db: PrismaClient,
) {
  const s = authoringService(db);
  app.get("/api/v1/activities", async (req) => ({
    data: await s.list((await requireUser(db, req)).id),
  }));
  app.post<{ Body: { title: string; requestId: string } }>(
    "/api/v1/activities",
    {
      schema: {
        body: body({
          title: { type: "string", minLength: 1, maxLength: 120 },
          requestId: requestIdSchema,
        }),
      },
    },
    async (req, reply) =>
      reply
        .code(201)
        .send({
          data: await s.create((await requireUser(db, req)).id, req.body),
        }),
  );
  app.get<{ Params: { activityId: string } }>(
    "/api/v1/activities/:activityId/draft",
    async (req) => ({
      data: await s.get((await requireUser(db, req)).id, req.params.activityId),
    }),
  );
  app.put<{
    Params: { activityId: string };
    Body: { expectedRevision: number; story: Story; layout: Layout };
  }>(
    "/api/v1/activities/:activityId/draft",
    {
      schema: {
        body: body({
          expectedRevision: revisionSchema,
          story: { $ref: "Story#" },
          layout: { $ref: "Layout#" },
        }),
      },
    },
    async (req) => ({
      data: await s.save(
        (await requireUser(db, req)).id,
        req.params.activityId,
        req.body,
      ),
    }),
  );
  app.get("/api/v1/assets", async (req) => {
    await requireUser(db, req);
    return { data: await assetCatalog() };
  });
}
