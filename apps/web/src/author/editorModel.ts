import type {
  Story,
  Layout,
  StoryNode,
  Choice,
  Condition,
  Effect,
} from "@campus/contracts";

/**
 * M1 创作编辑 —— 纯数据助手。
 *
 * 三条业务红线在这里集中体现：
 * 1. Layout 只存节点 ID 与 X/Y 坐标，绝不保存业务逻辑。
 * 2. 连线不落盘：每次渲染都由 story.nodes[].choices[].targetNodeId 实时推导。
 * 3. 玩家运行时状态（RuntimeState/Save/Session）绝不进入 Story。
 */

/** 本地草稿状态 = activityId + revision + story + layout。 */
export type DraftState = {
  activityId: string;
  revision: number;
  story: Story;
  layout: Layout;
};

let seq = 0;

/** 生成满足 schema 约束的稳定 ID：以字母开头，只含字母/数字/_/-。 */
export function newId(prefix: string): string {
  seq += 1;
  return `${prefix}_${Date.now().toString(36)}_${seq}`;
}

export function createNode(partial: Partial<StoryNode> = {}): StoryNode {
  return {
    id: partial.id ?? newId("node"),
    title: partial.title ?? "新节点",
    body: partial.body ?? "",
    kind: partial.kind ?? "scene",
    media: partial.media ?? {},
    choices: partial.choices ?? [],
  };
}

export function createChoice(): Choice {
  return {
    id: newId("choice"),
    label: "新选项",
    targetNodeId: "",
    conditions: [],
    effects: [],
  };
}

export function createCondition(): Condition {
  return { variableId: "", equals: false };
}

export function createEffect(): Effect {
  return { variableId: "", value: false };
}

export function createVariable(): Story["variables"][number] {
  return { id: newId("var"), label: "新变量", kind: "flag", initial: false };
}

/** 一个可直接演示的空草稿。 */
export function createEmptyDraft(activityId: string): DraftState {
  const entry = createNode({ title: "开始场景" });
  const story: Story = {
    schemaVersion: "1.0",
    rulesVersion: "1.0",
    title: "未命名活动",
    entryNodeId: entry.id,
    variables: [],
    nodes: [entry],
  };
  const layout: Layout = {
    positions: { [entry.id]: { x: 120, y: 120 } },
    viewport: { x: 0, y: 0, zoom: 1 },
  };
  return { activityId, revision: 1, story, layout };
}

/**
 * 连线的唯一权威来源：story.nodes[].choices[].targetNodeId。
 * 画布不保存连线，这里每次都根据 choices 实时推导；目标节点不存在时跳过。
 */
export function deriveEdges(
  story: Story,
): { id: string; source: string; target: string; label: string }[] {
  const ids = new Set(story.nodes.map((n) => n.id));
  const edges: { id: string; source: string; target: string; label: string }[] =
    [];
  for (const node of story.nodes) {
    for (const c of node.choices) {
      if (c.targetNodeId && ids.has(c.targetNodeId)) {
        edges.push({
          id: `${node.id}:${c.id}`,
          source: node.id,
          target: c.targetNodeId,
          label: c.label,
        });
      }
    }
  }
  return edges;
}

/** 布局里只保留仍然存在的节点坐标，删节点时调用。 */
export function prunePositions(story: Story, layout: Layout): Layout {
  const ids = new Set(story.nodes.map((n) => n.id));
  const positions: Layout["positions"] = {};
  for (const id of ids) {
    positions[id] = layout.positions[id] ?? { x: 0, y: 0 };
  }
  return { ...layout, positions };
}

// ---------------------------------------------------------------------------
// 节点 / 选择 / 条件 / 效果 / 变量 的纯不可变更新
// ---------------------------------------------------------------------------

export function insertNode(story: Story, node: StoryNode): Story {
  return { ...story, nodes: [...story.nodes, node] };
}

export function updateNode(
  story: Story,
  nodeId: string,
  patch: Partial<StoryNode>,
): Story {
  return {
    ...story,
    nodes: story.nodes.map((n) => (n.id === nodeId ? { ...n, ...patch } : n)),
  };
}

/** 删除节点，并清空指向它的选择，避免残留悬空连线。 */
export function removeNode(story: Story, nodeId: string): Story {
  const nodes = story.nodes
    .filter((n) => n.id !== nodeId)
    .map((n) => ({
      ...n,
      choices: n.choices.filter((c) => c.targetNodeId !== nodeId),
    }));
  return {
    ...story,
    nodes,
    entryNodeId:
      story.entryNodeId === nodeId ? (nodes[0]?.id ?? "") : story.entryNodeId,
  };
}

