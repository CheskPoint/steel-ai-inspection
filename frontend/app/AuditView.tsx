"use client";

import { useState } from "react";
import type { Log, User } from "./platform-types";
import { dateText, displayStatus } from "./platform-types";
import { Empty, ErrorNote, SectionHeading } from "./ui";

export function logDetail(log: Log): string {
  if (typeof log.detail === "string") return log.detail;
  if (!log.detail) return "";
  const detail = log.detail;
  const parts: string[] = [];
  if (typeof detail.username === "string") parts.push(`账号 @${detail.username}`);
  if (typeof detail.role === "string") parts.push(`角色：${displayStatus(detail.role)}`);
  if (detail.changes && typeof detail.changes === "object") {
    const fields: Record<string, string> = { role: "角色", active: "状态", display_name: "显示名称" };
    for (const [key, value] of Object.entries(detail.changes)) {
      const change = value as { before: unknown; after: unknown };
      const format = (v: unknown) => typeof v === "boolean" ? (v ? "启用" : "停用") : displayStatus(String(v));
      parts.push(`${fields[key] || key}：${format(change.before)} → ${format(change.after)}`);
    }
  }
  if (detail.password_reset) parts.push("已重设密码（原会话已失效）");
  if (typeof detail.reason === "string") parts.push(detail.reason);
  return parts.join("；") || JSON.stringify(detail);
}

export function ActivityList({ logs }: { logs: Log[] }) {
  if (!logs.length) return <Empty title="暂无操作记录">登录、检测归档、复核和配置变更后会自动记录。</Empty>;
  return <div className="sv-timeline sv-audit">{logs.map(log => <div key={log.id}>
    <i aria-hidden="true"/><div className="sv-audit-title"><b>{displayStatus(log.action)}</b><time>{dateText(log.created_at)}</time></div>
    <p>{log.actor || log.username || "系统"}{(log.entity_id || log.target) && <span className="sv-log-target"> · 对象 {log.entity_id || log.target}</span>}</p>
    {logDetail(log) && <small>{logDetail(log)}</small>}
  </div>)}</div>;
}

import { useQuery, queryString } from "./useQuery";

export default function AuditView({ users, admin, fixedActor }: { logs: Log[]; users: User[]; admin: boolean; fixedActor?:string }) {
  const [query, setQuery] = useState("");
  const [actor, setActor] = useState("");
  const [action, setAction] = useState("");
  const [day, setDay] = useState("");
  const [offset,setOffset]=useState(0);
  const result=useQuery<{items:Log[];total:number;actions:string[]}>(`/audit-logs?${queryString({query,actor:fixedActor||actor,action,day,offset,limit:50})}`);
  const logs=result.data?.items||[];
  const total=result.data?.total||0;
  return <><SectionHeading title={admin ? "操作日志" : "我的操作"} description={admin ? "按员工、操作和日期追踪关键业务及权限变更。记录由系统自动生成。" : "仅展示本人操作；其他员工的账号与操作记录仅管理员可见。"}/>
    <div className="sv-filter-panel">
      <input aria-label="搜索操作日志" placeholder="搜索操作、账号或变更内容…" value={query} onChange={e => { setQuery(e.target.value); setOffset(0); }}/>
      {admin && !fixedActor && <select aria-label="操作员工" value={actor} onChange={e => { setActor(e.target.value); setOffset(0); }}><option value="">全部员工</option>{users.map(user => <option key={user.id} value={user.id}>{user.display_name} · {user.username}</option>)}</select>}
      <select aria-label="操作类型" value={action} onChange={e => { setAction(e.target.value); setOffset(0); }}><option value="">全部操作</option>{(result.data?.actions||[]).map(value => <option key={value} value={value}>{displayStatus(value)}</option>)}</select>
      <input aria-label="操作日期" type="date" value={day} onChange={e => { setDay(e.target.value); setOffset(0); }}/>
      <button className="sv-text-button" onClick={() => { setQuery(""); setActor(""); setAction(""); setDay(""); setOffset(0); }}>重置</button>
    </div><ErrorNote text={result.error||""}/>{result.loading?<p role="status">正在加载日志…</p>:<><p className="sv-footnote">共 {total} 条记录 · 北京时间</p>
    <section className="sv-card"><ActivityList logs={logs}/>{total>50&&<div className="sv-pagination"><button className="quiet" disabled={!offset} onClick={()=>setOffset(Math.max(0,offset-50))}>上一页</button><span>{Math.floor(offset/50)+1} / {Math.ceil(total/50)}</span><button className="quiet" disabled={offset+50>=total} onClick={()=>setOffset(offset+50)}>下一页</button></div>}</section></>}</>;
}
