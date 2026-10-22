"use client";

import { useCallback, useEffect, useState } from "react";
import ModelView from "./ModelView";
import DetectionPanel from "./DetectionPanel";
import DevicesView from "./DevicesView";
import { useModelStatus } from "./useModelStatus";
import { api, post } from "./api";
import type { Workspace, User, View } from "./platform-types";
import { displayStatus } from "./platform-types";
import { Overview, ProductionView, AnalysisView } from "./BusinessViews";
import { InspectionView } from "./InspectionViews";
import { KnowledgeView, AdminView } from "./AdminViews";
import ReportsView from "./ReportViews";
import { Drawer, ErrorNote, SectionHeading, messageOf } from "./ui";
import RoleWorkspace from "./RoleWorkspace";
import NavIcon from "./NavIcon";
import { canAccessView, viewLabel } from "./roles";
import "./platform.css";
import "./roles.css";

const groups: Array<{ name: string; items: Array<[View, string, string]> }> = [
  {name:"生产作业",items:[["detect","检测工作台","⊙"],["batches","生产","▦"],["review","缺陷复核","▧"],["trace","质量追溯","⌕"],["analysis","质量分析与报告","▥"]]},
  {name:"工作空间",items:[["overview","质检总览","◈"],["knowledge","缺陷知识库","◇"]]},
  {name:"设备与 AI",items:[["devices","设备管理","⌘"],["models","模型信息","⬡"],["alerts","告警中心","♧"]]},
  {name:"组织管理",items:[["users","用户与权限","♙"],["logs","操作日志","≡"],["settings","系统设置","⚙"]]},
];
const titles=Object.fromEntries(groups.flatMap(g=>g.items.map(([id,title])=>[id,title]))) as Record<View,string>;

function storedRoleLayout(userId: string) {
  try { return localStorage.getItem(`steelvision:layout:${userId}`) !== "classic"; } catch { return true; }
}