export function setEntryNode(story: Story, nodeId: string): Story {
  return { ...story, entryNodeId: nodeId };
}

export function setStoryTitle(story: Story, title: string): Story {
  return { ...story, title };
}

export function insertChoice(
  story: Story,
  nodeId: string,
  choice: Choice,
): Story {
  return updateNode(story, nodeId, {
    choices: [
      ...(story.nodes.find((n) => n.id === nodeId)?.choices ?? []),
      choice,
    ],
  });
}

export function removeChoice(
  story: Story,
  nodeId: string,
  choiceId: string,
): Story {
  const node = story.nodes.find((n) => n.id === nodeId);
  if (!node) return story;
  return updateNode(story, nodeId, {
    choices: node.choices.filter((c) => c.id !== choiceId),
  });
}

export function updateChoice(
  story: Story,
  nodeId: string,
  choiceId: string,
  patch: Partial<Choice>,
): Story {
  const node = story.nodes.find((n) => n.id === nodeId);
  if (!node) return story;
  return updateNode(story, nodeId, {
    choices: node.choices.map((c) =>
      c.id === choiceId ? { ...c, ...patch } : c,
    ),
  });
}

export function insertCondition(
  story: Story,
  nodeId: string,
  choiceId: string,
  condition: Condition,
): Story {
  const node = story.nodes.find((n) => n.id === nodeId);
  if (!node) return story;
  return updateChoice(story, nodeId, choiceId, {
    conditions: [
      ...(node.choices.find((c) => c.id === choiceId)?.conditions ?? []),
      condition,
    ],
  });
}

export function updateCondition(
  story: Story,
  nodeId: string,
  choiceId: string,
  index: number,
  patch: Partial<Condition>,
): Story {
  const node = story.nodes.find((n) => n.id === nodeId);
  const choice = node?.choices.find((c) => c.id === choiceId);
  if (!choice) return story;
  const conditions = choice.conditions.map((c, i) =>
    i === index ? { ...c, ...patch } : c,
  );
  return updateChoice(story, nodeId, choiceId, { conditions });
}

export function removeCondition(
  story: Story,
  nodeId: string,
  choiceId: string,
  index: number,
): Story {
  const node = story.nodes.find((n) => n.id === nodeId);
  const choice = node?.choices.find((c) => c.id === choiceId);
  if (!choice) return story;
  return updateChoice(story, nodeId, choiceId, {
    conditions: choice.conditions.filter((_, i) => i !== index),
  });
}

export function insertEffect(
  story: Story,
  nodeId: string,
  choiceId: string,
  effect: Effect,
): Story {
  const node = story.nodes.find((n) => n.id === nodeId);
  if (!node) return story;
  return updateChoice(story, nodeId, choiceId, {
    effects: [
      ...(node.choices.find((c) => c.id === choiceId)?.effects ?? []),
      effect,
    ],
  });
}

export function updateEffect(
  story: Story,
  nodeId: string,
  choiceId: string,
  index: number,
  patch: Partial<Effect>,
): Story {
  const node = story.nodes.find((n) => n.id === nodeId);
  const choice = node?.choices.find((c) => c.id === choiceId);
  if (!choice) return story;
  return updateChoice(story, nodeId, choiceId, {
    effects: choice.effects.map((e, i) =>
      i === index ? { ...e, ...patch } : e,
    ),
  });
}

export function removeEffect(
  story: Story,
  nodeId: string,
  choiceId: string,
  index: number,
): Story {
  const node = story.nodes.find((n) => n.id === nodeId);
  const choice = node?.choices.find((c) => c.id === choiceId);
  if (!choice) return story;
  return updateChoice(story, nodeId, choiceId, {
    effects: choice.effects.filter((_, i) => i !== index),
  });
}

export function insertVariable(
  story: Story,
  variable: Story["variables"][number],
): Story {
  return { ...story, variables: [...story.variables, variable] };
}

export function updateVariable(
  story: Story,
  varId: string,
  patch: Partial<Story["variables"][number]>,
): Story {
  return {
    ...story,
    variables: story.variables.map((v) =>
      v.id === varId ? { ...v, ...patch } : v,
    ),
  };
}

/** 删除变量，并清理引用它的条件/效果。 */
export function removeVariable(story: Story, varId: string): Story {
  const strip = <T extends { variableId: string }>(list: T[]): T[] =>
    list.filter((x) => x.variableId !== varId);
  return {
    ...story,
    variables: story.variables.filter((v) => v.id !== varId),
    nodes: story.nodes.map((n) => ({
      ...n,
      choices: n.choices.map((c) => ({
        ...c,
        conditions: strip(c.conditions),
        effects: strip(c.effects),
      })),
    })),
  };
}
