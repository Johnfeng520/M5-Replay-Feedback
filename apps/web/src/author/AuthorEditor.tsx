import { useMemo, useState, useRef } from "react";
import { LIMITS } from "@campus/contracts";
import type {
  Story,
  Layout,
  StoryNode,
  Choice,
  Condition,
  Effect,
} from "@campus/contracts";
import type { DraftState } from "./editorModel";
import {
  createEmptyDraft,
  createNode,
  createChoice,
  createCondition,
  createEffect,
  createVariable,
  insertNode,
  updateNode,
  removeNode,
  setEntryNode,
  setStoryTitle,
  insertChoice,
  removeChoice,
  updateChoice,
  insertCondition,
  updateCondition,
  removeCondition,
  insertEffect,
  updateEffect,
  removeEffect,
  insertVariable,
  updateVariable,
  removeVariable,
  prunePositions,
} from "./editorModel";
import { saveDraft, RevisionConflictError } from "./draftApi";
import { VariablesPanel } from "./VariablesPanel";
import { NodeForm } from "./NodeForm";
import { StoryCanvas } from "./StoryCanvas";
import "./author.css";

/**
 * M1 创作编辑页。左右两栏：左侧节点表单 + 变量，右侧 React Flow 画布。
 * 所有状态都在这里；画布只接受 story + layout，连线由 choices 推导。
 */
