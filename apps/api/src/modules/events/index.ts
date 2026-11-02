// Minimal shared event adapter for M2/M4 integration; M5 can extend review/feedback independently.
import type {
  PlayEvent,
  ExecuteChoiceResponse,
  Session,
} from "@campus/contracts";
import { ensure, type Tx } from "../../infrastructure/core";
export type EventWriter = (
  tx: Tx,
  event: PlayEvent,
  requestHash: string,
  response: ExecuteChoiceResponse,
) => Promise<void>;
export const appendEvent: EventWriter = async (
  tx,
  event,
  requestHash,
  response,
) => {
  const session = await tx.playSession.findUniqueOrThrow({
    where: { id: event.sessionId },
  });
  ensure(
    session.versionId === event.versionId && session.seq === event.seq,
    422,
    "EVENT_STATE_MISMATCH",
    "事件与会话不一致",
  );
  const { versionId, ...row } = event;
  await tx.playEvent.create({
    data: {
      ...row,
      createdAt: new Date(row.createdAt),
      before: row.before as any,
      after: row.after as any,
      delta: row.delta as any,
      requestHash,
      response: response as any,
    },
  });
};
export async function findChoiceReceipt(
  tx: Tx,
  sessionId: string,
  requestId: string,
) {
  const r = await tx.playEvent.findUnique({
    where: { sessionId_requestId: { sessionId, requestId } },
  });
  return r
    ? {
        requestHash: r.requestHash,
        response: r.response as unknown as ExecuteChoiceResponse,
      }
    : null;
}
// Caller must first obtain the authorized session from M2 readForReview inside this transaction.
export async function readEventStream(tx: Tx, session: Session) {
  const events = await tx.playEvent.findMany({
    where: { sessionId: session.id },
    orderBy: { seq: "asc" },
  });
  return {
    sessionId: session.id,
    versionId: session.versionId,
    initialState: session.initialState,
    finalSeq: session.seq,
    events: events.map(({ requestHash, response, ...e }) => ({
      ...e,
      versionId: session.versionId,
      createdAt: e.createdAt.toISOString(),
    })),
  };
}
