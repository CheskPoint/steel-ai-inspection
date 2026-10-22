"use client";

import { useState, type FormEvent } from "react";
import { patch, post } from "./api";
import type { Role, User, Workspace } from "./platform-types";
import { dateText, displayStatus } from "./platform-types";
import { roleDescriptions, permissionRows } from "./roles";
import AuditView from "./AuditView";
import { Badge, Drawer, Empty, ErrorNote, Field, Form, getForm, messageOf, SectionHeading } from "./ui";

export default function UserDirectory({ data, user, reload }: { data: Workspace; user: User; reload: () => Promise<void> }) {
  const [editing, setEditing] = useState<User | "new" | null>(null);
  const [activity, setActivity] = useState<User | null>(null);
  const [role, setRole] = useState<Role>("inspector");
  const [query, setQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const [stateFilter, setStateFilter] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  if (user.role !== "admin") return <Empty title="需要管理员权限"/>;
  const openEditor = (target: User | "new") => { setError(""); setSuccess(""); setRole(target === "new" ? "inspector" : target.role); setEditing(target); };
  const users = data.users.filter(u => `${u.username} ${u.display_name}`.toLowerCase().includes(query.toLowerCase()) && (!roleFilter || u.role === roleFilter) && (!stateFilter || String(u.active) === stateFilter));
  async function save(event: FormEvent<HTMLFormElement>) {
    const values = getForm(event);
    const body: Record<string, unknown> = { display_name: values.display_name, role: values.role };
    if (values.password) body.password = values.password;
    if (editing === "new") body.username = values.username;
    else body.active = values.active === "true";
    setBusy(true); setError("");
    try {
      const target = editing as User;
      if (editing === "new") await post("/users", body);
      else await patch(`/users/${target.id}`, body);
      // Role, status and password changes intentionally revoke the affected sessions.
      if (editing !== "new" && target.id === user.id && (values.password || body.role !== user.role || !body.active)) { window.location.assign("/login"); return; }
      await reload(); setEditing(null); setSuccess("账号已保存；角色、停用或密码变更后，该员工需要重新登录。");
    } catch (e) { setError(messageOf(e)); } finally { setBusy(false); }
  }
  return <><SectionHeading title="用户与权限" description="集中管理团队账号，明确每个人可以做什么。" action={<button className="primary" onClick={() => openEditor("new")}>＋ 添加用户</button>}/>
    <div className="sv-role-summary">{(["admin", "inspector"] as Role[]).map(r => <button key={r} className={roleFilter === r ? "is-selected" : ""} aria-pressed={roleFilter === r} onClick={() => setRoleFilter(roleFilter === r ? "" : r)}><span>{displayStatus(r)}</span><strong>{data.users.filter(u => u.role === r && u.active).length}<small>启用中</small></strong><p>{roleDescriptions[r]}</p></button>)}</div>
    <section className="sv-directory"><div className="sv-directory-head"><div><h3>团队成员</h3><p>{data.users.length} 个账号 · {data.users.filter(u => !u.active).length} 个已停用</p></div><span className="sv-access-note">按角色分配权限</span></div>
      <div className="sv-toolbar"><input aria-label="搜索员工" placeholder="搜索姓名或登录账号…" value={query} onChange={e => setQuery(e.target.value)}/><select aria-label="筛选角色" value={roleFilter} onChange={e => setRoleFilter(e.target.value)}><option value="">全部角色</option>{(["admin", "inspector"] as Role[]).map(r => <option key={r} value={r}>{displayStatus(r)}</option>)}</select><select aria-label="筛选账号状态" value={stateFilter} onChange={e => setStateFilter(e.target.value)}><option value="">全部状态</option><option value="true">启用</option><option value="false">停用</option></select><span>{users.length} 位成员</span></div>
      {success && <p className="sv-success" role="status">{success}</p>}<ErrorNote text={!editing ? error : ""}/>
      {users.length ? <div className="sv-table-scroll"><table className="sv-user-table"><thead><tr><th>成员 / 登录账号</th><th>角色</th><th>状态</th><th>最近登录</th><th>管理</th></tr></thead><tbody>{users.map(u => {
        const login = u.last_login_at;
        return <tr key={u.id} className="sv-user-row sv-user-card"><td><div className="sv-member"><span className="sv-member-avatar">{u.display_name[0] || u.username[0]}</span><div><b>{u.display_name}{u.id === user.id && <small className="sv-self">本人</small>}</b><small>@{u.username}</small></div></div></td><td><Badge value={u.role}/></td><td><span className={u.active ? "sv-account-active" : "sv-account-disabled"}>{u.active ? "已启用" : "已停用"}</span></td><td className="sv-last-login">{login ? dateText(login) : "尚未登录"}</td><td><div className="sv-row-actions"><button className="sv-text-button" onClick={() => { setActivity(u); }}>查看操作</button><button className="quiet" onClick={() => openEditor(u)}>编辑权限</button></div></td></tr>;
      })}</tbody></table></div> : <Empty title="没有匹配的员工">调整搜索条件，或添加新账号。</Empty>}
    </section>
    <details className="sv-permission-details"><summary>查看完整权限对照表 <span>管理员与员工的权限边界</span></summary><div className="sv-table-scroll"><table className="sv-permission-table"><thead><tr><th>能力</th><th>总管理员</th><th>员工</th></tr></thead><tbody>{permissionRows.map(row => <tr key={row[0]}>{row.map((cell, index) => index === 0 ? <th key={index} scope="row">{cell}</th> : <td key={index}>{cell}</td>)}</tr>)}</tbody></table></div></details>
    {editing && <Drawer title={editing === "new" ? "添加用户" : "编辑用户"} subtitle={editing === "new" ? "新员工使用此账号登录后，会进入对应的工作台。" : `@${editing.username} · 权限变更会自动留痕`} onClose={() => { if (!busy) setEditing(null); }}><Form onSubmit={save} busy={busy} error={error}>
      <Field label="登录账号"><input name="username" required maxLength={80} pattern="[A-Za-z0-9_.\-]+" readOnly={editing !== "new"} defaultValue={editing !== "new" ? editing.username : ""}/></Field>
      <Field label="显示名称"><input name="display_name" required maxLength={100} defaultValue={editing !== "new" ? editing.display_name : ""}/></Field>
      <Field label="角色"><select name="role" value={role} onChange={e => setRole(e.target.value as Role)}>{(["admin", "inspector"] as Role[]).map(r => <option key={r} value={r}>{displayStatus(r)}</option>)}</select></Field>
      {editing !== "new" && <Field label="账号状态"><select name="active" defaultValue={String(editing.active)}><option value="true">启用</option><option value="false">停用</option></select></Field>}
      <div className="sv-field-wide sv-role-explanation"><b>{displayStatus(role)}</b><p>{roleDescriptions[role]}</p></div>
      <Field label={editing === "new" ? "初始密码（至少 8 位）" : "重设密码（留空则保留）"} wide><input name="password" type="password" minLength={8} maxLength={256} required={editing === "new"} autoComplete="new-password"/></Field>
      <p className="sv-field-wide sv-footnote">管理员可重设密码，不能查看原密码。至少保留一位启用的总管理员。</p>
    </Form></Drawer>}
    {activity && <Drawer title={`${activity.display_name}的操作记录`} subtitle={`@${activity.username} · ${displayStatus(activity.role)}`} onClose={() => setActivity(null)} wide><AuditView logs={[]} users={data.users} admin={true} fixedActor={activity.id}/></Drawer>}
  </>;
}
