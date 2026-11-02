import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  applyChoice,
  initialState,
  validateStory,
  VALIDATOR_VERSION,
} from "@campus/engine";
import type { Issue, RuntimeState, Story } from "@campus/contracts";
const read = (p: string) =>
  JSON.parse(
    readFileSync(new URL("../fixtures/" + p, import.meta.url), "utf8"),
  );
const baseline: Story = read("stories/baseline.story.json");
const second: Story = read("stories/second.story.json");
const expected = read("expected/validation.expected.json");
const FULL_BUDGET = { maxStates: 6000, maxTimeMs: 5000 };

// 用引擎本身逐步重放反例路径，证明报告的路径真实可执行（M3-3 验收）。
function replay(story: Story, path: string[]): RuntimeState {
  let state = initialState(story);
  for (const choiceId of path) {
    const result = applyChoice(story, state, choiceId);
    expect(result.ok, `路径选择 ${choiceId} 必须可执行`).toBe(true);
    if (result.ok) state = result.state;
  }
  return state;
}

describe("状态错误样例", () => {
  const stateCases = expected.cases.filter((x: any) => x.phase === "state");
  for (const fixture of stateCases) {
    it(fixture.file, () => {
      const story: Story = read(fixture.file);
      const report = validateStory(story, FULL_BUDGET);
      expect(report.complete).toBe(true);
      expect(report.truncationReason).toBeNull();
      expect(report.publishable).toBe(false);
      expect(report.issues.map((x) => x.code)).toEqual(
        expect.arrayContaining(fixture.requiredCodes),
      );
      // 反例路径必须是从初始状态实际可执行的选择前缀
      if (fixture.witnessChoices.length) {
        const witness = report.issues.find((i) => i.path?.length);
        expect(witness?.path).toEqual(fixture.witnessChoices);
        expect(replay(story, witness!.path!)).toEqual(witness!.state);
      }
    });
  }
  it("状态反例的每条带路径问题都能被引擎复现", () => {
    for (const fixture of stateCases) {
      const story: Story = read(fixture.file);
      const report = validateStory(story, FULL_BUDGET);
      for (const issue of report.issues)
        if (issue.path?.length)
          expect(replay(story, issue.path)).toEqual(issue.state);
    }
  });
  it("拿不到钥匙的样例只有结局不可达，无误报死端", () => {
    const report = validateStory(
      read("invalid/unobtainable-key.story.json"),
      FULL_BUDGET,
    );
    expect(report.issues.map((i) => i.code)).toEqual(["ENDING_UNREACHABLE"]);
    expect(report.issues[0].nodeId).toBe("n_good");
    expect(report.issues[0].path).toBeUndefined();
    expect(report.complete).toBe(true);
    expect(report.publishable).toBe(false);
  });
  it("死端同时报告卡住的状态与未满足条件", () => {
    const report = validateStory(
      read("invalid/blocked-state.story.json"),
      FULL_BUDGET,
    );
    const deadlock = report.issues.find(
      (i) => i.code === "NONTERMINAL_DEADLOCK",
    )!;
    expect(deadlock.state).toEqual({
      nodeId: "n_archive",
      values: { v_key: false, v_clue: false },
    });
    expect(deadlock.unmet).toEqual([{ variableId: "v_key", equals: true }]);
  });
});

describe("正常剧情与状态键", () => {
  it("两个正常剧情完整搜索通过且可发布", () => {
    for (const story of [baseline, second]) {
      const report = validateStory(story, FULL_BUDGET);
      expect(report.complete).toBe(true);
      expect(report.truncationReason).toBeNull();
      expect(report.issues).toEqual([]);
      expect(report.publishable).toBe(true);
    }
  });
  it("手推状态数：同一节点不同变量状态分别计数", () => {
    // 手推：两个故事各有 8 个可达完整状态，均超过 5/6 个节点，
    // 证明只按 nodeId 去重会漏掉状态。
    expect(validateStory(baseline, FULL_BUDGET).visitedStates).toBe(8);
    expect(validateStory(second, FULL_BUDGET).visitedStates).toBe(8);
    expect(new Set(baseline.nodes.map((n) => n.id)).size).toBe(5);
  });
  it("结果确定性", () => {
    const story: Story = read("invalid/closed-loop.story.json");
    expect(validateStory(story, FULL_BUDGET)).toEqual(
      validateStory(story, FULL_BUDGET),
    );
  });
});

describe("预算截断", () => {
  it("maxStates=1 强制截断，绝不宣布通过或不存在", () => {
    const budgetCase = expected.budgetCase;
    const report = validateStory(baseline, {
      maxStates: budgetCase.maxStates,
      maxTimeMs: budgetCase.maxTimeMs,
    });
    expect(report.complete).toBe(budgetCase.complete);
    expect(report.publishable).toBe(budgetCase.publishable);
    expect(report.truncationReason).toBe(budgetCase.truncationReason);
    expect(report.visitedStates).toBe(1);
    expect(report.issues).toEqual([]);
  });
  it("结构错误时跳过状态搜索", () => {
    const report = validateStory(
      read("invalid/missing-target.story.json"),
      FULL_BUDGET,
    );
    expect(report.complete).toBe(false);
    expect(report.publishable).toBe(false);
    expect(report.visitedStates).toBe(0);
    expect(report.truncationReason).toBeNull();
    expect(report.issues.map((i) => i.code)).toContain("TARGET_NOT_FOUND");
  });
});

describe("检查器版本", () => {
  it("validatorVersion 随算法语义维护", () => {
    expect(VALIDATOR_VERSION).toMatch(/^\d+\.\d+$/);
  });
});
