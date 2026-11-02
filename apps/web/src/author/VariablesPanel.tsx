import type { Story } from "@campus/contracts";

type Props = {
  variables: Story["variables"];
  onAdd: () => void;
  onRemove: (id: string) => void;
  onPatch: (id: string, patch: Partial<Story["variables"][number]>) => void;
};

/** 左侧：变量（道具/标记）管理。变量是故事的初始值，与玩家运行时状态无关。 */
export function VariablesPanel({ variables, onAdd, onRemove, onPatch }: Props) {
  return (
    <details className="author-vars" open>
      <summary>变量（道具 / 标记）　{variables.length} / 8</summary>
      <p className="author-hint">
        变量只是故事的初始值；玩家状态只存在会话里，不会被写回 Story。
      </p>
      {variables.map((v) => (
        <div className="author-var-row" key={v.id}>
          <input className="author-var-id" value={v.id} readOnly title={v.id} />
          <input
            value={v.label}
            placeholder="标签"
            onChange={(e) => onPatch(v.id, { label: e.target.value })}
          />
          <select
            value={v.kind}
            onChange={(e) =>
              onPatch(v.id, { kind: e.target.value as "item" | "flag" })
            }
          >
            <option value="flag">flag</option>
            <option value="item">item</option>
          </select>
          <label className="author-check">
            <input
              type="checkbox"
              checked={v.initial}
              onChange={(e) => onPatch(v.id, { initial: e.target.checked })}
            />
            initial
          </label>
          <button type="button" onClick={() => onRemove(v.id)}>
            删除
          </button>
        </div>
      ))}
      <button type="button" className="author-btn" onClick={onAdd}>
        新增变量
      </button>
    </details>
  );
}
