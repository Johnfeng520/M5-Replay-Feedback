import type { PrismaClient } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import { LIMITS, type Save, type Session } from "@campus/contracts";
import {
  transact,
  ensure,
  receipt,
  remember,
  saveDto,
} from "../../infrastructure/core";
import {
  requireUser,
  body,
  requestIdSchema,
  sequenceSchema,
} from "../../infrastructure/http";
import { playerService } from "../player";
import { loadVersion } from "../versions";
export function saveService(
  db: PrismaClient,
  options: { beforeReceipt?: () => Promise<void> } = {},
) {
  const player = playerService(db);
  return {
    createSave(
      actorId: string,
      sessionId: string,
      input: { expectedSeq: number; requestId: string; label: string },
    ): Promise<Save> {
      return transact(db, async (tx) => {
        const s = await player.readOwned(tx, actorId, sessionId);
        const key = {
          actorId,
          kind: "save.create",
          scopeId: sessionId,
          requestId: input.requestId,
        };
        const old = await receipt<Save>(tx, key, input);
        if (old) return old;
        ensure(
          s.seq === input.expectedSeq,
          409,
          "SEQUENCE_CONFLICT",
          "进度已变化，请重新读取后保存",
        );
        const saved = saveDto(
          await tx.save.create({
            data: {
              playerId: actorId,
              versionId: s.versionId,
              sourceSessionId: s.id,
              sourceSeq: s.seq,
              state: s.state as any,
              label: input.label,
            },
          }),
        );
        await remember(tx, key, input, saved);
        return saved;
      });
    },
    restoreSave(
      actorId: string,
      saveId: string,
      input: { requestId: string; shareWithCreator: boolean },
    ): Promise<Session> {
      return transact(db, async (tx) => {
        const saved = await tx.save.findUnique({ where: { id: saveId } });
        ensure(
          saved && saved.playerId === actorId,
          404,
          "NOT_FOUND",
          "存档不存在或无权访问",
        );
        const key = {
          actorId,
          kind: "save.restore",
          scopeId: saveId,
          requestId: input.requestId,
        };
        const old = await receipt<Session>(tx, key, input);
        if (old) return old;
        await loadVersion(tx, saved.versionId);
        const session = await player.createRestored(tx, {
          actorId,
          versionId: saved.versionId,
          initialState: saved.state as any,
          source: {
            saveId,
            sessionId: saved.sourceSessionId,
            eventSeq: saved.sourceSeq,
          },
          shareWithCreator: input.shareWithCreator,
        });
        if (options.beforeReceipt) await options.beforeReceipt();
        await remember(tx, key, input, session);
        return session;
      });
    },
    async list(actorId: string) {
      const rows = await db.save.findMany({
        where: { playerId: actorId },
        orderBy: { createdAt: "desc" },
        take: LIMITS.listItems + 1,
      });
      ensure(
        rows.length <= LIMITS.listItems,
        422,
        "LIST_LIMIT",
        "存档超过首版列表上限",
      );
      return rows.map(saveDto);
    },
  };
}
export async function registerSaveRoutes(
  app: FastifyInstance,
  db: PrismaClient,
) {
  const s = saveService(db);
  app.post<{
    Params: { sessionId: string };
    Body: { expectedSeq: number; requestId: string; label: string };
  }>(
    "/api/v1/sessions/:sessionId/saves",
    {
      schema: {
        body: body({
          expectedSeq: sequenceSchema,
          requestId: requestIdSchema,
          label: { type: "string", maxLength: 80 },
        }),
      },
    },
    async (req, reply) =>
      reply
        .code(201)
        .send({
          data: await s.createSave(
            (await requireUser(db, req)).id,
            req.params.sessionId,
            req.body,
          ),
        }),
  );
  app.get("/api/v1/saves", async (req) => ({
    data: await s.list((await requireUser(db, req)).id),
  }));
  app.post<{
    Params: { saveId: string };
    Body: { requestId: string; shareWithCreator: boolean };
  }>(
    "/api/v1/saves/:saveId/restores",
    {
      schema: {
        body: body({
          requestId: requestIdSchema,
          shareWithCreator: { type: "boolean" },
        }),
      },
    },
    async (req, reply) =>
      reply
        .code(201)
        .send({
          data: await s.restoreSave(
            (await requireUser(db, req)).id,
            req.params.saveId,
            req.body,
          ),
        }),
  );
}
