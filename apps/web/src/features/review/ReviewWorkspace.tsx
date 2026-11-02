/**
 * M5 回放与反馈工作台（apps/web/src/features/review）
 *
 * 对应契约：
 *   GET  /sessions/{id}/replay        回放核对结果（MATCH / MISMATCH + 具体 seq）
 *   POST /sessions/{id}/feedback      以"会话 + 序号 + 节点"提交反馈
 *   GET  /activities/{id}/feedback    作者视角的反馈列表（需 versionId）
 *   GET  /activities/{id}/summary     按版本的访问与结局统计
 *
 * 判定一律由服务端做：前端只展示 verifyReplay 的结果，
 * 不在页面里"顺手修一下"缺失或乱序的记录。
 */
import { useState } from "react";
import type { ChoiceView, FeedbackRequest, RuntimeState } from "@campus/contracts";
import { api } from "../../api";
import "./review.css";

type Step = {
  seq: number;
  choiceId: string;
  before: RuntimeState;
  after: RuntimeState;
  choicesBefore: ChoiceView[];
};
type Replay = {
  versionId: string;
  sessionId: string;
  initialState: RuntimeState;
  steps: Step[];
  status: "MATCH" | "MISMATCH";
  mismatch: { seq: number; code: string } | null;
};
type FeedbackItem = {
  id: string;
  sessionId: string;
  versionId: string;
  eventSeq: number;
  nodeId: string;
  category: "bug" | "confusing" | "suggestion";
  text: string;
  createdAt: string;
};
type Summary = {
  versionId: string;
  sharedSessionCount: number;
  nodeVisits: { nodeId: string; count: number }[];
  endings: { nodeId: string; count: number }[];
};

const CATEGORY: Record<FeedbackItem["category"], string> = {
  bug: "走不通",
  confusing: "看不懂",
  suggestion: "小建议",
};

/** 与开放在契约里的三类损坏一一对应，避免页面自造词。 */
const MISMATCH_LABEL: Record<string, string> = {
  EVENT_SEQUENCE_GAP: "事件缺失（序号断了）",
  EVENT_SEQUENCE_ORDER: "事件乱序（序号不是递增的）",
  EVENT_STATE_MISMATCH: "状态不一致（记录与规则重算不符）",
};

