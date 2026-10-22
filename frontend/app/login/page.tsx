"use client";

import { useState, useSyncExternalStore, type FormEvent } from "react";
import { post } from "../api";
import type { Role } from "../platform-types";
import "./login.css";

export default function LoginPage() {
  const ready = useSyncExternalStore(() => () => {}, () => true, () => false);
  const [role, setRole] = useState<Role>("inspector");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await post("/auth/login", { username, password, role });
      window.location.assign("/");
    } catch (e) {
      setError(e instanceof Error ? e.message : "登录失败，请重试");
    } finally {
      setBusy(false);
    }
  }

  return <main className="login">
    <section className="login-hero"><div className="grid"/><div className="hero-copy"><span>CR7</span><p>CR7 VISION · AI QUALITY INSPECTION</p><h1>让每一处细微<br/>都有迹可循</h1><small>冷轧钢板表面缺陷检测与质量追溯平台</small></div><div className="steel-ribbon"/></section>
    <section className="login-form"><form onSubmit={signIn}>
      <div className="login-brand"><b>CR7</b><strong>CR7 智检</strong></div>
      <p className="eyebrow">WELCOME BACK</p><h2>登录质检工作台</h2>
      <p>选择你的身份，进入对应的工作空间。</p>
      <div className="login-entry-options" role="group" aria-label="登录身份">
        {(["inspector", "admin"] as const).map(entry => <button key={entry} type="button" className="login-entry-button" aria-label={entry === "admin" ? "管理员登录" : "员工登录"} aria-pressed={role === entry} disabled={busy || !ready} onClick={() => { setRole(entry); setError(""); }}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d={entry === "admin" ? "M12 3l8 3v6c0 5-8 9-8 9s-8-4-8-9V6z M8 12l3 3 5-6" : "M16 7a4 4 0 1 1-8 0 4 4 0 1 1 8 0 M4 21v-2a8 8 0 0 1 16 0v2"}/>
          </svg>
          <span><strong>{entry === "admin" ? "管理员登录" : "员工登录"}</strong><small>{entry === "admin" ? "团队与权限管理" : "检测与业务操作"}</small></span>
          <i aria-hidden="true">{role === entry ? "✓" : ""}</i>
        </button>)}
      </div>
      <label>账号<input value={username} onChange={e => setUsername(e.target.value)} placeholder={role === "admin" ? "请输入管理员账号" : "请输入员工账号"} autoComplete="username" required disabled={busy || !ready}/></label>
      <label>密码<input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="请输入密码" autoComplete="current-password" required disabled={busy || !ready}/></label>
      {error && <div className="login-error" role="alert">{error}</div>}
      <button type="submit" disabled={busy || !ready}>{busy ? "正在登录…" : "进入工作台"}<span>→</span></button>
      <small className="login-foot">{role === "admin" ? "管理员可管理团队账号、角色权限与系统配置。" : "员工账号由管理员分配，可执行检测、复核与生产业务操作。"}</small>
    </form></section>
  </main>;
}
