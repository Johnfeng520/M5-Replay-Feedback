import type { FastifyInstance } from "fastify";
import type { PrismaClient } from "@prisma/client";
import { playerService } from "./service";
import {
  requireUser,
  body,
  requestIdSchema,
  sequenceSchema,
} from "../../infrastructure/http";
import { transact } from "../../infrastructure/core";
import { readEventStream } from "../events";
export async function registerPlayerRoutes(
  app: FastifyInstance,
  db: PrismaClient,
) {
  const s = playerService(db);
  app.post<{
    Params: { versionId: string };
    Body: { requestId: string; shareWithCreator: boolean };
  }>(
    "/api/v1/versions/:versionId/sessions",
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
          data: await s.createSession({
            ...req.body,
            versionId: req.params.versionId,
            playerId: (await requireUser(db, req)).id,
          }),
        }),
  );
  app.get<{ Params: { sessionId: string } }>(
    "/api/v1/sessions/:sessionId",
    async (req) => ({
      data: await s.getSession(
        (await requireUser(db, req)).id,
        req.params.sessionId,
      ),
    }),
  );
  app.post<{
    Params: { sessionId: string };
    Body: { choiceId: string; expectedSeq: number; requestId: string };
  }>(
    "/api/v1/sessions/:sessionId/choices",
    {
      schema: {
        body: body({
          choiceId: requestIdSchema,
          expectedSeq: sequenceSchema,
          requestId: requestIdSchema,
        }),
      },
    },
    async (req) => ({
      data: await s.executeChoice({
        ...req.body,
        sessionId: req.params.sessionId,
        playerId: (await requireUser(db, req)).id,
      }),
    }),
  );
  app.patch<{
    Params: { sessionId: string };
    Body: { shareWithCreator: boolean };
  }>(
    "/api/v1/sessions/:sessionId/sharing",
    { schema: { body: body({ shareWithCreator: { type: "boolean" } }) } },
    async (req) => ({
      data: await s.setSharing(
        (await requireUser(db, req)).id,
        req.params.sessionId,
        req.body.shareWithCreator,
      ),
    }),
  );
  app.get<{ Params: { sessionId: string } }>(
    "/api/v1/sessions/:sessionId/events",
    async (req) => {
      const actor = (await requireUser(db, req)).id;
      return {
        data: await transact(db, async (tx) => {
          const session = await s.readForReview(
            tx,
            actor,
            req.params.sessionId,
          );
          return readEventStream(tx, session);
        }),
      };
    },
  );
}