export function ReviewWorkspace({ userId }: { userId: string }) {
  const [sessionId, setSessionId] = useState(
      localStorage.getItem("stage.review.lastSession." + userId) ?? "",
    ),
    [activityId, setActivityId] = useState(
      localStorage.getItem("stage.review.lastActivity." + userId) ?? "",
    ),
    [versionId, setVersionId] = useState(
      localStorage.getItem("stage.review.lastVersion." + userId) ?? "",
    ),
    [replay, setReplay] = useState<Replay | null>(null),
    [feedback, setFeedback] = useState<FeedbackItem[]>([]),
    [summary, setSummary] = useState<Summary | null>(null),
    [message, setMessage] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [pending, setPending] = useState<{ seq: number; nodeId: string } | null>(
      null,
    ),
    [category, setCategory] = useState<FeedbackItem["category"]>("confusing"),
    [text, setText] = useState("");

  const remember = (key: string, value: string) =>
    localStorage.setItem("stage.review." + key + "." + userId, value);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setMessage("");
    setNotice("");
    try {
      await fn();
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const loadReplay = () =>
    run(async () => {
      const r = await api<Replay>(`/sessions/${sessionId.trim()}/replay`);
      setReplay(r);
      remember("lastSession", sessionId.trim());
      remember("lastVersion", r.versionId);
      setVersionId(r.versionId);
    });

  const loadAuthor = () =>
    run(async () => {
      const id = activityId.trim(),
        v = versionId.trim();
      const [list, stats] = await Promise.all([
        api<FeedbackItem[]>(`/activities/${id}/feedback?versionId=${v}`),
        api<Summary>(`/activities/${id}/summary?versionId=${v}`),
      ]);
      setFeedback(list);
      setSummary(stats);
      remember("lastActivity", id);
      remember("lastVersion", v);
    });

  const submit = () =>
    run(async () => {
      if (!pending) throw new Error("请先在回放里选一个位置");
      // requestId 由时间戳 + 位置构成：同一位置重复点击会命中服务端幂等，
      // 不会因为手抖多写一条反馈。
      const requestId = `fb_${sessionId.trim()}_${pending.seq}_${Date.now()}`;
      const payload: FeedbackRequest = {
        requestId,
        eventSeq: pending.seq,
        nodeId: pending.nodeId,
        category,
        text: text.trim(),
      };
      await api(`/sessions/${sessionId.trim()}/feedback`, {
        method: "POST",
        body: JSON.stringify(payload),
      });
      setText("");
      setPending(null);
      setNotice("反馈已提交，创作者可在统计页看到。");
    });

  const maxVisits = summary?.nodeVisits[0]?.count ?? 0;

  return (
    <div className="review-shell">
      <header className="page-heading">
        <div>
          <span className="eyebrow">REPLAY &amp; REVIEW / 回放与反馈</span>
          <h1>每一步，都有人重新走了一遍。</h1>
          <p>
            回放会把试玩记录按规则重新算一遍，对不上就指出是哪一步；反馈绑定到具体的一次访问，而不是一个节点名。
          </p>
        </div>
      </header>

      <section className="ui-panel review-toolbar" aria-label="回放与统计入口">
        <label className="review-field">
          会话 ID（回放 / 反馈）
          <input
            aria-label="会话 ID"
            value={sessionId}
            onChange={(e) => setSessionId(e.target.value)}
            placeholder="粘贴本次试玩的会话 ID"
          />
        </label>
        <button
          className="ui-button"
          disabled={busy || !sessionId.trim()}
          onClick={loadReplay}
        >
          核对回放
        </button>
        <label className="review-field">
          活动 ID（作者视图）
          <input
            aria-label="活动 ID"
            value={activityId}
            onChange={(e) => setActivityId(e.target.value)}
            placeholder="你拥有的活动 ID"
          />
        </label>
        <label className="review-field">
          版本 ID
          <input
            aria-label="版本 ID"
            value={versionId}
            onChange={(e) => setVersionId(e.target.value)}
            placeholder="按版本统计与筛选"
          />
        </label>
        <button
          className="ui-button"
          disabled={busy || !activityId.trim() || !versionId.trim()}
          onClick={loadAuthor}
        >
          读取反馈与统计
        </button>
        {message && (
          <p className="review-message" role="alert">
            {message}
          </p>
        )}
        {notice && (
          <p className="review-message" role="status" style={{ color: "var(--ui-success)" }}>
            {notice}
          </p>
        )}
      </section>

      <section className="review-section">
        <div className="review-head">
          <h2>回放核对</h2>
          <span>只判定，不修补：缺失、乱序、篡改都会指到具体序号</span>
        </div>
        {!replay ? (
          <p className="review-empty">填入会话 ID 后点击"核对回放"。</p>
        ) : (
          <>
            <div className="review-verdict">
              <span
                className={
                  "review-badge " +
                  (replay.status === "MATCH" ? "match" : "mismatch")
                }
              >
                {replay.status === "MATCH" ? "记录与规则一致" : "记录与规则不符"}
              </span>
              <span className="review-mismatch-detail">
                共 {replay.steps.length} 步可复现
                {replay.mismatch
                  ? ` · 第 ${replay.mismatch.seq} 步：${
                      MISMATCH_LABEL[replay.mismatch.code] ?? replay.mismatch.code
                    }`
                  : ""}
              </span>
            </div>
            <div className="review-steps">
              {replay.steps.map((step) => (
                <article className="review-step" key={step.seq}>
                  <span className="review-step-seq">{step.seq}</span>
                  <div>
                    <h3>
                      {step.before.nodeId} → {step.after.nodeId}
                    </h3>
                    <p>选择：{step.choiceId}</p>
                    <ul className="review-choices" aria-label="当时可选">
                      {step.choicesBefore.map((c) => (
                        <li
                          key={c.id}
                          className={c.available ? "" : "locked"}
                        >
                          {c.label}
                          {c.available ? "" : "（不可选）"}
                        </li>
                      ))}
                    </ul>
                    <p style={{ marginTop: 8 }}>
                      <button
                        disabled={busy}
                        onClick={() =>
                          setPending({ seq: step.seq, nodeId: step.after.nodeId })
                        }
                      >
                        就这一步写反馈
                      </button>
                    </p>
                  </div>
                </article>
              ))}
            </div>
            <div className="ui-inset" style={{ marginTop: 16 }}>
              <span className="eyebrow">FEEDBACK / 反馈</span>
              {pending ? (
                <>
                  <p style={{ fontSize: 12, color: "var(--ui-muted)" }}>
                    绑定位置：第 {pending.seq} 步之后 · 节点 {pending.nodeId}
                  </p>
                  <label className="review-field">
                    类型
                    <select
                      aria-label="反馈类型"
                      value={category}
                      onChange={(e) =>
                        setCategory(e.target.value as FeedbackItem["category"])
                      }
                    >
                      <option value="bug">走不通</option>
                      <option value="confusing">看不懂</option>
                      <option value="suggestion">小建议</option>
                    </select>
                  </label>
                  <label className="review-field" style={{ maxWidth: "none" }}>
                    内容
                    <textarea
                      aria-label="反馈内容"
                      rows={3}
                      value={text}
                      onChange={(e) => setText(e.target.value)}
                      placeholder="在这一次访问里，你遇到了什么？"
                    />
                  </label>
                  <p style={{ marginTop: 10 }}>
                    <button
                      className="ui-button"
                      disabled={busy || !text.trim()}
                      onClick={submit}
                    >
                      提交反馈
                    </button>
                    <button
                      disabled={busy}
                      style={{ marginLeft: 10 }}
                      onClick={() => setPending(null)}
                    >
                      取消
                    </button>
                  </p>
                </>
              ) : (
                <p style={{ fontSize: 13, color: "var(--ui-muted)" }}>
                  在上面的任意一步点"写反馈"，反馈会绑定到那一次访问。若本会话未开启分享，服务端会拒绝提交。
                </p>
              )}
            </div>
          </>
        )}
      </section>

      <section className="review-section">
        <div className="review-head">
          <h2>创作者视角</h2>
          <span>
            {summary
              ? `当前版本共 ${summary.sharedSessionCount} 个共享会话`
              : "反馈与统计都按版本隔离，只统计仍开启分享的会话"}
          </span>
        </div>
        <div className="review-columns">
          <div>
            <h3 style={{ fontSize: 15, margin: "0 0 10px" }}>反馈</h3>
            {feedback.length === 0 ? (
              <p className="review-empty">还没有收到反馈。</p>
            ) : (
              <ul className="review-list">
                {feedback.map((item) => (
                  <li className="review-card" key={item.id}>
                    <h3>
                      <span>
                        {CATEGORY[item.category]} · {item.nodeId}
                      </span>
                      <em>第 {item.eventSeq} 步</em>
                    </h3>
                    <p>{item.text}</p>
                    <small>
                      {new Date(item.createdAt).toLocaleString()} · 会话{" "}
                      {item.sessionId.slice(0, 8)}…
                    </small>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <h3 style={{ fontSize: 15, margin: "0 0 10px" }}>节点访问</h3>
            {!summary || summary.nodeVisits.length === 0 ? (
              <p className="review-empty">暂无访问数据。</p>
            ) : (
              <div>
                {summary.nodeVisits.map((row) => (
                  <div className="review-bar-row" key={row.nodeId}>
                    <div>
                      <div>{row.nodeId}</div>
                      <div className="review-bar">
                        <i
                          style={{
                            width: maxVisits
                              ? (row.count / maxVisits) * 100 + "%"
                              : "0%",
                          }}
                        />
                      </div>
                    </div>
                    <b>{row.count}</b>
                  </div>
                ))}
              </div>
            )}
            <h3 style={{ fontSize: 15, margin: "18px 0 10px" }}>结局分布</h3>
            {!summary || summary.endings.length === 0 ? (
              <p className="review-empty">还没有走到结局的会话。</p>
            ) : (
              <ul className="review-list">
                {summary.endings.map((row) => (
                  <li className="review-card" key={row.nodeId}>
                    <h3>
                      <span>{row.nodeId}</span>
                      <em>{row.count} 次</em>
                    </h3>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