export default function Home() {
  const [user,setUser]=useState<User|null>(null);
  const [data,setData]=useState<Workspace|null>(null);
  const [active,setActive]=useState<View>("overview");
  const [detectionBusy,setDetectionBusy]=useState(false);
  const [appearance,setAppearance]=useState(false);
  const [mobileMenu,setMobileMenu]=useState(false);
  const [coil,setCoil]=useState("");
  const [productionTab,setProductionTab]=useState<"batches"|"coils">("batches");
  const [qualityTab,setQualityTab]=useState<"analysis"|"reports">("analysis");
  const [error,setError]=useState("");
  const [collapsed,setCollapsed]=useState(false);
  const [roleLayout,setRoleLayout]=useState(true);
  const [refreshing,setRefreshing]=useState(false);
  const model=useModelStatus(Boolean(user));
  const reload=useCallback(async()=>{const next=await api<Workspace>("/workspace?compact=true");setData(next);window.dispatchEvent(new Event("steelvision:workspace-updated"));},[]);
  const initialize=useCallback(async()=>{try{const me=await api<User>("/auth/me");setUser(me);setRoleLayout(storedRoleLayout(me.id));await reload();setError("");}catch(e){if((e as {status?:number}).status===401)window.location.replace("/login");else setError(messageOf(e));}},[reload]);
  useEffect(()=>{let alive=true;const unauthorized=()=>window.location.replace("/login");void api<User>("/auth/me").then(async me=>{if(!alive)return;setUser(me);setRoleLayout(storedRoleLayout(me.id));const workspace=await api<Workspace>("/workspace?compact=true");if(alive){setData(workspace);setError("");}}).catch(e=>{if(!alive)return;if(e.status===401)unauthorized();else setError(messageOf(e));});window.addEventListener("steelvision:unauthorized",unauthorized);return()=>{alive=false;window.removeEventListener("steelvision:unauthorized",unauthorized);};},[]);
  const navigate=(view:View)=>{if(user&&canAccessView(user.role,view)){
    if(view==="coils"||view==="batches") {setProductionTab(view);setActive("batches");}
    else if(view==="reports"||view==="analysis") {setQualityTab(view);setActive("analysis");}
    else setActive(view);
    setMobileMenu(false);
    window.history.replaceState(null,"",`#${view}`);
    setError("");
  }};
  useEffect(()=>{
    if(!user)return;
    const restore=()=>{const target=window.location.hash.slice(1) as View;if(![...Object.keys(titles),"coils","reports"].includes(target)||!canAccessView(user.role,target))return;
      if(target==="coils"||target==="batches"){setProductionTab(target);setActive("batches");}
      else if(target==="reports"||target==="analysis"){setQualityTab(target);setActive("analysis");}
      else setActive(target);
    };
    window.addEventListener("hashchange",restore);
    const timer=window.setTimeout(restore,0);
    return ()=>{clearTimeout(timer);window.removeEventListener("hashchange",restore);};
  },[user]);
  function chooseLayout(next:boolean){setRoleLayout(next);if(user){try{localStorage.setItem(`steelvision:layout:${user.id}`,next?"roles":"classic");}catch{/* The current layout still works without persistence. */}}}
  async function refresh(){setRefreshing(true);try{await reload();setError("");}catch(e){setError(messageOf(e));}finally{setRefreshing(false);}}
  async function logout(){try{await post("/auth/logout");window.location.assign("/login");}catch(e){setError(messageOf(e));}}
  if(!user||!data)return <main className="sv-loading"><div className="sv-brand-mark">CR7</div><h2>CR7 智检</h2>{error?<><ErrorNote text={error}/><button className="primary" onClick={()=>void initialize()}>重新连接</button></>:<p>正在载入质检工作台…</p>}</main>;
  const canEdit=user.role==="admin"||user.role==="inspector";
  const visibleGroups=groups.map(group=>({...group,items:group.items.filter(([id])=>canAccessView(user.role,id))})).filter(group=>group.items.length);
  const label=(id:View,title:string)=>viewLabel(id,title,user.role,roleLayout);
  const goDetect=(id:string)=>{setCoil(id);navigate("detect");};
  let view:React.ReactNode;
  switch(active){
    case "overview":view=roleLayout?<RoleWorkspace data={data} user={user} navigate={navigate}/>:<Overview data={data} navigate={navigate} model={model.label}/>;break;
    case "batches":case "coils":view=<><div className="sv-section-tabs" role="tablist" aria-label="生产管理">{([["batches","生产批次"],["coils","钢板管理"]] as const).map(([id,title])=><button key={id} role="tab" aria-selected={productionTab===id} className={productionTab===id?"primary":"quiet"} onClick={()=>navigate(id)}>{title}</button>)}</div><ProductionView key={productionTab} data={data} canEdit={canEdit} reload={reload} kind={productionTab} onDetect={goDetect}/></>;break;
    case "review":case "trace":view=<InspectionView key={active} data={data} canEdit={canEdit} reload={reload} review={active==="review"}/>;break;
    case "analysis":case "reports":view=<><div className="sv-section-tabs" role="tablist" aria-label="质量分析与报告">{([["analysis","质量分析"],["reports","质检报告"]] as const).map(([id,title])=><button key={id} role="tab" aria-selected={qualityTab===id} className={qualityTab===id?"primary":"quiet"} onClick={()=>navigate(id)}>{title}</button>)}</div>{qualityTab==="analysis"?<AnalysisView data={data}/>:<ReportsView data={data} canEdit={canEdit} reload={reload}/>}</>;break;
    case "knowledge":view=<KnowledgeView data={data} canEdit={user.role==="admin"} reload={reload}/>;break;
    case "devices":view=<><SectionHeading title="摄像头与设备" description="接入本机 / USB 摄像头，或配置 RTSP、HTTP 网络视频源。"/><DevicesView canManage={user.role==="admin"} onChange={()=>void refresh()}/></>;break;
    case "detect":view=null;break;
    case "models":view=<ModelView model={model} data={data} onKnowledge={()=>navigate("knowledge")}/>;break;
    default:view=<AdminView key={active} view={active} data={data} user={user} reload={reload}/>;
  }
  return <div className={"sv-shell "+(collapsed?"sv-collapsed":"")+(mobileMenu?" sv-mobile-open":"")}><aside className="sv-sidebar" id="primary-sidebar"><div className="sv-brand"><span className="sv-brand-mark">CR7</span><div><b>CR7 智检</b><small>{roleLayout?(user.role==="admin"?"管理控制台":"员工工作空间"):"冷轧钢板表面质量检测"}</small></div></div><nav aria-label="主导航">{visibleGroups.map(g=><div className="sv-nav-group" key={g.name}><p>{g.name}</p>{g.items.map(([id,title])=><button key={id} title={label(id,title)} aria-label={label(id,title)} aria-current={active===id?"page":undefined} className={active===id?"sv-nav-active":""} onClick={()=>navigate(id)}><NavIcon view={id}/><span>{label(id,title)}</span>{id==="review"&&Number(data.stats?.pending_reviews)>0&&<em>{Number(data.stats?.pending_reviews||0)}</em>}</button>)}</div>)}</nav><div className="sv-sidebar-bottom"><span className="sv-user-dot">{user.display_name?.[0]||"U"}</span><div><b>{user.display_name}</b><small>{displayStatus(user.role)}</small></div><button title={collapsed?"展开导航":"收起导航"} aria-label={collapsed?"展开导航":"收起导航"} onClick={()=>setCollapsed(!collapsed)}>{collapsed?"›":"‹"}</button></div></aside><main className="sv-main"><header className="sv-topbar"><button className="sv-menu-toggle quiet" aria-label={mobileMenu?"关闭导航菜单":"打开导航菜单"} aria-expanded={mobileMenu} aria-controls="primary-sidebar" onClick={()=>setMobileMenu(!mobileMenu)}>☰ 菜单</button><div><span>{user.role==="admin"?"管理端":"员工端"}</span><b> / {label(active,titles[active])}</b></div><div className="sv-topbar-actions"><button className={"sv-model-status "+(model.kind==="ready"?"is-ready":"")} onClick={model.refresh}><i/>{model.label}</button><button className="sv-icon-button" onClick={()=>void refresh()} disabled={refreshing} title="刷新业务数据" aria-label="刷新业务数据">↻</button><button className="sv-text-button" onClick={()=>setAppearance(true)}>界面设置</button><button className="sv-text-button" onClick={()=>void logout()}>退出</button></div></header><div className="sv-content">{active==="settings"&&<div className="sv-layout-bar"><span>界面方案</span><div className="sv-layout-switch" role="group" aria-label="界面方案"><button aria-pressed={roleLayout} onClick={()=>chooseLayout(true)}>角色工作台</button><button aria-pressed={!roleLayout} onClick={()=>chooseLayout(false)}>原版布局</button></div><small>首页布局偏好仅对当前账号生效</small></div>}<ErrorNote text={error}/><div hidden={active!=="detect"} className="sv-detection-container"><><SectionHeading title="检测工作台" description="选择来源、关联钢板并开始检测。站内切换会暂停采集并保留队列；刷新或关闭页面需重新选择文件。"/><div className="sv-context-bar"><span className="sv-context-icon">◎</span><label>当前钢板<select disabled={detectionBusy} value={coil} onChange={e=>setCoil(e.target.value)}><option value="">暂不关联 · 稍后补充</option>{data.coils.filter(c=>c.status!=="archived").map(c=><option key={c.id} value={c.id}>{c.code} · {data.batches.find(b=>b.id===c.batch_id)?.code}</option>)}</select></label><span>图片检测自动归档，摄像头画面按需保存。</span><button className="sv-text-button" onClick={()=>navigate("coils")}>管理钢板 ↗</button></div><DetectionPanel active={active==="detect"} onBusyChange={setDetectionBusy} coilId={coil||undefined} onArchived={()=>void refresh()} readOnly={!canEdit} defaultThreshold={data.settings.threshold} defaultInterval={data.settings.interval_ms}/></></div>{view}</div></main>{appearance&&<Drawer title="界面设置" onClose={()=>setAppearance(false)}><p className="sv-note">首页布局偏好仅对当前账号生效，切换后立即保存。</p><div className="sv-layout-switch" role="group" aria-label="界面方案"><button aria-pressed={roleLayout} onClick={()=>chooseLayout(true)}>角色工作台</button><button aria-pressed={!roleLayout} onClick={()=>chooseLayout(false)}>原版布局</button></div></Drawer>}</div>;
}
