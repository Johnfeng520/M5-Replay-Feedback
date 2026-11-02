import { useEffect, useState } from "react";
import type { PublishedSnapshot, ValidationReport } from "@campus/contracts";
import { api, intent } from "../api";
import { AuthorEditor } from "./AuthorEditor";
import type { DraftState } from "./editorModel";
import { saveDraft } from "./draftApi";
import baseline from "../../../../fixtures/stories/baseline.story.json";
import baselineLayout from "../../../../fixtures/stories/baseline.layout.json";
import second from "../../../../fixtures/stories/second.story.json";
import secondLayout from "../../../../fixtures/stories/second.layout.json";
export function AuthorWorkspace() {
  const [list, setList] = useState<{ id: string; title: string }[]>([]),
    [draft, setDraft] = useState<DraftState | null>(null),
    [title, setTitle] = useState("新活动"),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [report, setReport] = useState<ValidationReport | null>(null),
    [versions, setVersions] = useState<PublishedSnapshot[]>([]);
  const refresh = async () => setList(await api("/activities"));
  useEffect(() => {
    refresh().catch((e) => setMessage(e.message));
  }, []);
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setMessage("");
    try {
      await fn();
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const open = async (id: string) => {
    setDraft(null);
    setReport(null);
    setVersions([]);
    if (!id) return;
    setDraft(await api(`/activities/${id}/draft`));
    setVersions(await api(`/activities/${id}/versions`));
  };
  const create = async (sample?: "baseline" | "second") => {
    const story = sample === "baseline" ? baseline : second,
      layout = sample === "baseline" ? baselineLayout : secondLayout;
    let d = await intent<DraftState>("/activities", {
      title: sample ? story.title : title,
    });
    if (sample) d = await saveDraft({ ...d, story: story as any, layout });
    await refresh();
    setDraft(d);
    setReport(null);
    setVersions([]);
  };
  return (
    <div className="author-workspace">
      <header className="page-heading">
        <div>
          <span className="eyebrow">THE AUTHOR'S DESK / 创作工作台</span>
          <h1>故事，从这里展开。</h1>
          <p>编写场景，连接选择，把一段校园奇遇交到玩家手中。</p>
        </div>
        <div className="creation-steps" aria-label="创作流程">
          <span>
            <b>01</b>编写内容
          </span>
          <span>
            <b>02</b>检查路线
          </span>
          <span>
            <b>03</b>发布试玩
          </span>
        </div>
      </header>
      <section className="workspace-tools ui-panel" aria-label="活动管理">
        <div className="workspace-toolbar">
          <label className="workspace-select">
            我的活动
            <select
              aria-label="我的活动"
              value={draft?.activityId ?? ""}
              disabled={busy}
              onChange={(e) => {
                const id = e.target.value;
                if (draft && !confirm("切换前请确认已保存当前编辑。继续切换？"))
                  return;
                run(() => open(id));
              }}
            >
              <option value="">选择一个故事，继续创作</option>
              {list.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.title}
                </option>
              ))}
            </select>
          </label>
          <div className="workspace-create">
            <label>
              开启一个新故事
              <input
                aria-label="新活动标题"
                value={title}
                maxLength={120}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="给你的校园故事起个名字"
              />
            </label>
            <button
              className="ui-button"
              disabled={busy || !title.trim()}
              onClick={() => run(() => create())}
            >
              新建活动
            </button>
          </div>
        </div>
        <div className="sample-actions">
          <span>第一次创作？从完整示例开始</span>
          <button disabled={busy} onClick={() => run(() => create("baseline"))}>
            从示例一创建
          </button>
          <button disabled={busy} onClick={() => run(() => create("second"))}>
            从示例二创建
          </button>
        </div>
        <div className="workspace-bottom">
          <p role="status">
            {message ||
              "编辑后先保存，再检查路线与发布。检查和发布以已保存的内容为准。"}
          </p>
          {draft && (
            <div className="workspace-actions">
              <button
                className="ui-button"
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    setReport(
                      await api(`/activities/${draft.activityId}/checks`, {
                        method: "POST",
                        body: JSON.stringify({
                          expectedRevision: draft.revision,
                        }),
                      }),
                    );
                  })
                }
              >
                检查已保存内容
              </button>
              <button
                className="ui-button"
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    const v = await intent<PublishedSnapshot>(
                      `/activities/${draft.activityId}/versions`,
                      { expectedRevision: draft.revision },
                    );
                    setVersions(
                      await api(`/activities/${draft.activityId}/versions`),
                    );
                    setMessage(`版本 ${v.versionNumber} 已发布`);
                  })
                }
              >
                发布已保存修订
              </button>
            </div>
          )}
        </div>
      </section>
      {report && (
        <section className="report" aria-label="路线检查结果">
          <h2>
            检查结果：
            {report.complete
              ? report.publishable
                ? "通过"
                : "需要修正"
              : "未完成"}
          </h2>
          <p>
            修订 {report.revision} · 已检查 {report.visitedStates} 个状态
            {report.truncationReason && " · 检查达到预算上限，请调整后重试"}
          </p>
          {report.issues.map((i, k) => (
            <p key={k}>
              {i.message} {i.nodeId && `（${i.nodeId}）`} {i.path?.join(" → ")}
            </p>
          ))}
        </section>
      )}
      {versions.length > 0 && (
        <section className="version-list" aria-label="已发布版本">
          <strong>已发布 · 可以开始试玩</strong>
          {versions.map((v) => (
            <a key={v.versionId} href={`#/player?version=${v.versionId}`}>
              试玩 v{v.versionNumber} ↗
            </a>
          ))}
        </section>
      )}
      {draft ? (
        <AuthorEditor
          key={draft.activityId}
          initialDraft={draft}
          onSaved={(d) => {
            setDraft(d);
            setReport(null);
            refresh().catch((e) => setMessage(e.message));
          }}
        />
      ) : (
        <section className="author-empty-state ui-panel">
          <div className="empty-ornament" aria-hidden="true">
            ◇ ─ ◈ ─ ◇
          </div>
          <h2>每个故事，都始于一个选择。</h2>
          <p>
            选择已有活动，或新建你的第一段剧情。也可以从上方示例开始，看看道具、线索和结局如何连接。
          </p>
        </section>
      )}
    </div>
  );
}
