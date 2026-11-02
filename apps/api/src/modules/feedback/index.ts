/**
 * M5 反馈与统计服务（modules/feedback）
 *
 * 依据 handoff/next/M5.md「第二批：真实节点反馈」「第三批：按版本统计」：
 *   反馈绑定 sessionId + eventSeq（同一节点会被多次访问，只按 nodeId 定位是错的）；
 *   eventSeq=0 指初始状态，eventSeq=k 指第 k 次操作"之后"的状态；
 *   服务端用 eventSeq 反查真实状态并核对 nodeId，不采信前端自述；
 *   相同 requestId 同内容只写一次，不同内容报冲突；
 *   作者读取与统计都必须带 versionId，且只算当前分享授权仍有效的会话。
 *
 * 反馈是本域数据：只写 Feedback 表，不改玩家 state、Story 或固定版本。
 */
import { Prisma, type PrismaClient } from "@prisma/client";
import type { FeedbackRequest, RuntimeState } from "@campus/contracts";
import { ensure, digest, transact, type Tx } from "../../infrastructure/core";

export type FeedbackDto = {
  id: string;
  sessionId: string;
  versionId: string;
  eventSeq: number;
  nodeId: string;
  category: "bug" | "confusing" | "suggestion";
  text: string;
  createdAt: string;
};

export type SummaryDto = {
  versionId: string;
  sharedSessionCount: number;
  nodeVisits: { nodeId: string; count: number }[];
  endings: { nodeId: string; count: number }[];
};

function toDto(
  row: {
    id: string;
    sessionId: string;
    eventSeq: number;
    nodeId: string;
    category: string;
    text: string;
    createdAt: Date;
  },
  versionId: string,
): FeedbackDto {
  return {
    id: row.id,
    sessionId: row.sessionId,
    versionId,
    eventSeq: row.eventSeq,
    nodeId: row.nodeId,
    category: row.category as FeedbackDto["category"],
    text: row.text,
    createdAt: row.createdAt.toISOString(),
  };
}

/** 会话在某个 eventSeq 上的真实状态：0=初始，k=第 k 次操作之后。 */
async function stateAt(
  tx: Tx,
  sessionId: string,
  eventSeq: number,
): Promise<RuntimeState | null> {
  if (eventSeq === 0) {
    const session = await tx.playSession.findUnique({
      where: { id: sessionId },
      select: { initialState: true },
    });
    return session ? (session.initialState as unknown as RuntimeState) : null;
  }
  const event = await tx.playEvent.findUnique({
    where: { sessionId_seq: { sessionId, seq: eventSeq } },
    select: { after: true },
  });
  return event ? (event.after as unknown as RuntimeState) : null;
}

/** 只有活动作者能看；版本必须属于该活动。 */
async function assertOwnerAndVersion(
  tx: Tx,
  actorId: string,
  activityId: string,
  versionId: string,
) {
  const activity = await tx.activity.findUnique({
    where: { id: activityId },
    select: { id: true, ownerId: true },
  });
  // 非所有者一律按不存在处理，不泄露资源是否真实存在。
  ensure(activity && activity.ownerId === actorId, 404, "NOT_FOUND", "活动不存在或无权访问");
  const version = await tx.publishedVersion.findUnique({
    where: { id: versionId },
    select: { id: true, activityId: true },
  });
  ensure(version && version.activityId === activityId, 404, "NOT_FOUND", "版本不存在或不属于该活动");
}

