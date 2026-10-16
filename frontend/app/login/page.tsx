"use client";

import { FormEvent, useState } from "react";

export default function LoginPage() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const signIn = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (username === "admin" && password === "admin123") { sessionStorage.setItem("steelvision_demo_account", "admin"); window.location.assign("/"); return; }
    setError("账号或密码错误，请重新输入。");
  };
  return <main className="login"><section className="login-hero"><div className="grid" /><div className="hero-copy"><span>SV</span><p>STEELVISION · AI QUALITY INSPECTION</p><h1>让每一处划痕<br />都有迹可循</h1><small>热轧钢表面缺陷检测与质量追溯平台</small></div><div className="steel-ribbon" /></section><section className="login-form"><form onSubmit={signIn}><div className="login-brand"><b>SV</b><strong>SteelVision</strong></div><p className="eyebrow">DEMO ACCESS · 演示登录</p><h2>登录系统</h2><p>使用演示账号查看质检业务框架、真实空状态与后续设备、模型接入边界。</p><label>账号<input value={username} onChange={(event) => setUsername(event.target.value)} placeholder="请输入账号" autoComplete="username" required /></label><label>密码<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="请输入密码" autoComplete="current-password" required /></label>{error && <div className="login-error">{error}</div>}<button type="submit">进入演示系统 <span>→</span></button><div className="credentials"><b>演示账号</b><span>admin</span><b>演示密码</b><span>admin123</span></div><small className="login-foot">当前为前端演示登录，不是服务端账号体系。正式部署应接入认证、权限与审计。</small></form></section></main>;
}
