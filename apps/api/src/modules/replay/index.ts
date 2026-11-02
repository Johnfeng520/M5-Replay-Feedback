/**
 * M5 规则回放核对（纯函数：不接数据库、不读时钟、不产生随机数）
 *
 * 依据 handoff/next/M5.md「第一批：完整规则回放」：
 *   起点为 session.initialState，从 seq=1 连续到 finalSeq；每步核对 before，
 *   经唯一 applyChoice 算 after/delta，再核对记录，最后与会话 state/seq 一致。
 *   发现缺失/乱序/篡改/规则不符返回契约 MISMATCH 与位置，不跳过、不自动修复。
 *
 * 三类损坏必须失败，且要能指到具体 seq：
 *   EVENT_SEQUENCE_GAP    缺事件（seq 跳号，或事件条数少于会话 finalSeq）
 *   EVENT_SEQUENCE_ORDER  乱序（seq 不严格递增）
 *   EVENT_STATE_MISMATCH  before/after/delta/终态不符，或事件条数多于 finalSeq
 *
 * 恢复分支（session.source 非空）同样从自己的 initialState 开始重算；
 * 原会话只作为追溯信息，绝不把原会话事件并进来重放。
 */
import { applyChoice, getChoices } from "@campus/engine";
import type {
  ApplyResult,
  ChoiceView,
  PlayEvent,
  RuntimeState,
  Session,
  Story,
} from "@campus/contracts";

export type ReplayMismatchCode =
  | "EVENT_SEQUENCE_GAP"
  | "EVENT_SEQUENCE_ORDER"
  | "EVENT_STATE_MISMATCH";

export type ReplayStep = {
  seq: number;
  choiceId: string;
  before: RuntimeState;
  after: RuntimeState;
  choicesBefore: ChoiceView[];
};

export type ReplayMismatch = { seq: number; code: ReplayMismatchCode };

/** 结构与 packages/contracts/openapi.json 的 components.schemas.Replay 一致。 */
export type Replay = {
  versionId: string;
  sessionId: string;
  initialState: RuntimeState;
  steps: ReplayStep[];
  status: "MATCH" | "MISMATCH";
  mismatch: ReplayMismatch | null;
};

/** 与键顺序无关的深比较：状态与 delta 都是小对象。 */
function same(left: unknown, right: unknown): boolean {
  return stable(left) === stable(right);
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(stable).join(",") + "]";
  if (value && typeof value === "object") {
    const entries = Object.keys(value as Record<string, unknown>)
      .sort()
      .map((k) => JSON.stringify(k) + ":" + stable((value as any)[k]));
    return "{" + entries.join(",") + "}";
  }
  return JSON.stringify(value ?? null);
}

/**
 * @param story    会话所属 PublishedVersion 的固定快照，不能传当前草稿
 * @param session  会话记录（initialState 可能是存档恢复的快照，不是故事初始值）
 * @param events   同会话事件，读取层按 seq 升序返回；乱序也必须能被识别
 */
export function verifyReplay(
  story: Story,
  session: Session,
  events: PlayEvent[],
): Replay {
  const base = {
    versionId: session.versionId,
    sessionId: session.id,
    initialState: session.initialState,
  };
  const steps: ReplayStep[] = [];
  const mismatch = (seq: number, code: ReplayMismatchCode): Replay => ({
    ...base,
    steps,
    status: "MISMATCH",
    mismatch: { seq, code },
  });

  // 1. seq 必须是正整数且严格递增；不递增就是乱序，不能靠排序掩盖。
  let previous = 0;
  for (const event of events) {
    if (!Number.isInteger(event.seq) || event.seq < 1)
      return mismatch(previous + 1, "EVENT_SEQUENCE_ORDER");
    if (event.seq <= previous) return mismatch(event.seq, "EVENT_SEQUENCE_ORDER");
    previous = event.seq;
  }

  // 2. 必须从 1 开始连续；跳号就是缺事件。
  for (let index = 0; index < events.length; index++)
    if (events[index].seq !== index + 1)
      return mismatch(index + 1, "EVENT_SEQUENCE_GAP");

  // 3. 事件必须属于本会话与本版本（跨版本混算属于阻断项）。
  for (const event of events)
    if (event.sessionId !== session.id || event.versionId !== session.versionId)
      return mismatch(event.seq, "EVENT_STATE_MISMATCH");

  // 4. 逐步重算。before 必须等于"上一步算出来的状态"，不采信事件自述。
  let state = session.initialState;
  for (const event of events) {
    if (!same(event.before, state))
      return mismatch(event.seq, "EVENT_STATE_MISMATCH");

    let choicesBefore: ChoiceView[];
    let applied: ApplyResult;
    try {
      choicesBefore = getChoices(story, state);
      applied = applyChoice(story, state, event.choiceId);
    } catch {
      // 故事快照或状态不合法：同样归为状态不符，不静默跳过、不抛成 500。
      return mismatch(event.seq, "EVENT_STATE_MISMATCH");
    }
    if (!applied.ok) return mismatch(event.seq, "EVENT_STATE_MISMATCH");
    if (!same(applied.state, event.after) || !same(applied.delta, event.delta))
      return mismatch(event.seq, "EVENT_STATE_MISMATCH");

    steps.push({
      seq: event.seq,
      choiceId: event.choiceId,
      before: event.before,
      after: event.after,
      choicesBefore,
    });
    state = applied.state;
  }

  // 5. 事件条数必须与 finalSeq 一致。少了是缺事件；多了是会话行与事件表脱节。
  if (events.length < session.seq)
    return mismatch(events.length + 1, "EVENT_SEQUENCE_GAP");
  if (events.length > session.seq)
    return mismatch(session.seq + 1, "EVENT_STATE_MISMATCH");

  // 6. 终态必须对得上。
  if (!same(state, session.state))
    return mismatch(Math.max(session.seq, 1), "EVENT_STATE_MISMATCH");

  return { ...base, steps, status: "MATCH", mismatch: null };
}
