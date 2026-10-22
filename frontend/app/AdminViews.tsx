"use client";
/* eslint-disable @next/next/no-img-element -- Authenticated media and Blob frames must be fetched directly by the browser. */

import { useState, type FormEvent } from "react";
import UserDirectory from "./UserDirectory";
import AccountSettings from "./AccountSettings";
import AuditView from "./AuditView";
import { api, mediaUrl, patch } from "./api";
import type { Workspace, Knowledge, User, Alert, View } from "./platform-types";
import { dateText, displayStatus, LEGACY_MODEL_CLASSES } from "./platform-types";
import { Badge, Drawer, Empty, ErrorNote, Field, Form, getForm, messageOf, SectionHeading } from "./ui";

export function KnowledgeView({ data, canEdit, reload }: { data: Workspace; canEdit: boolean; reload: () => Promise<void> }) {
  const [entry,setEntry]=useState<Knowledge|null>(null);const [busy,setBusy]=useState(false);const [error,setError]=useState("");
  const classes = data.model_classes ?? LEGACY_MODEL_CLASSES;
  const [showHistory, setShowHistory] = useState(false);
  const entries = showHistory ? data.knowledge.filter(k=>!classes.includes(k.key)) : classes.flatMap(key=>data.knowledge.filter(k=>k.key===key));
  async function save(event:FormEvent<HTMLFormElement>){event.preventDefault();const form=new FormData(event.currentTarget);setBusy(true);setError("");try{await patch(`/knowledge/${entry!.key}`,{name:form.get("name"),description:form.get("description"),features:form.get("features"),notes:form.get("notes")});const image=form.get("image");if(image instanceof File&&image.size){const body=new FormData();body.set("file",image);await api(`/knowledge/${entry!.key}/image`,{method:"POST",body});}await reload();setEntry(null);}catch(e){setError(messageOf(e));}finally{setBusy(false);}}
  return <><SectionHeading title="缺陷知识库" description={`当前模型识别 ${classes.length} 类缺陷；历史类别知识仍可查看与维护。`}/><div className="sv-toolbar"><button className={!showHistory?"primary":"quiet"} onClick={()=>setShowHistory(false)}>当前模型类别</button><button className={showHistory?"primary":"quiet"} onClick={()=>setShowHistory(true)}>历史类别</button></div><div className="sv-card-grid sv-knowledge-grid">{entries.map((k,i)=><button className="sv-knowledge-card" key={k.key} onClick={()=>{setEntry(k);setError("");}}><div className={`sv-defect-art sv-defect-${LEGACY_MODEL_CLASSES.indexOf(k.key)}`}>{k.image_url?<img src={mediaUrl(k.image_url)} alt={k.name}/>:<><i/><i/><i/><span>0{i+1}</span><small className="sv-art-label">类别示意</small></>}</div><div><small>{k.key.toUpperCase().replaceAll("_"," ")}</small><h3>{k.name}</h3><p>{k.description || "点击完善类别说明与识别要点。"}</p><b>查看条目 ↗</b></div></button>)}</div>{entry&&<Drawer title={entry.name} subtitle={entry.key} onClose={()=>setEntry(null)}>{canEdit?<Form onSubmit={save} busy={busy} error={error}><Field label="类别名称" wide><input name="name" required defaultValue={entry.name}/></Field><Field label="缺陷说明" wide><textarea name="description" rows={4} defaultValue={entry.description}/></Field><Field label="形态与识别要点" wide><textarea name="features" rows={4} defaultValue={entry.features}/></Field><Field label="现场经验与备注" wide><textarea name="notes" rows={3} defaultValue={entry.notes}/></Field><Field label="替换示例图" wide><input type="file" name="image" accept="image/jpeg,image/png"/></Field></Form>:<div className="sv-prose">{entry.image_url&&<img className="sv-reference-image" src={mediaUrl(entry.image_url)} alt={entry.name}/>}<h3>缺陷说明</h3><p>{entry.description}</p><h3>识别要点</h3><p>{entry.features || "尚未补充"}</p><h3>现场备注</h3><p>{entry.notes || "尚未补充"}</p></div>}</Drawer>}</>;
}

export function AdminView({ view,data,user,reload }: { view:View;data:Workspace;user:User;reload:()=>Promise<void> }) {
  const [alert,setAlert]=useState<Alert|null>(null);const [busy,setBusy]=useState(false);const [error,setError]=useState("");const [query,setQuery]=useState("");const [status,setStatus]=useState("");
  const canEdit=user.role==="admin"||user.role==="inspector";
  async function perform(action:()=>Promise<unknown>,done?:()=>void){setBusy(true);setError("");try{await action();await reload();done?.();}catch(e){setError(messageOf(e));}finally{setBusy(false);}}
  if(view==="users")return <UserDirectory data={data} user={user} reload={reload}/>;
  if(view==="settings")return <AccountSettings data={data} user={user} reload={reload}/>;
  if(view==="logs")return <AuditView logs={data.logs} users={data.users} admin={user.role==="admin"}/>;
  if(view==="alerts"){const alerts=data.alerts.filter(a=>(!status||a.status===status)&&`${a.message} ${a.kind}`.includes(query));return <><SectionHeading title="告警中心" description="查看异常、确认接手并记录处理结果。"/><div className="sv-toolbar"><input placeholder="搜索告警…" aria-label="搜索告警" value={query} onChange={e=>setQuery(e.target.value)}/><select aria-label="告警状态" value={status} onChange={e=>setStatus(e.target.value)}><option value="">全部状态</option>{["open","acknowledged","resolved"].map(s=><option key={s} value={s}>{displayStatus(s)}</option>)}</select></div>{!alerts.length?<Empty title="当前没有匹配的告警">实际发生的设备与系统异常会记录在这里。</Empty>:<div className="sv-card-grid">{alerts.map(a=><article className="sv-card" key={a.id}><div className="sv-card-top"><span className="sv-alert-symbol">!</span><Badge value={a.status}/></div><h3>{displayStatus(a.kind)}</h3><p>{a.message}</p>{a.note&&<p className="sv-note">{a.note}</p>}<div className="sv-card-footer"><small>{dateText(a.created_at)}</small>{canEdit&&<button className="quiet" onClick={()=>{setAlert(a);setError("");}}>处理</button>}</div></article>)}</div>}{alert&&<Drawer title="处理告警" subtitle={alert.message} onClose={()=>setAlert(null)}><Form onSubmit={e=>{const values=getForm(e);void perform(()=>patch(`/alerts/${alert.id}`,values),()=>setAlert(null));}} busy={busy} error={error}><Field label="处理状态"><select name="status" defaultValue="acknowledged"><option value="acknowledged">已确认，处理中</option><option value="resolved">已处理</option></select></Field><Field label="处理记录" wide><textarea name="note" required rows={4} defaultValue={alert.note}/></Field></Form></Drawer>}</>;}
  return <ErrorNote text="未知管理页面"/>;
}
