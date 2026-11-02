import { LIMITS, type Story } from "@campus/contracts";

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
      <summary>
        道具与状态　{variables.length} / {LIMITS.variables}
      </summary>
      <p className="author-hint">
        在这里设置初始道具与标记；每位玩家的进度单独记录。
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
            <option value="flag">标记</option>
            <option value="item">道具</option>
          </select>
          <label className="author-check">
            <input
              type="checkbox"
              checked={v.initial}
              onChange={(e) => onPatch(v.id, { initial: e.target.checked })}
            />
            初始为是
          </label>
          <button type="button" onClick={() => onRemove(v.id)}>
            删除
          </button>
        </div>
      ))}
      <button type="button" className="author-btn" onClick={onAdd}>
        新增道具 / 标记
      </button>
    </details>
  );
}
