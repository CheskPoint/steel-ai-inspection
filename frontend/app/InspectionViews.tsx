"use client";
/* eslint-disable @next/next/no-img-element -- Authenticated media and Blob frames must be fetched directly by the browser. */

import { useRef, useState, type PointerEvent, type FormEvent } from "react";
import { api, mediaUrl, patch, post } from "./api";
import type { Workspace, Inspection, Box } from "./platform-types";
import { dateText, displayStatus, LEGACY_MODEL_CLASSES } from "./platform-types";
import { validBox, type Filters } from "./platform-utils";
import { Badge, Drawer, Empty, ErrorNote, Field, Form, getForm, messageOf, SectionHeading } from "./ui";

import { useQuery, queryString } from "./useQuery";

export function InspectionView({ data, canEdit, reload, review = false }: { data: Workspace; canEdit: boolean; reload: () => Promise<void>; review?: boolean }) {
  const [filters, setFilters] = useState<Filters>({status:review ? "pending" : ""});
  const [batch,setBatch] = useState("");
  const [folder,setFolder] = useState<string|null>(null);
  const [selected,setSelected] = useState<Inspection|null>(null);
  const [error,setError] = useState("");
  const [offset,setOffset] = useState(0);
  const [revision,setRevision] = useState(0);
  const folderMode = !review && !folder;
  const params=queryString({...filters,batch,folder,offset,limit:36});
  const query=useQuery<{items:Inspection[];total:number}>(`/inspections?${params}`,revision,!folderMode);
  const folderQuery=useQuery<{items:Array<{date:string;total:number;pending:number}>;total:number}>(`/inspection-folders?${params}`,revision,folderMode);
  const rows=query.data?.items ?? [];
  const folders=folderQuery.data?.items ?? [];
  const current=folderMode ? folderQuery : query;
  const total=current.data?.total ?? 0;
  const lastOffset=Math.max(0,Math.ceil(total/36)-1)*36;
  if (current.data && offset>lastOffset) setOffset(lastOffset);
  const invalidDates=!!filters.from && !!filters.to && filters.from>filters.to;
  const filter=(key:keyof Filters,value:string)=>{setOffset(0);setFolder(null);setFilters({...filters,[key]:value});};
  async function open(row:Inspection) {setError("");try{setSelected(await api<Inspection>(`/inspections/${row.id}`));}catch(e){setError(messageOf(e));}}
  async function saved(next=false) {
    const id=selected?.id;
    const oldIndex=Math.max(0,rows.findIndex(r=>r.id===id));
    await reload();
    setRevision(n=>n+1);
    if(next) {
      const fresh=await api<{items:Inspection[]}>(`/inspections?${queryString({...filters,batch,folder,offset,limit:37})}`);
      const index=fresh.items.findIndex(r=>r.id===id);
      const nextIndex=index>=0?index+1:oldIndex;
      const following=fresh.items[nextIndex];
      if(nextIndex>=36)setOffset(offset+36);
      if(following) {await open(following);return;}
    }
    setSelected(null);
  }
  return <>
    <SectionHeading title={review?"缺陷复核":"质量追溯"} description={review?"AI 自动确认与人工复核分别留痕；可抽检自动确认结果，修正漏检或误检。":"按北京时间的检测日期归档；筛选覆盖全部记录。"}/>
    {review&&<div className="sv-section-tabs" role="tablist" aria-label="检测状态">{[["pending","待人工复核"],["auto_confirmed","AI 自动确认 · 抽检"],["human_reviewed","人工已复核"],["completed","全部已完成"]].map(([id,title])=><button key={id} role="tab" aria-selected={filters.status===id} className={filters.status===id?"primary":"quiet"} onClick={()=>filter("status",id)}>{title}</button>)}</div>}
    <div className="sv-filter-panel">
      <input aria-label="搜索图片或记录编号" placeholder="搜索图片或记录编号…" value={filters.query||""} onChange={e=>filter("query",e.target.value)}/>
      <select aria-label="筛选批次" value={batch} onChange={e=>{setBatch(e.target.value);setFilters({...filters,coil:""});setOffset(0);setFolder(null);}}><option value="">全部批次</option>{data.batches.map(b=><option key={b.id} value={b.id}>{b.code}</option>)}</select>
      <select aria-label="筛选钢板" value={filters.coil||""} onChange={e=>filter("coil",e.target.value)}><option value="">全部钢板</option>{!batch&&<option value="unassigned">尚未关联</option>}{data.coils.filter(c=>!batch||c.batch_id===batch).map(c=><option key={c.id} value={c.id}>{c.code}</option>)}</select>
      <select aria-label="复核状态" value={filters.status||""} onChange={e=>filter("status",e.target.value)}><option value="">全部检测状态</option><option value="completed">全部已完成</option><option value="human_reviewed">人工已复核</option>{["pending","auto_confirmed","confirmed","corrected","false_positive"].map(state=><option key={state} value={state}>{displayStatus(state)}</option>)}</select>
      <select aria-label="缺陷类型" value={filters.category||""} onChange={e=>filter("category",e.target.value)}><option value="">全部缺陷类型</option>{data.knowledge.map(k=><option key={k.key} value={k.key}>{k.name}</option>)}</select>
      <input aria-label="检测开始日期（北京时间）" type="date" value={filters.from||""} onChange={e=>filter("from",e.target.value)}/>
      <input aria-label="检测结束日期（北京时间）" type="date" value={filters.to||""} onChange={e=>filter("to",e.target.value)}/>
      <button className="quiet" onClick={()=>{setFilters({status:review?"pending":""});setBatch("");setFolder(null);setOffset(0);}}>清空筛选</button>
    </div>
    <ErrorNote text={invalidDates?"开始日期不能晚于结束日期。":error||current.error||""}/>
    {!review&&folder&&<div className="sv-folder-heading"><button className="quiet" onClick={()=>{setFolder(null);setOffset(0);}}>← 全部日期文件夹</button><h3>{folder}</h3></div>}
    {current.loading?<p role="status">正在加载记录…</p>:!invalidDates&&!current.error&&<><p className="sv-footnote">共 {total} {folderMode?"个日期文件夹":"张图像"} · 北京时间 · 每页 36 项</p>
    {!total?<Empty title="没有匹配的检测记录">调整筛选条件，或完成检测后再来查看。</Empty>:folderMode?<div className="sv-folder-grid">{folders.map(item=><button className="sv-folder-card" key={item.date} aria-label={`打开 ${item.date} 文件夹`} onClick={()=>{setFolder(item.date);setOffset(0);}}><svg className="sv-folder-icon" viewBox="0 0 80 64" aria-hidden="true"><path d="M5 17a6 6 0 0 1 6-6h19l8 8h31a6 6 0 0 1 6 6v30H5Z" fill="currentColor" opacity=".3"/><path d="M5 28a5 5 0 0 1 5-5h60a5 5 0 0 1 5 5v25a6 6 0 0 1-6 6H11a6 6 0 0 1-6-6Z" fill="currentColor"/></svg><strong>{item.date}</strong><span>{item.total} 张图片</span><small>{item.total-item.pending} 张已完成 · {item.pending} 张待复核</small><b>打开文件夹 →</b></button>)}</div>:<div className="sv-image-grid">{rows.map(row=><button className="sv-image-card" key={row.id} onClick={()=>void open(row)}><div className="sv-image-cover"><div className="sv-evidence-layer"><img loading="lazy" src={mediaUrl(row.original_image_url)} alt={row.filename}/><svg viewBox={`0 0 ${row.image_width} ${row.image_height}`} aria-label="最终检测框">{(row.reviewed_detections??row.detections).map((b,i)=><rect key={i} x={b.bbox[0]} y={b.bbox[1]} width={b.bbox[2]-b.bbox[0]} height={b.bbox[3]-b.bbox[1]} fill="none" stroke={row.review_status==="pending"?"#ffb454":"#3de0c7"} strokeWidth="2" vectorEffect="non-scaling-stroke"/>)}</svg></div><Badge value={row.review_status}/></div><div className="sv-image-caption"><b title={row.filename}>{row.filename}</b><span>{data.coils.find(c=>c.id===row.coil_id)?.code||"未关联钢板"}</span><span>AI 原始：{row.count} · {row.review_status==="auto_confirmed"?"自动确认":row.review_status==="pending"?"待复核":"复核后"}：{row.reviewed_detections?.length??"—"}</span><small>{dateText(row.created_at)}</small></div></button>)}</div>}
    {total>36&&<div className="sv-pagination"><button className="quiet" disabled={!offset} onClick={()=>setOffset(Math.max(0,offset-36))}>上一页</button><span>{Math.floor(offset/36)+1} / {Math.ceil(total/36)}</span><button className="quiet" disabled={offset+36>=total} onClick={()=>setOffset(offset+36)}>下一页</button></div>}</>}
    {selected&&<InspectionDetail key={selected.id} record={selected} data={data} canEdit={canEdit} onClose={()=>setSelected(null)} onSaved={saved} onLinked={async()=>{await reload();setRevision(n=>n+1);setSelected(await api<Inspection>(`/inspections/${selected.id}`));}}/>}
  </>;
}

