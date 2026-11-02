import type {
  Story,
  StoryNode,
  Choice,
  Condition,
  Effect,
} from "@campus/contracts";

type Props = {
  node: StoryNode;
  nodes: StoryNode[];
  variables: Story["variables"];
  isEntry: boolean;
  onPatch: (patch: Partial<StoryNode>) => void;
  onSetEntry: () => void;
  onDelete: () => void;
  onAddChoice: () => void;
  onRemoveChoice: (choiceId: string) => void;
  onPatchChoice: (choiceId: string, patch: Partial<Choice>) => void;
  onAddCondition: (choiceId: string) => void;
  onPatchCondition: (
    choiceId: string,
    index: number,
    patch: Partial<Condition>,
  ) => void;
  onRemoveCondition: (choiceId: string, index: number) => void;
  onAddEffect: (choiceId: string) => void;
  onPatchEffect: (
    choiceId: string,
    index: number,
    patch: Partial<Effect>,
  ) => void;
  onRemoveEffect: (choiceId: string, index: number) => void;
};

/** 左侧：当前节点的表单。连线的 target 只在这里维护，画布不写死连线。 */
export function NodeForm(props: Props) {
  const { node, nodes, variables, isEntry } = props;

  return (
    <section className="author-form">
      <div className="author-form-head">
        <h2>当前节点属性</h2>
        <div className="author-form-actions">
          {isEntry ? (
            <span className="author-badge">入口</span>
          ) : (
            <button type="button" onClick={props.onSetEntry}>
              设为入口
            </button>
          )}
          <button
            type="button"
            className="author-danger"
            onClick={props.onDelete}
          >
            删除节点
          </button>
        </div>
      </div>

      <label className="author-field">
        <span>节点 ID（只读）</span>
        <input value={node.id} readOnly />
      </label>

      <label className="author-field">
        <span>标题</span>
        <input
          value={node.title}
          onChange={(e) => props.onPatch({ title: e.target.value })}
        />
      </label>

      <label className="author-field">
        <span>类型</span>
        <select
          value={node.kind}
          onChange={(e) =>
            props.onPatch({ kind: e.target.value as "scene" | "ending" })
          }
        >
          <option value="scene">普通场景</option>
          <option value="ending">结局</option>
        </select>
      </label>

      <label className="author-field">
        <span>场景文本（正文）</span>
        <textarea
          rows={6}
          value={node.body}
          placeholder="纯文本正文"
          onChange={(e) => props.onPatch({ body: e.target.value })}
        />
      </label>

      <div className="author-field author-field-row">
        <label>
          <span>背景 ID（可空）</span>
          <input
            value={node.media.backgroundId ?? ""}
            placeholder="backgroundId"
            onChange={(e) =>
              props.onPatch({
                media: {
                  ...node.media,
                  backgroundId: e.target.value || undefined,
                },
              })
            }
          />
        </label>
        <label>
          <span>音频 ID（可空）</span>
          <input
            value={node.media.audioId ?? ""}
            placeholder="audioId"
            onChange={(e) =>
              props.onPatch({
                media: { ...node.media, audioId: e.target.value || undefined },
              })
            }
          />
        </label>
      </div>

      <h3>玩家可做的选择</h3>
      <p className="author-hint">
        连线由这些选项的「目标节点」自动生成，画布上不手动连线。
      </p>
      {node.choices.length === 0 && (
        <p className="author-empty">暂无选项，点击下方按钮添加。</p>
      )}
      {node.choices.map((choice) => (
        <div className="author-choice" key={choice.id}>
          <div className="author-field">
            <span>选项文本</span>
            <input
              value={choice.label}
              onChange={(e) =>
                props.onPatchChoice(choice.id, { label: e.target.value })
              }
            />
          </div>
          <label className="author-field">
            <span>目标节点（生成连线）</span>
            <select
              value={choice.targetNodeId}
              onChange={(e) =>
                props.onPatchChoice(choice.id, { targetNodeId: e.target.value })
              }
            >
              <option value="">（未连接）</option>
              {nodes.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.title}（{n.id}）
                </option>
              ))}
            </select>
          </label>

          <div className="author-sub">
            <span className="author-sub-title">
              出现条件
              <button
                type="button"
                onClick={() => props.onAddCondition(choice.id)}
              >
                + 条件
              </button>
            </span>
            {choice.conditions.map((c, i) => (
              <div className="author-pair" key={`${choice.id}-cond-${i}`}>
                <select
                  value={c.variableId}
                  onChange={(e) =>
                    props.onPatchCondition(choice.id, i, {
                      variableId: e.target.value,
                    })
                  }
                >
                  <option value="">（选择变量）</option>
                  {variables.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.label}（{v.id}）
                    </option>
                  ))}
                </select>
                <label className="author-check">
                  <input
                    type="checkbox"
                    checked={c.equals}
                    onChange={(e) =>
                      props.onPatchCondition(choice.id, i, {
                        equals: e.target.checked,
                      })
                    }
                  />
                  equals
                </label>
                <button
                  type="button"
                  onClick={() => props.onRemoveCondition(choice.id, i)}
                >
                  删除
                </button>
              </div>
            ))}
          </div>

          <div className="author-sub">
            <span className="author-sub-title">
              选择后的变化
              <button
                type="button"
                onClick={() => props.onAddEffect(choice.id)}
              >
                + 效果
              </button>
            </span>
            {choice.effects.map((ef, i) => (
              <div className="author-pair" key={`${choice.id}-effect-${i}`}>
                <select
                  value={ef.variableId}
                  onChange={(e) =>
                    props.onPatchEffect(choice.id, i, {
                      variableId: e.target.value,
                    })
                  }
                >
                  <option value="">（选择变量）</option>
                  {variables.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.label}（{v.id}）
                    </option>
                  ))}
                </select>
                <label className="author-check">
                  <input
                    type="checkbox"
                    checked={ef.value}
                    onChange={(e) =>
                      props.onPatchEffect(choice.id, i, {
                        value: e.target.checked,
                      })
                    }
                  />
                  value
                </label>
                <button
                  type="button"
                  onClick={() => props.onRemoveEffect(choice.id, i)}
                >
                  删除
                </button>
              </div>
            ))}
          </div>

          <button
            type="button"
            className="author-danger"
            onClick={() => props.onRemoveChoice(choice.id)}
          >
            删除该选项
          </button>
        </div>
      ))}
      <button type="button" className="author-btn" onClick={props.onAddChoice}>
        新增选项
      </button>
    </section>
  );
}
