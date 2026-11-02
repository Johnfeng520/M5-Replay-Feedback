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
  const [list, setList] = useState<any[]>([]),
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
    <div>
      <section className="workspace-tools">
        <label>
          我的活动{" "}
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
            <option value="">请选择</option>
            {list.map((a) => (
              <option key={a.id} value={a.id}>
                {a.title}
              </option>
            ))}
          </select>
        </label>
        <input
          aria-label="新活动标题"
          value={title}
          maxLength={120}
          onChange={(e) => setTitle(e.target.value)}
        />
        <button
          disabled={busy || !title.trim()}
          onClick={() => run(() => create())}
        >
          新建活动
        </button>
        <button disabled={busy} onClick={() => run(() => create("baseline"))}>
          从示例一创建
        </button>
        <button disabled={busy} onClick={() => run(() => create("second"))}>
          从示例二创建
        </button>
        {draft && (
          <>
            <button
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
          </>
        )}
        <p role="status">
          {message || "编辑后请先保存；检查与发布以服务器中已保存的修订为准。"}
        </p>
      </section>
      {report && (
        <section className="report">
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
          </p>
          {report.issues.map((i, k) => (
            <p key={k}>
              {i.message} {i.nodeId && `（${i.nodeId}）`} {i.path?.join(" → ")}
            </p>
          ))}
        </section>
      )}
      {versions.length > 0 && (
        <section className="workspace-tools">
          <strong>已发布版本</strong>
          {versions.map((v) => (
            <a key={v.versionId} href={`#/player?version=${v.versionId}`}>
              试玩 v{v.versionNumber}
            </a>
          ))}
        </section>
      )}
      {draft && (
        <AuthorEditor
          key={draft.activityId}
          initialDraft={draft}
          onSaved={(d) => {
            setDraft(d);
            setReport(null);
            refresh().catch((e) => setMessage(e.message));
          }}
        />
      )}
    </div>
  );
}
