import { useEffect, useState } from "react";
import type {
  PublishedSnapshot,
  Session,
  Save,
  ChoiceView,
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
    [events, setEvents] = useState<any[]>([]);
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
      <section className="workspace-tools">
        <label>
          发布版本 ID{" "}
          <input
            aria-label="发布版本 ID"
            value={versionId}
            onChange={(e) => setVersionId(e.target.value)}
          />
        </label>
        <label>
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
        <button disabled={busy || !versionId} onClick={() => run(start)}>
          开始新会话
        </button>
        {session && (
          <button
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
        <p role="status">{message}</p>
      </section>
      {session && version && (
        <>
          <header className="player-top">
            <h1>{version.story.title}</h1>
            <span>
              v{version.versionNumber} · 步骤 {session.seq} · {node?.title}
            </span>
          </header>
          <div className="player-main">
            <section className="player-scene">
              <p className="player-body">{node?.body}</p>
              {session.status === "ended" ? (
                <p className="player-ending">本故事到此结束</p>
              ) : (
                <div className="player-choices">
                  {choices.map((c) => (
                    <button
                      key={c.id}
                      disabled={busy || !c.available}
                      onClick={() => run(() => choose(c.id))}
                    >
                      {c.label}
                      {!c.available && (
                        <small>
                          条件未满足：
                          {c.unmet
                            .map(
                              (x) =>
                                version.story.variables.find(
                                  (v) => v.id === x.variableId,
                                )?.label ?? x.variableId,
                            )
                            .join("、")}
                        </small>
                      )}
                    </button>
                  ))}
                </div>
              )}
              {session.source && (
                <p>
                  本会话从存档恢复，原会话保留。版本固定为 v
                  {version.versionNumber}。
                </p>
              )}
            </section>
            <aside className="player-side">
              <h2>道具与状态</h2>
              {version.story.variables.map((v) => (
                <p key={v.id}>
                  {v.label}：
                  {session.state.values[v.id] ? "已取得 / 是" : "未取得 / 否"}
                </p>
              ))}
              <p>会话 ID：{session.id}</p>
            </aside>
          </div>
          <section className="workspace-tools">
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
            {events.map((e) => (
              <p key={e.id}>
                步骤 {e.seq} · {e.choiceId} · {e.before.nodeId} →{" "}
                {e.after.nodeId}
              </p>
            ))}
          </section>
        </>
      )}
      <section className="workspace-tools">
        <h2>我的存档</h2>
        {saves.length === 0 && <p>尚无存档</p>}
        {saves.map((s) => (
          <div key={s.id}>
            <span>
              {s.label} · {new Date(s.createdAt).toLocaleString()} · 原版本{" "}
              {s.versionId}
            </span>
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
          </div>
        ))}
      </section>
    </div>
  );
}
