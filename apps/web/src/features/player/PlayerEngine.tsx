import { useEffect, useState } from "react";
import type {
  PublishedSnapshot,
  Session,
  Save,
  ChoiceView,
  PlayEvent,
} from "@campus/contracts";
import { api, intent } from "../../api";
import "./player.css";
export function PlayerEngine({ userId }: { userId: string }) {
  const initialVersion =
    new URLSearchParams(location.hash.split("?")[1] ?? "").get("version") ?? "";
  const [versionId, setVersionId] = useState(initialVersion),
    [version, setVersion] = useState<PublishedSnapshot | null>(null),
    [session, setSession] = useState<Session | null>(null),
    [choices, setChoices] = useState<ChoiceView[]>([]),
    [saves, setSaves] = useState<Save[]>([]),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [share, setShare] = useState(false),
    [events, setEvents] = useState<PlayEvent[]>([]);
  const storage = "stage.session." + userId;
  const listSaves = async () => setSaves(await api("/saves"));
  const load = async (id: string) => {
    const r = await api<{ session: Session; choices: ChoiceView[] }>(
      `/sessions/${id}`,
    );
    const v = await api<PublishedSnapshot>(`/versions/${r.session.versionId}`);
    setSession(r.session);
    setVersion(v);
    setVersionId(v.versionId);
    setChoices(r.choices);
    setShare(r.session.shareWithCreator);
    setEvents([]);
    localStorage.setItem(storage, id);
  };
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
  useEffect(() => {
    run(async () => {
      await listSaves();
      const last = localStorage.getItem(storage);
      if (last) {
        const r = await api<{ session: Session }>(`/sessions/${last}`).catch(
          () => null,
        );
        if (r && (!initialVersion || r.session.versionId === initialVersion))
          await load(last);
      }
    });
  }, []);
  const start = async () => {
    const s = await intent<Session>(`/versions/${versionId}/sessions`, {
      shareWithCreator: share,
    });
    await load(s.id);
  };
  const choose = async (id: string) => {
    if (!session) return;
    await intent(`/sessions/${session.id}/choices`, {
      choiceId: id,
      expectedSeq: session.seq,
    });
    await load(session.id);
  };
  const node = version?.story.nodes.find((n) => n.id === session?.state.nodeId);
  return (
    <div className="player-shell">
      <header className="page-heading">
        <div>
          <span className="eyebrow">INTO THE STORY / 试玩与存档</span>
          <h1>下一页，由你选择。</h1>
          <p>进入已经发布的故事，带着线索前行，也可以随时保存这一刻。</p>
        </div>
      </header>
      <section className="ui-panel player-toolbar" aria-label="试玩设置">
        <label className="player-version-input">
          打开一个已发布的版本
          <input
            aria-label="发布版本 ID"
            value={versionId}
            onChange={(e) => setVersionId(e.target.value)}
            placeholder="粘贴创作者提供的版本 ID"
          />
        </label>
        <label className="ui-checkbox">
          <input
            type="checkbox"
            checked={share}
            disabled={busy}
            onChange={(e) => {
              const enabled = e.target.checked;
              if (session)
                run(async () => {
                  await api(`/sessions/${session.id}/sharing`, {
                    method: "PATCH",
                    body: JSON.stringify({ shareWithCreator: enabled }),
                  });
                  await load(session.id);
                });
              else setShare(enabled);
            }}
          />
          允许创作者查看本次记录
        </label>
        <button
          className="ui-button"
          disabled={busy || !versionId}
          onClick={() => run(start)}
        >
          开始新会话
        </button>
        {session && (
          <button
            className="ui-button"
            disabled={busy}
            onClick={() =>
              run(async () => {
                await intent(`/sessions/${session.id}/saves`, {
                  expectedSeq: session.seq,
                  label: `进度 ${session.seq}`,
                });
                await listSaves();
                setMessage("存档已保存");
              })
            }
          >
            保存进度
          </button>
        )}
        {message && (
          <p className="player-message" role="status">
            {message}
          </p>
        )}
      </section>
      {session && version ? (
        <article className="player-book">
          <header className="player-top">
            <div>
              <h2>{version.story.title}</h2>
              <p>
                步骤 {session.seq} · {node?.title}
              </p>
            </div>
            <span className="player-version-badge">
              固定版本 · v{version.versionNumber}
            </span>
          </header>
          <div className="player-main">
            <section className="player-scene ui-panel" aria-label="当前剧情">
              <div className="player-scene-label">STORY / {node?.title}</div>
              <p className="player-body">{node?.body}</p>
              {session.status === "ended" ? (
                <p className="player-ending">本故事到此结束</p>
              ) : (
                <div className="player-choices" aria-label="你的选择">
                  {choices.map((c) => (
                    <button
                      className="player-choice"
                      key={c.id}
                      disabled={busy || !c.available}
                      onClick={() => run(() => choose(c.id))}
                    >
                      <span>{c.label}</span>
                      {!c.available && (
                        <small>
                          条件未满足：
                          {c.unmet
                            .map((x) => {
                              const variable = version.story.variables.find(
                                (v) => v.id === x.variableId,
                              );
                              return `${variable?.label ?? x.variableId}需为${x.equals ? "是" : "否"}`;
                            })
                            .join("、")}
                        </small>
                      )}
                    </button>
                  ))}
                </div>
              )}
              {session.source && (
                <p className="player-source">
                  本会话从存档恢复，原会话保留。版本固定为 v
                  {version.versionNumber}。
                </p>
              )}
            </section>
            <aside className="player-side ui-inset">
              <span className="eyebrow">YOUR JOURNEY</span>
              <h2>道具与状态</h2>
              {version.story.variables.length === 0 && (
                <p className="muted">这个故事无需收集道具。</p>
              )}
              {version.story.variables.map((v) => (
                <div className="player-var" key={v.id}>
                  <span>{v.label}</span>
                  <b className={session.state.values[v.id] ? "on" : "off"}>
                    {session.state.values[v.id]
                      ? v.kind === "item"
                        ? "已取得"
                        : "是"
                      : v.kind === "item"
                        ? "未取得"
                        : "否"}
                  </b>
                </div>
              ))}
              <details className="player-session-details">
                <summary>本次试玩信息</summary>
                <p>会话 ID：{session.id}</p>
              </details>
            </aside>
          </div>
          <section className="player-records">
            <h2>沿途的选择</h2>
            <button
              disabled={busy}
              onClick={() =>
                run(async () =>
                  setEvents(
                    (await api(`/sessions/${session.id}/events`)).events,
                  ),
                )
              }
            >
              查看本次选择记录
            </button>
            {events.map((e) => {
              const before = version.story.nodes.find(
                  (n) => n.id === e.before.nodeId,
                ),
                choice = before?.choices.find((c) => c.id === e.choiceId),
                after = version.story.nodes.find(
                  (n) => n.id === e.after.nodeId,
                );
              return (
                <p key={e.id}>
                  第 {e.seq} 步 · {choice?.label ?? e.choiceId} ·{" "}
                  {before?.title ?? e.before.nodeId} →{" "}
                  {after?.title ?? e.after.nodeId}
                </p>
              );
            })}
          </section>
        </article>
      ) : (
        <section className="player-welcome ui-panel">
          <div className="empty-ornament" aria-hidden="true">
            ◇ ─ ◈ ─ ◇
          </div>
          <h2>准备好，走进故事了吗？</h2>
          <p>
            从创作工作台的已发布版本进入，或在上方填入版本
            ID。开始后，你的线索、选择和进度会保存在这次试玩里。
          </p>
        </section>
      )}
      <section className="save-library">
        <div className="save-library-head">
          <h2>我的存档</h2>
          <span>回到当时的故事，开启一条新的路线。</span>
        </div>
        {saves.length === 0 ? (
          <p className="save-empty">
            尚无存档。在试玩中点击“保存进度”，就能留下这一页。
          </p>
        ) : (
          <div className="save-grid">
            {saves.map((s) => (
              <article className="save-card" key={s.id}>
                <div>
                  <h3>{s.label}</h3>
                  <p>
                    {new Date(s.createdAt).toLocaleString()} · 第 {s.sourceSeq}{" "}
                    步
                  </p>
                  <details>
                    <summary>查看原版本信息</summary>
                    <p>{s.versionId}</p>
                  </details>
                </div>
                <button
                  disabled={busy}
                  onClick={() =>
                    run(async () => {
                      const restored = await intent<Session>(
                        `/saves/${s.id}/restores`,
                        { shareWithCreator: share },
                      );
                      await load(restored.id);
                      setMessage("已在原版本恢复为新会话");
                    })
                  }
                >
                  恢复为新会话
                </button>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
