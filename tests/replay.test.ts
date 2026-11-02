/**
 * M5 回放验证测试：验证 verifyReplay 能准确识别三类损坏（GAP/ORDER/MISMATCH）。
 *
 * 依据 handoff/next/M5.md：回放器必须能拒绝缺事件、乱序、篡改状态，
 * 且失败位置要能指到具体 seq；不排序、不补齐、不自动修复。
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { verifyReplay } from "../apps/api/src/modules/replay";
import type { Story, Session, PlayEvent } from "@campus/contracts";

const read = (p: string) =>
  JSON.parse(
    readFileSync(new URL("../fixtures/" + p, import.meta.url), "utf8"),
  );

const story: Story = read("stories/baseline.story.json");

describe("回放验证（纯函数）", () => {
  it("正常事件重放通过", () => {
    const { session, events } = read("events/normal.json");
    const replay = verifyReplay(story, session, events);
    expect(replay.status).toBe("MATCH");
    expect(replay.mismatch).toBeNull();
    expect(replay.steps).toHaveLength(4);
    expect(replay.steps[0].seq).toBe(1);
    expect(replay.steps[3].seq).toBe(4);
  });

  it("恢复分支独立重放通过", () => {
    const { session, events } = read("events/restored-branch.json");
    const replay = verifyReplay(story, session, events);
    expect(replay.status).toBe("MATCH");
    expect(replay.mismatch).toBeNull();
    expect(replay.steps).toHaveLength(2);
    expect(replay.sessionId).toBe("session_fixture_branch");
  });

  it("缺事件（seq 跳号）识别为 GAP", () => {
    const { session, events, expected } = read("events/missing-event.json");
    const replay = verifyReplay(story, session, events);
    expect(replay.status).toBe("MISMATCH");
    expect(replay.mismatch).toMatchObject({ seq: 2, code: expected });
    // 连续性检查在逐步重算之前完成，发现跳号就直接短路，不会产生任何 step。
    expect(replay.steps).toHaveLength(0);
  });

  it("乱序事件（不递增 seq）识别为 ORDER", () => {
    const { session, events, expected } = read("events/reordered-events.json");
    const replay = verifyReplay(story, session, events);
    expect(replay.status).toBe("MISMATCH");
    expect(replay.mismatch).toMatchObject({ code: expected });
    // 乱序在第一步就会被拒绝（seq=2 在前，不递增），所以 steps 为空。
    expect(replay.steps).toHaveLength(0);
  });

  it("篡改状态（after 与引擎重算不符）识别为 STATE_MISMATCH", () => {
    const { session, events, expected } = read("events/tampered-state.json");
    const replay = verifyReplay(story, session, events);
    expect(replay.status).toBe("MISMATCH");
    expect(replay.mismatch).toMatchObject({ seq: 3, code: expected });
    // 前两步通过，第三步 after 被篡改（钥匙应变 false 但记录仍 true）。
    expect(replay.steps).toHaveLength(2);
  });

  it("事件条数少于 session.seq 识别为 GAP", () => {
    const { session, events } = read("events/normal.json");
    const shortSession = { ...session, seq: 5 }; // 声称有 5 步但只提供 4 条事件
    const replay = verifyReplay(story, shortSession, events);
    expect(replay.status).toBe("MISMATCH");
    expect(replay.mismatch).toMatchObject({ seq: 5, code: "EVENT_SEQUENCE_GAP" });
  });

  it("事件条数多于 session.seq 识别为 STATE_MISMATCH", () => {
    const { session, events } = read("events/normal.json");
    const shortSession = { ...session, seq: 3 }; // 声称 3 步但提供 4 条事件
    const replay = verifyReplay(story, shortSession, events);
    expect(replay.status).toBe("MISMATCH");
    expect(replay.mismatch).toMatchObject({
      seq: 4,
      code: "EVENT_STATE_MISMATCH",
    });
  });

  it("终态不一致识别为 STATE_MISMATCH", () => {
    const { session, events } = read("events/normal.json");
    const badSession = {
      ...session,
      state: { nodeId: "n_exit", values: { v_key: false, v_clue: false } },
    };
    const replay = verifyReplay(story, badSession, events);
    expect(replay.status).toBe("MISMATCH");
    expect(replay.mismatch?.code).toBe("EVENT_STATE_MISMATCH");
  });

  it("空事件列表会话（seq=0）通过", () => {
    const { session } = read("events/normal.json");
    const fresh = { ...session, seq: 0, state: session.initialState };
    const replay = verifyReplay(story, fresh, []);
    expect(replay.status).toBe("MATCH");
    expect(replay.mismatch).toBeNull();
    expect(replay.steps).toHaveLength(0);
  });
});