export function AuthorEditor({
  initialDraft,
  onSaved,
}: {
  initialDraft: DraftState;
  onSaved: (d: DraftState) => void;
}) {
  const [draft, rawSetDraft] = useState<DraftState>(() =>
    structuredClone(initialDraft),
  );
  const generation = useRef(0);
  const setDraft: React.Dispatch<React.SetStateAction<DraftState>> = (
    value,
  ) => {
    generation.current++;
    rawSetDraft(value);
  };
  const [selectedId, setSelectedId] = useState<string>("");
  const [status, setStatus] = useState<string>("");
  const [saving, setSaving] = useState<boolean>(false);

  const selected = useMemo(
    () =>
      draft.story.nodes.find((n) => n.id === selectedId) ??
      draft.story.nodes.find((n) => n.id === draft.story.entryNodeId) ??
      draft.story.nodes[0] ??
      null,
    [draft, selectedId],
  );

  const patchStory = (fn: (s: Story) => Story) =>
    setDraft((d) => ({ ...d, story: fn(d.story) }));

  // ---------------- 节点 ----------------
  const handleAddNode = () => {
    if (draft.story.nodes.length >= LIMITS.nodes) {
      setStatus("已达到节点数量上限");
      return;
    }
    const node = createNode();
    setDraft((d) => {
      const story = insertNode(d.story, node);
      const idx = story.nodes.length - 1;
      return {
        ...d,
        story,
        layout: {
          ...d.layout,
          positions: {
            ...d.layout.positions,
            [node.id]: {
              x: 120 + (idx % 5) * 240,
              y: 120 + Math.floor(idx / 5) * 180,
            },
          },
        },
      };
    });
    setSelectedId(node.id);
  };

  const handleDeleteNode = (nodeId: string) => {
    if (draft.story.nodes.length <= 1) {
      setStatus("至少保留一个节点");
      return;
    }
    const incoming = draft.story.nodes
      .flatMap((n) => n.choices)
      .filter((c) => c.targetNodeId === nodeId).length;
    if (!confirm(`删除此节点及指向它的 ${incoming} 个选项？`)) return;
    setDraft((d) => {
      const story = removeNode(d.story, nodeId);
      return { ...d, story, layout: prunePositions(story, d.layout) };
    });
    if (selectedId === nodeId) setSelectedId("");
  };

  const handlePatchNode = (patch: Partial<StoryNode>) => {
    if (!selected) return;
    if (patch.kind === "ending" && selected.choices.length) {
      if (!confirm("改为结局将删除该节点的所有选项，继续吗？")) return;
      patch = { ...patch, choices: [] };
    }
    patchStory((s) => updateNode(s, selected.id, patch));
  };

  // ---------------- 变量 ----------------
  const handleAddVariable = () => {
    if (draft.story.variables.length >= LIMITS.variables) {
      setStatus("已达到变量上限");
      return;
    }
    patchStory((s) => insertVariable(s, createVariable()));
  };
  const handlePatchVariable = (
    id: string,
    patch: Partial<Story["variables"][number]>,
  ) => patchStory((s) => updateVariable(s, id, patch));
  const handleRemoveVariable = (id: string) => {
    const refs = draft.story.nodes
      .flatMap((n) => n.choices)
      .flatMap((c) => [...c.conditions, ...c.effects])
      .filter((x) => x.variableId === id).length;
    if (!confirm(`删除变量并移除 ${refs} 处条件或效果引用？这可能改变路线。`))
      return;
    patchStory((s) => removeVariable(s, id));
  };

  // ---------------- 选择 / 条件 / 效果 ----------------
  const handleAddChoice = () => {
    if (!selected) return;
    if (selected.kind === "ending") {
      setStatus("结局不能继续配置选择");
      return;
    }
    if (selected.choices.length >= LIMITS.choices) {
      setStatus("已达到选项数量上限");
      return;
    }
    patchStory((s) =>
      insertChoice(s, selected.id, {
        ...createChoice(),
        targetNodeId: selected.id,
      }),
    );
  };
  const handleRemoveChoice = (choiceId: string) => {
    if (!selected) return;
    patchStory((s) => removeChoice(s, selected.id, choiceId));
  };
  const handlePatchChoice = (choiceId: string, patch: Partial<Choice>) => {
    if (!selected) return;
    patchStory((s) => updateChoice(s, selected.id, choiceId, patch));
  };
  const handleAddCondition = (choiceId: string) => {
    if (!selected) return;
    if (!draft.story.variables.length) {
      setStatus("请先创建变量");
      return;
    }
    patchStory((s) =>
      insertCondition(s, selected.id, choiceId, {
        ...createCondition(),
        variableId: s.variables[0].id,
      }),
    );
  };
  const handlePatchCondition = (
    choiceId: string,
    index: number,
    patch: Partial<Condition>,
  ) => {
    if (!selected) return;
    patchStory((s) => updateCondition(s, selected.id, choiceId, index, patch));
  };
  const handleRemoveCondition = (choiceId: string, index: number) => {
    if (!selected) return;
    patchStory((s) => removeCondition(s, selected.id, choiceId, index));
  };
  const handleAddEffect = (choiceId: string) => {
    if (!selected) return;
    if (!draft.story.variables.length) {
      setStatus("请先创建变量");
      return;
    }
    patchStory((s) =>
      insertEffect(s, selected.id, choiceId, {
        ...createEffect(),
        variableId: s.variables[0].id,
      }),
    );
  };
  const handlePatchEffect = (
    choiceId: string,
    index: number,
    patch: Partial<Effect>,
  ) => {
    if (!selected) return;
    patchStory((s) => updateEffect(s, selected.id, choiceId, index, patch));
  };
  const handleRemoveEffect = (choiceId: string, index: number) => {
    if (!selected) return;
    patchStory((s) => removeEffect(s, selected.id, choiceId, index));
  };

  // ---------------- 保存 ----------------
  const handleSave = async () => {
    setSaving(true);
    setStatus("");
    try {
      const sentAt = generation.current;
      const saved = await saveDraft(structuredClone(draft));
      const unchanged = generation.current === sentAt;
      rawSetDraft((d) =>
        unchanged ? saved : { ...d, revision: saved.revision },
      );
      onSaved(saved);
      setStatus(
        `已保存 · revision ${saved.revision}${unchanged ? "" : "；后续编辑尚未保存"}`,
      );
    } catch (e) {
      if (e instanceof RevisionConflictError) {
        setStatus((e as Error).message);
      } else {
        setStatus((e as Error).message);
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="author-editor">
      <header className="author-topbar">
        <div className="author-topbar-left">
          <input
            className="author-title"
            value={draft.story.title}
            onChange={(e) =>
              patchStory((s) => setStoryTitle(s, e.target.value))
            }
          />
          <span className="author-revision">修订 {draft.revision}</span>
          <button type="button" className="author-btn" onClick={handleAddNode}>
            新建节点
          </button>
        </div>
        <div className="author-topbar-right">
          <span className="author-status" role="status">
            {status}
          </span>
          <button
            type="button"
            className="author-save"
            disabled={saving}
            onClick={handleSave}
          >
            {saving ? "保存中…" : "保存草稿"}
          </button>
        </div>
      </header>

      <div className="author-main">
        <aside className="author-left">
          <VariablesPanel
            variables={draft.story.variables}
            onAdd={handleAddVariable}
            onRemove={handleRemoveVariable}
            onPatch={handlePatchVariable}
          />
          {selected ? (
            <NodeForm
              node={selected}
              nodes={draft.story.nodes}
              variables={draft.story.variables}
              isEntry={draft.story.entryNodeId === selected.id}
              onPatch={handlePatchNode}
              onSetEntry={() => patchStory((s) => setEntryNode(s, selected.id))}
              onDelete={() => handleDeleteNode(selected.id)}
              onAddChoice={handleAddChoice}
              onRemoveChoice={handleRemoveChoice}
              onPatchChoice={handlePatchChoice}
              onAddCondition={handleAddCondition}
              onPatchCondition={handlePatchCondition}
              onRemoveCondition={handleRemoveCondition}
              onAddEffect={handleAddEffect}
              onPatchEffect={handlePatchEffect}
              onRemoveEffect={handleRemoveEffect}
            />
          ) : (
            <p className="author-empty">没有节点。点击“新建节点”开始。</p>
          )}
        </aside>

        <section className="author-right">
          <StoryCanvas
            story={draft.story}
            layout={draft.layout}
            selectedNodeId={selected?.id ?? null}
            onSelectNode={setSelectedId}
            onViewportChange={(viewport) =>
              setDraft((d) => ({ ...d, layout: { ...d.layout, viewport } }))
            }
            onPositionsChange={(positions: Layout["positions"]) =>
              setDraft((d) => ({ ...d, layout: { ...d.layout, positions } }))
            }
          />
        </section>
      </div>
    </div>
  );
}