export function feedbackService(db: PrismaClient) {
  return {
    /**
     * 仅玩家本人可提交，且必须先明确开启 shareWithCreator。
     * nodeId 由服务端用 eventSeq 反查核对。
     */
    async submit(
      actorId: string,
      sessionId: string,
      input: FeedbackRequest,
    ): Promise<FeedbackDto> {
      const hash = digest(input);
      return transact(db, async (tx) => {
        const session = await tx.playSession.findUnique({
          where: { id: sessionId },
          select: {
            id: true,
            playerId: true,
            versionId: true,
            shareWithCreator: true,
          },
        });
        ensure(session && session.playerId === actorId, 404, "NOT_FOUND", "会话不存在或无权访问");

        // 幂等检查必须排在分享开关之前：玩家撤回授权后重试同一次提交，
        // 应当取回原记录（201 + 原 id），而不是被判成"未开启分享"。
        const existing = await tx.feedback.findUnique({
          where: {
            authorId_requestId: { authorId: actorId, requestId: input.requestId },
          },
        });
        if (existing) {
          ensure(
            existing.requestHash === hash,
            409,
            "IDEMPOTENCY_CONFLICT",
            "同一请求标识被用于不同内容的反馈",
          );
          return toDto(existing, session.versionId);
        }

        ensure(
          session.shareWithCreator,
          422,
          "SHARE_NOT_ENABLED",
          "请先把本次试玩分享给创作者，再提交反馈",
        );

        const state = await stateAt(tx, sessionId, input.eventSeq);
        ensure(
          state,
          422,
          "FEEDBACK_SEQ_NOT_FOUND",
          "该序号没有对应的真实访问记录",
        );
        ensure(
          state.nodeId === input.nodeId,
          422,
          "FEEDBACK_NODE_MISMATCH",
          "该序号实际访问的节点与提交的节点不一致",
        );

        const row = await tx.feedback.create({
          data: {
            sessionId,
            authorId: actorId,
            eventSeq: input.eventSeq,
            nodeId: input.nodeId,
            category: input.category,
            text: input.text,
            requestId: input.requestId,
            requestHash: hash,
          },
        });
        return toDto(row, session.versionId);
      });
    },

    /** 作者读取：只返回当前分享授权仍有效的会话的反馈。 */
    async listForOwner(
      actorId: string,
      activityId: string,
      versionId: string,
    ): Promise<FeedbackDto[]> {
      return transact(db, async (tx) => {
        await assertOwnerAndVersion(tx, actorId, activityId, versionId);
        const rows = await tx.feedback.findMany({
          where: { session: { versionId, shareWithCreator: true } },
          include: { session: { select: { versionId: true } } },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        });
        return rows.map((row) => toDto(row, row.session.versionId));
      });
    },

    /**
     * 按版本统计：初始状态算一次访问，每条事件的 after 再算一次；ended 会话计一次结局。
     * 只统计 shareWithCreator 仍为 true 的会话；撤回分享后作者查询和统计都要排除。
     * 恢复会话是独立分支：从自己的 initialState 起算，不额外重算原会话事件。
     */
    async summarize(
      actorId: string,
      activityId: string,
      versionId: string,
    ): Promise<SummaryDto> {
      return transact(db, async (tx) => {
        await assertOwnerAndVersion(tx, actorId, activityId, versionId);
        const sessions = await tx.playSession.findMany({
          where: { versionId, shareWithCreator: true },
          select: {
            initialState: true,
            state: true,
            status: true,
            events: { orderBy: { seq: "asc" }, select: { after: true } },
          },
        });

        const visits = new Map<string, number>();
        const endings = new Map<string, number>();
        const bump = (map: Map<string, number>, key: string) =>
          map.set(key, (map.get(key) ?? 0) + 1);

        for (const session of sessions) {
          bump(visits, (session.initialState as unknown as RuntimeState).nodeId);
          for (const event of session.events)
            bump(visits, (event.after as unknown as RuntimeState).nodeId);
          if (session.status === "ended")
            bump(endings, (session.state as unknown as RuntimeState).nodeId);
        }

        const ranked = (map: Map<string, number>) =>
          [...map.entries()]
            .map(([nodeId, count]) => ({ nodeId, count }))
            .sort((a, b) => b.count - a.count || a.nodeId.localeCompare(b.nodeId));

        return {
          versionId,
          sharedSessionCount: sessions.length,
          nodeVisits: ranked(visits),
          endings: ranked(endings),
        };
      });
    },
  };
}
export type FeedbackService = ReturnType<typeof feedbackService>;

/** 供测试与日志使用：把 Prisma 唯一冲突识别出来，不要当成 500。 */
export const isUniqueViolation = (error: unknown) =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
