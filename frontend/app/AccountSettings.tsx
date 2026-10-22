"use client";

import { useState } from "react";
import { patch, post } from "./api";
import type { Workspace, User } from "./platform-types";
import { displayStatus } from "./platform-types";
import { roleDescriptions } from "./roles";
import { Badge, Field, Form, getForm, messageOf, SectionHeading } from "./ui";

export default function AccountSettings({ data, user, reload }: { data: Workspace; user: User; reload: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [success, setSuccess] = useState("");
  const admin = user.role === "admin";
  return <><SectionHeading title={admin ? "系统设置" : "个人设置"} description={admin ? "调整检测默认值、报告信息与个人账号。" : "查看自己的角色与访问范围，管理登录密码。"}/><div className="sv-split">
    <section className="sv-card">{admin ? <><SectionHeading title="检测与报告"/><Form onSubmit={async e => { const v = getForm(e); setBusy(true); setError(""); setSuccess(""); try { await patch("/settings", { ...v, threshold: Number(v.threshold), interval_ms: Number(v.interval_ms) }); await reload(); setSuccess("已保存"); } catch (e) { setError(messageOf(e)); } finally { setBusy(false); } }} busy={busy} error={error}>
      <Field label="默认置信度阈值"><input name="threshold" type="number" step="0.01" min="0.1" max="0.95" defaultValue={data.settings.threshold} required/></Field>
      <Field label="连续检测间隔（毫秒）"><input name="interval_ms" type="number" min="100" max="10000" step="100" defaultValue={data.settings.interval_ms} required/></Field>
      <Field label="报告标题" wide><input name="report_title" required defaultValue={data.settings.report_title}/></Field><Field label="单位名称" wide><input name="company_name" defaultValue={data.settings.company_name}/></Field>
    </Form></> : <><SectionHeading title="我的账号"/><div className="sv-member"><span className="sv-member-avatar">{user.display_name[0]}</span><div><b>{user.display_name}</b><small>@{user.username}</small></div></div><div className="sv-personal-role"><Badge value={user.role}/><span className="sv-account-active">已启用</span></div><p className="sv-role-copy">{roleDescriptions[user.role]}</p><p className="sv-note">如工作职责发生变化，请联系管理员调整角色。</p></>}</section>
    <section className="sv-card"><SectionHeading title="账号安全" description={`${user.display_name} · ${displayStatus(user.role)}`}/><Form onSubmit={async e => { const values = getForm(e); const form = e.currentTarget; setBusy(true); setPasswordError(""); setSuccess(""); try { await post("/auth/password", values); form.reset(); setSuccess("密码已更新，其他设备上的登录已失效。"); await reload(); } catch (e) { setPasswordError(messageOf(e)); } finally { setBusy(false); } }} busy={busy} error={passwordError} submit="更新密码">
      <Field label="当前密码" wide><input name="current_password" type="password" autoComplete="current-password" required/></Field><Field label="新密码（至少 8 位）" wide><input name="new_password" type="password" autoComplete="new-password" minLength={8} maxLength={256} required/></Field>
    </Form></section></div>{success && <p className="sv-success" role="status">{success}</p>}</>;
}
