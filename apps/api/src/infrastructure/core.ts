import { createHash } from "node:crypto";
import type { PrismaClient, Prisma } from "@prisma/client";
import type {
  Asset,
  PublishedSnapshot,
  Session,
  Save,
  Story,
} from "@campus/contracts";
export type Tx = Prisma.TransactionClient;
export class BusinessError extends Error {
  constructor(
    public statusCode: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}
export function ensure(
  value: unknown,
  status: number,
  code: string,
  message: string,
): asserts value {
  if (!value) throw new BusinessError(status, code, message);
}
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value !== null && typeof value === "object")
    return (
      "{" +
      Object.keys(value)
        .sort()
        .filter((k) => (value as any)[k] !== undefined)
        .map((k) => JSON.stringify(k) + ":" + canonical((value as any)[k]))
        .join(",") +
      "}"
    );
  return JSON.stringify(value);
}
export const digest = (value: unknown) =>
  createHash("sha256").update(canonical(value), "utf8").digest("hex");
export const snapshotDigest = (story: Story, assets: Asset[] = []) =>
  digest({
    story,
    assets: [...assets].sort((a, b) =>
      a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
    ),
  });

// A single SQLite writer queue per client; CAS + uniqueness still protect other processes.
const queues = new WeakMap<PrismaClient, Promise<unknown>>();
export function transact<T>(
  db: PrismaClient,
  work: (tx: Tx) => Promise<T>,
): Promise<T> {
  const prior = queues.get(db) ?? Promise.resolve();
  const result = prior
    .catch(() => {})
    .then(async () => {
      for (let attempt = 0; ; attempt++) {
        try {
          return await db.$transaction(work, {
            maxWait: 10000,
            timeout: 15000,
          });
        } catch (e) {
          const code = (e as any).code;
          if (!["P2034", "P2028", "P1008", "P2002"].includes(code)) throw e;
          if (attempt >= 2)
            throw new BusinessError(
              409,
              "CONCURRENT_WRITE",
              "写入发生冲突，请保持原请求重试",
            );
          await new Promise((r) => setTimeout(r, 20 * (attempt + 1)));
        }
      }
    });
  queues.set(
    db,
    result.catch(() => {}),
  );
  return result;
}
export async function ownedActivity(
  tx: Tx,
  actorId: string,
  activityId: string,
) {
  const a = await tx.activity.findUnique({
    where: { id: activityId },
    include: { draft: true },
  });
  ensure(a && a.ownerId === actorId, 404, "NOT_FOUND", "活动不存在或无权访问");
  return a;
}
export async function ownedSession(tx: Tx, actorId: string, sessionId: string) {
  const s = await tx.playSession.findUnique({ where: { id: sessionId } });
  ensure(s && s.playerId === actorId, 404, "NOT_FOUND", "会话不存在或无权访问");
  return s;
}
export const versionDto = (v: any): PublishedSnapshot => ({
  versionId: v.id,
  activityId: v.activityId,
  versionNumber: v.versionNumber,
  sourceRevision: v.sourceRevision,
  story: v.story,
  assets: v.assets,
  snapshotDigest: v.snapshotDigest,
  publishedAt: v.publishedAt.toISOString(),
});
export const sessionDto = (s: any): Session => ({
  id: s.id,
  versionId: s.versionId,
  playerId: s.playerId,
  initialState: s.initialState,
  state: s.state,
  seq: s.seq,
  source: s.source ?? null,
  shareWithCreator: s.shareWithCreator,
  status: s.status,
});
export const saveDto = (s: any): Save => ({
  ...s,
  createdAt: s.createdAt.toISOString(),
});
export type ReceiptKey = {
  actorId: string;
  kind: string;
  scopeId: string;
  requestId: string;
};
export async function receipt<T>(
  tx: Tx,
  key: ReceiptKey,
  payload: unknown,
): Promise<T | null> {
  const r = await tx.operationReceipt.findUnique({
    where: { actorId_kind_scopeId_requestId: key },
  });
  if (!r) return null;
  ensure(
    r.requestHash === digest(payload),
    409,
    "IDEMPOTENCY_CONFLICT",
    "同一请求标识不能用于不同内容",
  );
  return r.response as T;
}
export async function remember(
  tx: Tx,
  key: ReceiptKey,
  payload: unknown,
  response: unknown,
) {
  await tx.operationReceipt.create({
    data: { ...key, requestHash: digest(payload), response: response as any },
  });
}
