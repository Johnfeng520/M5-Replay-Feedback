import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { api } from "./api";
import { AuthorWorkspace } from "./author/AuthorWorkspace";
import { PlayerEngine } from "./features/player/PlayerEngine";
import "./style.css";
import "./stage.css";
function App() {
  const [user, setUser] = useState<{ id: string; email: string } | null>(null),
    [checking, setChecking] = useState(true),
    [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [message, setMessage] = useState(""),
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
    }
  };
  if (checking) return <main>正在读取登录状态…</main>;
  if (!user)
    return (
      <main className="login">
        <h1>互动剧情创作与试玩验证平台</h1>
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
            />
          </label>
          <button>登录</button>
          <p role="alert">{message}</p>
        </form>
      </main>
    );
  return (
    <>
      <nav className="stage-nav">
        <strong>互动剧情平台</strong>
        <a href="#/author">创作</a>
        <a href="#/player">试玩与存档</a>
        <span>{user.email}</span>
        <button
          onClick={async () => {
            await api("/auth/logout", { method: "POST" });
            setUser(null);
          }}
        >
          退出
        </button>
      </nav>
      {route.startsWith("#/player") ? (
        <PlayerEngine key={route + user.id} userId={user.id} />
      ) : (
        <AuthorWorkspace />
      )}
    </>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
