import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import {
  initialState,
  getChoices,
  applyChoice,
  validState,
} from "@campus/engine";
import {
  LIMITS,
  type Session,
  type RuntimeState,
  type ExecuteChoiceRequest,
  type ExecuteChoiceResponse,
} from "@campus/contracts";
import {
  transact,
  ensure,
  receipt,
  remember,
  sessionDto,
  digest,
  type Tx,
} from "../../infrastructure/core";
import { loadVersion } from "../versions";
import { appendEvent, findChoiceReceipt, type EventWriter } from "../events";
import { playerRepository as repo } from "./repository";
export function playerService(
  db: PrismaClient,
  options: { appendEvent?: EventWriter } = {},
) {
  const writer = options.appendEvent ?? appendEvent;
  const end = (story: any, state: RuntimeState) =>
    story.nodes.find((n: any) => n.id === state.nodeId)?.kind === "ending"
      ? "ended"
      : "active";
  return {
    createSession(input: {
      versionId: string;
      playerId: string;
      requestId: string;
      shareWithCreator: boolean;
    }): Promise<Session> {
      return transact(db, async (tx) => {
        const key = {
          actorId: input.playerId,
          kind: "session.create",
          scopeId: input.versionId,
          requestId: input.requestId,
        };
        const old = await receipt<Session>(tx, key, input);
        if (old) return old;
        const v = await loadVersion(tx, input.versionId),
          state = initialState(v.story);
        const row = await tx.playSession.create({
          data: {
            versionId: v.versionId,
            playerId: input.playerId,
            initialState: state as any,
            state: state as any,
            status: end(v.story, state),
            shareWithCreator: input.shareWithCreator,
          },
        });
        const dto = sessionDto(row);
        await remember(tx, key, input, dto);
        return dto;
      });
    },
    async readOwned(tx: Tx, actorId: string, id: string) {
      return sessionDto(await repo.readOwned(tx, actorId, id));
    },
    async readForReview(tx: Tx, actorId: string, id: string) {
      const row = await tx.playSession.findUnique({
        where: { id },
        include: { version: { include: { activity: true } } },
      });
      ensure(
        row &&
          (row.playerId === actorId ||
            (row.shareWithCreator && row.version.activity.ownerId === actorId)),
        404,
        "NOT_FOUND",
        "记录不存在或未获授权",
      );
      return sessionDto(row);
    },
    async createRestored(
      tx: Tx,
      input: {
        actorId: string;
        versionId: string;
        initialState: RuntimeState;
        source: { saveId: string; sessionId: string; eventSeq: number };
        shareWithCreator: boolean;
      },
    ) {
      const saved = await tx.save.findUnique({
        where: { id: input.source.saveId },
      });
      ensure(
        saved &&
          saved.playerId === input.actorId &&
          saved.versionId === input.versionId &&
          saved.sourceSessionId === input.source.sessionId &&
          saved.sourceSeq === input.source.eventSeq &&
          digest(saved.state) === digest(input.initialState),
        422,
        "INVALID_STATE",
        "存档来源或状态不一致",
      );
      const v = await loadVersion(tx, input.versionId);
      ensure(
        validState(v.story, input.initialState),
        422,
        "INVALID_STATE",
        "存档状态与原版不兼容",
      );
      return sessionDto(
        await tx.playSession.create({
          data: {
            playerId: input.actorId,
            versionId: input.versionId,
            initialState: input.initialState as any,
            state: input.initialState as any,
            seq: 0,
            source: input.source,
            status: end(v.story, input.initialState),
            shareWithCreator: input.shareWithCreator,
          },
        }),
      );
    },
    async setSharing(actorId: string, id: string, enabled: boolean) {
      return transact(db, async (tx) => {
        await repo.readOwned(tx, actorId, id);
        return sessionDto(
          await tx.playSession.update({
            where: { id },
            data: { shareWithCreator: enabled },
          }),
        );
      });
    },
    getSession(actorId: string, id: string) {
      return transact(db, async (tx) => {
        const s = sessionDto(await repo.readOwned(tx, actorId, id));
        const v = await loadVersion(tx, s.versionId);
        return { session: s, choices: getChoices(v.story, s.state) };
      });
    },
    executeChoice(
      input: ExecuteChoiceRequest & { sessionId: string; playerId: string },
    ): Promise<ExecuteChoiceResponse> {
      return transact(db, async (tx) => {
        const row = await repo.readOwned(tx, input.playerId, input.sessionId);
        const hash = digest({
          choiceId: input.choiceId,
          expectedSeq: input.expectedSeq,
        });
        const old = await findChoiceReceipt(tx, row.id, input.requestId);
        if (old) {
          ensure(
            old.requestHash === hash,
            409,
            "IDEMPOTENCY_CONFLICT",
            "同一请求标识不能用于不同选择",
          );
          return old.response;
        }
        ensure(
          row.seq === input.expectedSeq,
          409,
          "SEQUENCE_CONFLICT",
          "进度已变化，请重新读取",
        );
        ensure(
          row.seq < LIMITS.sessionChoices,
          422,
          "SESSION_LIMIT_REACHED",
          "已达到本次会话操作上限",
        );
        const v = await loadVersion(tx, row.versionId),
          before = row.state as unknown as RuntimeState;
        const result = applyChoice(v.story, before, input.choiceId);
        if (!result.ok)
          throw Object.assign(new Error(result.error.message), {
            statusCode: 422,
            code: result.error.code,
            details: result.error.details,
          });
        const status = end(v.story, result.state),
          seq = row.seq + 1,
          eventId = randomUUID();
        await repo.advance(tx, row.id, row.seq, result.state, status);
        const response: ExecuteChoiceResponse = {
          sessionId: row.id,
          versionId: v.versionId,
          seq,
          state: result.state,
          choices: getChoices(v.story, result.state),
          eventId,
          status,
        };
        await writer(
          tx,
          {
            id: eventId,
            sessionId: row.id,
            versionId: v.versionId,
            seq,
            requestId: input.requestId,
            choiceId: input.choiceId,
            before,
            after: result.state,
            delta: result.delta,
            createdAt: new Date().toISOString(),
          },
          hash,
          response,
        );
        return response;
      });
    },
  };
}
export type PlayerService = ReturnType<typeof playerService>;