function InspectionDetail({ record, data, canEdit, onClose, onSaved, onLinked }: { record: Inspection; data: Workspace; canEdit: boolean; onClose: () => void; onSaved: (next?:boolean) => Promise<void>; onLinked: () => Promise<void> }) {
  const [boxes, setBoxes] = useState<Box[]>(() => structuredClone(record.reviewed_detections ?? record.detections));
  const [selectedBox, setSelectedBox] = useState(0);
  const [status, setStatus] = useState(["pending", "auto_confirmed"].includes(record.review_status) ? "confirmed" : record.review_status);
  const [note, setNote] = useState(record.review_note || "");
  const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const [drawing, setDrawing] = useState(false); const [start, setStart] = useState<number[] | null>(null); const [draft, setDraft] = useState<number[] | null>(null);
  const [original, setOriginal] = useState(false);
  const [dirty,setDirty] = useState(false);
  const [linkedCoil,setLinkedCoil]=useState(record.coil_id||"");
  const controls=useRef<HTMLDivElement>(null);
  const reviewDirty=dirty||note!==(record.review_note||"")||status!==(["pending","auto_confirmed"].includes(record.review_status)?"confirmed":record.review_status);
  const linkDirty=linkedCoil!==(record.coil_id||"");
  const [nextAfterSave,setNextAfterSave] = useState(false);
  const classes = record.model_classes ?? LEGACY_MODEL_CLASSES;
  const displayed = original ? record.detections : status === "false_positive" ? [] : boxes;
  const selected = boxes[selectedBox];
  function position(e: PointerEvent<SVGSVGElement>) { const rect=e.currentTarget.getBoundingClientRect(); return [Math.round(Math.max(0,Math.min(record.image_width,(e.clientX-rect.left)/rect.width*record.image_width))),Math.round(Math.max(0,Math.min(record.image_height,(e.clientY-rect.top)/rect.height*record.image_height)))]; }
  function rectangle(a:number[],b:number[]) { return [Math.min(a[0],b[0]),Math.min(a[1],b[1]),Math.max(a[0],b[0]),Math.max(a[1],b[1])]; }
  function addBox(coords: number[]) { setDirty(true); const category=classes[0]; setBoxes([...boxes,{class_id:classes.indexOf(category),class_name:category,confidence:1,bbox:coords}]); setSelectedBox(boxes.length); setStatus("corrected"); }
  function changeBox(box: Box) { setDirty(true); setBoxes(boxes.map((x,i) => i===selectedBox ? box : x)); setStatus("corrected"); }
  async function save(event: FormEvent<HTMLFormElement>) { event.preventDefault();setError(""); const effective=status==="false_positive"?[]:boxes; if (effective.some(b => !validBox(b.bbox,record.image_width,record.image_height))) {setError("请检查框坐标：必须在图像内，且右下角大于左上角。");return;} setBusy(true);try {if(linkDirty)await patch(`/inspections/${record.id}`,{coil_id:linkedCoil||null});await post(`/inspections/${record.id}/review`,{status,note,detections:effective});await onSaved(nextAfterSave);}catch(e){setError(messageOf(e));}finally{setBusy(false);} }
  async function bind(event: FormEvent<HTMLFormElement>) { const values=getForm(event);setBusy(true);setError("");try{await patch(`/inspections/${record.id}`,{coil_id:values.coil_id || null});await onLinked();}catch(e){setError(messageOf(e));}finally{setBusy(false);} }
  const coil=data.coils.find(c=>c.id===record.coil_id); const batch=data.batches.find(b=>b.id===coil?.batch_id);
  return <Drawer title={record.filename} subtitle={`${dateText(record.created_at)} · ${displayStatus(record.source)} · ${record.model}`} onClose={onClose} wide dirty={reviewDirty||linkDirty} onSave={()=>{const forms=controls.current?.querySelectorAll("form");forms?.[reviewDirty?0:1]?.requestSubmit();}}><div className="sv-review-layout"><div><div className="sv-toolbar"><button className={!original ? "primary":"quiet"} onClick={()=>setOriginal(false)}>复核图层</button><button className={original ? "primary":"quiet"} onClick={()=>{setOriginal(true);setDrawing(false);}}>原始 AI 图层</button>{canEdit && !original && <button className={drawing?"primary":"quiet"} onClick={()=>{setDrawing(!drawing);}}>＋ 画框补充</button>}</div><div className="sv-review-image"><img src={mediaUrl(record.original_image_url)} alt="原始检测图像"/><svg viewBox={`0 0 ${record.image_width} ${record.image_height}`} className={drawing?"sv-drawing":""} aria-label="检测框图层" onPointerDown={e=>{if(!drawing)return;e.currentTarget.setPointerCapture(e.pointerId);setStart(position(e));}} onPointerMove={e=>{if(start)setDraft(rectangle(start,position(e)));}} onPointerUp={e=>{if(start){const rect=rectangle(start,position(e));if(validBox(rect,record.image_width,record.image_height))addBox(rect);setStart(null);setDraft(null);setDrawing(false);}}} onPointerCancel={()=>{setStart(null);setDraft(null);}}>{displayed.map((b,i)=><g key={i} onClick={()=>{if(!original)setSelectedBox(i);}}><rect x={b.bbox[0]} y={b.bbox[1]} width={b.bbox[2]-b.bbox[0]} height={b.bbox[3]-b.bbox[1]} fill="transparent" stroke={i===selectedBox?"#ffb454":"#3de0c7"} strokeWidth="2" vectorEffect="non-scaling-stroke"/><text x={b.bbox[0]+2} y={Math.max(12,b.bbox[1]-4)} fill="#fff" stroke="#132d35" strokeWidth="2" paintOrder="stroke" fontSize={Math.max(12,record.image_width/40)}>{i+1}. {data.knowledge.find(k=>k.key===b.class_name)?.name || b.class_name}</text></g>)}{draft&&<rect x={draft[0]} y={draft[1]} width={draft[2]-draft[0]} height={draft[3]-draft[1]} fill="#ffffff20" stroke="#ffb454" vectorEffect="non-scaling-stroke"/>}</svg></div><p className="sv-footnote">{record.image_width} × {record.image_height} px · 阈值 {record.threshold} · {drawing?"在图像上拖动，绘制漏检区域。":"点击检测框可选择，坐标以原始图像像素为准。"}</p><div className="sv-timeline"><div><i/><b>生产关联</b><p>{batch?.code || "无批次"} / {coil?.code || "尚未关联钢板"}</p></div><div><i/><b>AI 检测完成</b><p>{dateText(record.created_at)} · {record.count} 个原始目标</p></div>{record.review_events?.map((e,i)=><div key={e.id||i}><i/><b>{displayStatus(e.status||"review")} · {e.actor || e.username || "质检员"}</b><p>{e.note || "已记录复核"} · {dateText(e.created_at)}</p></div>)}</div></div><div className="sv-review-controls" ref={controls}>{canEdit ? <><Form onSubmit={save} busy={busy} error={error} submit="保存复核"><Field label="复核结论" wide><select value={status} onChange={e=>{setStatus(e.target.value);if(e.target.value==="confirmed"){setBoxes(structuredClone(record.detections));setSelectedBox(0);}}}><option value="confirmed">确认 AI 结果</option><option value="corrected">修正 / 补充缺陷</option><option value="false_positive">全部为误检</option></select></Field>{status!=="false_positive" && <div className="sv-field-wide"><div className="sv-box-tabs">{boxes.map((_,i)=><button type="button" className={selectedBox===i?"primary":"quiet"} key={i} onClick={()=>setSelectedBox(i)}>框 {i+1}</button>)}<button className="quiet" type="button" onClick={()=>addBox([0,0,Math.min(40,record.image_width),Math.min(40,record.image_height)])}>＋</button></div>{selected&&<div className="sv-box-editor"><Field label="缺陷类型" wide><select value={selected.class_name} onChange={e=>changeBox({...selected,class_name:e.target.value,class_id:classes.indexOf(e.target.value)})}>{classes.map(key=><option key={key} value={key}>{data.knowledge.find(k=>k.key===key)?.name || key}</option>)}</select></Field>{["左 X","上 Y","右 X","下 Y"].map((label,index)=><Field label={label} key={label}><input type="number" step="any" min="0" max={index%2?record.image_height:record.image_width} value={selected.bbox[index]} onChange={e=>changeBox({...selected,bbox:selected.bbox.map((n,j)=>j===index?Number(e.target.value):n)})}/></Field>)}<button type="button" className="sv-danger-text" onClick={()=>{setDirty(true);setBoxes(boxes.filter((_,i)=>i!==selectedBox));setSelectedBox(0);setStatus("corrected");}}>删除选中框</button></div>}</div>}<Field label="复核说明" wide><textarea rows={3} value={note} required onChange={e=>setNote(e.target.value)} placeholder="记录判定依据或修改原因"/></Field><label className="sv-next-review sv-field-wide"><input type="checkbox" checked={nextAfterSave} onChange={e=>setNextAfterSave(e.target.checked)}/>保存后打开下一张匹配记录</label></Form><form className="sv-bind-form" onSubmit={bind}><Field label="关联钢板"><select name="coil_id" value={linkedCoil} disabled={busy} onChange={e=>setLinkedCoil(e.target.value)}><option value="">未关联</option>{data.coils.filter(c=>c.status!=="archived"||c.id===record.coil_id).map(c=><option key={c.id} value={c.id}>{c.code}</option>)}</select></Field><button className="quiet" disabled={busy}>更新关联</button></form></> : <div className="sv-card"><Badge value={record.review_status}/><p>{record.review_note || "尚无复核说明"}</p></div>}</div></div></Drawer>;
}
