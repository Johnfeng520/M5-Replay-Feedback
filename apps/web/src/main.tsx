import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { api } from "./api";
import { AuthorWorkspace } from "./author/AuthorWorkspace";
import { PlayerEngine } from "./features/player/PlayerEngine";
import emblem from "./ui/assets/ornate/slider_block.png";
import "./style.css";
import "./stage.css";
import "./ui/theme.css";

function App() {
  const [user, setUser] = useState<{ id: string; email: string } | null>(null),
    [checking, setChecking] = useState(true),
    [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [message, setMessage] = useState(""),
    [loggingIn, setLoggingIn] = useState(false),
    [route, setRoute] = useState(location.hash || "#/author");
  useEffect(() => {
    api("/auth/me")
      .then(setUser)
      .catch(() => {})
      .finally(() => setChecking(false));
    const change = () => setRoute(location.hash || "#/author");
    addEventListener("hashchange", change);
    return () => removeEventListener("hashchange", change);
  }, []);
  const login = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage("");
    setLoggingIn(true);
    try {
      setUser(
        await api("/auth/login", {
          method: "POST",
          body: JSON.stringify({ email, password }),
        }),
      );
      setPassword("");
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setLoggingIn(false);
    }
  };
  if (checking)
    return (
      <main className="ui-panel loading-panel">
        <span className="eyebrow">STORY STUDIO</span>
        <p role="status">正在翻开你的故事…</p>
      </main>
    );
  if (!user)
    return (
      <main className="login-shell">
        <section className="login-intro">
          <span className="eyebrow">CAMPUS STORY STUDIO / 互动剧情平台</span>
          <h1>
            把想象，
            <br />
            写成<em>可以游玩</em>
            <br />
            的故事。
          </h1>
          <p>
            一段校园奇遇，几条不同的路线。用文字搭建场景，让每一次选择都有回应。
          </p>
          <div className="login-motif" aria-hidden="true">
            <i />
            <i />
            <i />
          </div>
          <span className="ui-kicker">创作 · 检查 · 发布 · 试玩</span>
        </section>
        <section className="ui-panel login-panel" aria-labelledby="login-title">
          <span className="eyebrow">WELCOME BACK</span>
          <h2 id="login-title">翻开你的故事簿</h2>
          <p>登录后继续创作，或开始一段新的冒险。</p>
          <form onSubmit={login}>
            <label>
              账号
              <input
                aria-label="账号"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="username"
                placeholder="请输入账号邮箱"
              />
            </label>
            <label>
              密码
              <input
                aria-label="密码"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="current-password"
                placeholder="请输入密码"
              />
            </label>
            <button className="ui-button" disabled={loggingIn}>
              {loggingIn ? "正在登录…" : "登录"}
            </button>
            <p className="login-message" role="alert">
              {message}
            </p>
          </form>
          <p className="login-note">文字是起点，选择让故事继续。</p>
        </section>
      </main>
    );
  const playing = route.startsWith("#/player");
  return (
    <>
      <nav className="stage-nav" aria-label="主导航">
        <a className="stage-brand" href="#/author">
          <img className="brand-emblem" src={emblem} alt="" />
          <div>
            <strong>互动剧情平台</strong>
            <small>CAMPUS STORY STUDIO</small>
          </div>
        </a>
        <div className="stage-tabs">
          <a href="#/author" aria-current={!playing ? "page" : undefined}>
            创作工作台
          </a>
          <a href="#/player" aria-current={playing ? "page" : undefined}>
            试玩与存档
          </a>
        </div>
        <div className="stage-account">
          <span title={user.email}>{user.email}</span>
          <button
            onClick={async () => {
              try {
                await api("/auth/logout", { method: "POST" });
                setUser(null);
              } catch (e) {
                setMessage((e as Error).message);
              }
            }}
          >
            退出
          </button>
        </div>
      </nav>
      <main className="stage-main">
        {message && (
          <p role="alert" className="app-message">
            {message}
          </p>
        )}
        {playing ? (
          <PlayerEngine key={route + user.id} userId={user.id} />
        ) : (
          <AuthorWorkspace />
        )}
      </main>
      <footer className="stage-footer">
        <span>让故事有分岔，让选择有回应。</span>
        <span>校园互动故事创作与试玩</span>
      </footer>
    </>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
