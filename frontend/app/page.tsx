"use client";

import { useEffect, useState } from "react";
import DetectionPanel from "./DetectionPanel";

type View =
  | "overview" | "detect" | "batches" | "coils" | "review" | "trace" | "analysis"
  | "reports" | "knowledge" | "devices" | "models" | "alerts" | "users" | "logs" | "settings";

type NavItem = { id: View; label: string; icon: string };

const navigation: Array<{ group: string; items: NavItem[] }> = [
  { group: "质检业务", items: [
    { id: "overview", label: "质检总览", icon: "01" }, { id: "detect", label: "实时检测", icon: "02" },
    { id: "batches", label: "生产批次", icon: "03" }, { id: "coils", label: "钢卷管理", icon: "04" },
    { id: "review", label: "缺陷复核", icon: "05" }, { id: "trace", label: "质量追溯", icon: "06" },
    { id: "analysis", label: "质量分析", icon: "07" }, { id: "reports", label: "质检报告", icon: "08" },
    { id: "knowledge", label: "缺陷知识库", icon: "09" },
  ] },
  { group: "设备与 AI", items: [
    { id: "devices", label: "设备管理", icon: "10" }, { id: "models", label: "模型管理", icon: "11" }, { id: "alerts", label: "告警中心", icon: "12" },
  ] },
  { group: "系统管理", items: [
    { id: "users", label: "用户与权限", icon: "13" }, { id: "logs", label: "操作日志", icon: "14" }, { id: "settings", label: "系统设置", icon: "15" },
  ] },
];

const pageTitles: Record<View, string> = {
  overview: "质检总览", detect: "实时检测", batches: "生产批次", coils: "钢卷管理", review: "缺陷复核", trace: "质量追溯", analysis: "质量分析", reports: "质检报告", knowledge: "缺陷知识库", devices: "设备管理", models: "模型管理", alerts: "告警中心", users: "用户与权限", logs: "操作日志", settings: "系统设置",
};

function EmptyState({ title, description, action, onAction }: { title: string; description: string; action?: string; onAction?: () => void }) {
  return <div className="empty industrial-empty"><span>—</span><b>{title}</b><small>{description}</small>{action && <button className="quiet empty-action" onClick={onAction}>{action}</button>}</div>;
}

function BoundaryNote({ children }: { children: React.ReactNode }) {
  return <div className="boundary-note"><b>当前阶段说明</b><span>{children}</span></div>;
}

function PlaceholderPage({ title, eyebrow, description, emptyTitle, emptyDescription, action, onAction }: {
  title: string; eyebrow: string; description: string; emptyTitle: string; emptyDescription: string; action?: string; onAction?: () => void;
}) {
  return <><section className="heading"><div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1><p>{description}</p></div></section><section className="panel"><EmptyState title={emptyTitle} description={emptyDescription} action={action} onAction={onAction} /></section></>;
}

export default function Home() {
  const [ready] = useState(true);
  const [active, setActive] = useState<View>("overview");

  useEffect(() => {
    if (sessionStorage.getItem("steelvision_demo_account") !== "admin") {
      window.location.replace("/login");
      return;
    }
  }, []);

  const overview = <>
    <section className="heading"><div><p className="eyebrow">PRODUCTION QUALITY INSPECTION · SYSTEM FOUNDATION</p><h1>热轧钢表面质量总览</h1><p>围绕生产批次、钢卷、检测、人工复核、质量判定和质量追溯构建的业务平台。</p></div><button className="primary" onClick={() => setActive("batches")}>进入生产批次</button></section>
    <section className="status-grid">
      <article><span>生产任务</span><b>暂无生产任务</b><small>待接入生产计划或产线数据</small></article>
      <article><span>当前检测钢卷</span><b>暂无待检测钢卷</b><small>检测任务需绑定具体钢卷</small></article>
      <article><span>设备连接</span><b>设备未接入</b><small>工业相机与采集设备尚未连接</small></article>
      <article><span>AI 模型</span><b>模型未部署</b><small>当前不展示虚构检测结果或性能指标</small></article>
    </section>
    <section className="two-column"><article className="panel"><div className="panel-title"><div><h2>当前业务流程</h2><p>所有页面围绕同一条质量管理主线组织。</p></div></div><div className="business-flow"><b>生产批次</b><i>→</i><b>钢卷登记</b><i>→</i><b>图像采集</b><i>→</i><b>AI 检测</b><i>→</i><b>人工复核</b><i>→</i><b>质量判定</b><i>→</i><b>报告归档</b></div><BoundaryNote>AI 检测结果与最终质量结论分开表达；当前模型未部署，因此不会生成检测框、置信度或虚构结论。</BoundaryNote></article><article className="panel"><div className="panel-title"><div><h2>最新异常与告警</h2><p>设备、检测、系统与质量异常将在此统一呈现。</p></div></div><EmptyState title="暂无告警记录" description="告警中心将在设备接入和检测任务运行后接收真实异常。" onAction={() => setActive("alerts")} action="查看告警中心" /></article></section>
  </>;

const detect = (
  <>
    <section className="heading">
      <div>
        <h1>实时检测工作台</h1>
        <p>使用训练好的 best.pt 进行单张图片试检。</p>
      </div>
    </section>

    <DetectionPanel />
  </>
);

  const batches = <PlaceholderPage title="生产批次" eyebrow="PRODUCTION BATCH · BUSINESS OBJECT" description="管理批次编号、生产时间、产线、状态及关联钢卷数量。" emptyTitle="暂无生产批次" emptyDescription="可在接入生产计划后创建批次，并逐卷关联后续检测记录。" action="进入钢卷管理" onAction={() => setActive("coils")} />;
  const coils = <PlaceholderPage title="钢卷管理" eyebrow="COIL MANAGEMENT · TRACEABILITY ANCHOR" description="每次检测必须绑定具体钢卷，以形成完整的质量档案。" emptyTitle="暂无钢卷记录" emptyDescription="钢卷登记后可关联批次、规格、检测进度、复核记录和最终质量状态。" action="查看生产批次" onAction={() => setActive("batches")} />;
  const review = <PlaceholderPage title="缺陷复核" eyebrow="DEFECT REVIEW · QUALITY CONFIRMATION" description="质检员可确认、修正或驳回 AI 检测结果，并记录必要备注。" emptyTitle="暂无待复核缺陷" emptyDescription="当前没有来自真实检测任务的 AI 结果；系统不会生成演示缺陷记录。" />;
  const trace = <PlaceholderPage title="质量追溯" eyebrow="QUALITY TRACEABILITY · COIL ARCHIVE" description="支持按日期、批次、钢卷、缺陷类型、检测状态和复核状态定位质量档案。" emptyTitle="暂无质量档案" emptyDescription="完成真实的批次、钢卷、检测和复核流程后，可在此追溯全链路记录。" />;
  const analysis = <PlaceholderPage title="质量分析" eyebrow="QUALITY ANALYSIS · DATA-DRIVEN" description="为后续真实数据接入预留统计分析与质量趋势研判能力。" emptyTitle="暂无可分析数据" emptyDescription="当前阶段不展示虚构趋势图、缺陷占比或统计数值。" />;
  const reports = <PlaceholderPage title="质检报告" eyebrow="QUALITY REPORT · ARCHIVE" description="生成和查看钢卷级质量检测报告，报告包含生产、检测、复核与质量判定信息。" emptyTitle="暂无质检报告" emptyDescription="没有经过真实检测和复核的数据时，系统不会生成正式报告。" />;
  const knowledge = <PlaceholderPage title="缺陷知识库" eyebrow="DEFECT KNOWLEDGE BASE · CONTENT FOUNDATION" description="沉淀热轧钢表面缺陷的名称、特征、可能成因、质量影响和检测说明。" emptyTitle="知识条目待建设" emptyDescription="缺陷类别将以项目最终确定的识别范围为准，避免预设未确认类别。" />;
  const devices = <PlaceholderPage title="设备管理" eyebrow="DEVICE MANAGEMENT · INTEGRATION READY" description="统一管理工业相机、光源、图像采集设备、推理服务器和产线接口。" emptyTitle="设备未接入" emptyDescription="设备接入后将展示基础信息、连接状态、运行状态、通信时间和维护记录。" />;
  const models = <><section className="heading"><div><p className="eyebrow">MODEL MANAGEMENT · DEPLOYMENT READY</p><h1>模型管理</h1><p>为模型版本、支持缺陷类别、评估与部署信息预留统一入口。</p></div></section><section className="two-column"><article className="panel"><h2>当前模型状态</h2><dl className="facts"><div><dt>当前模型</dt><dd>未部署</dd></div><div><dt>模型版本</dt><dd>—</dd></div><div><dt>部署状态</dt><dd>未部署</dd></div><div><dt>支持缺陷类别</dt><dd>—</dd></div></dl></article><article className="panel"><h2>接入边界</h2><BoundaryNote>模型训练完成后再填写 Precision、Recall、mAP、数据集版本、训练时间和部署时间等真实信息。</BoundaryNote></article></section></>;
  const alerts = <PlaceholderPage title="告警中心" eyebrow="ALERT CENTER · EXCEPTION HANDLING" description="统一管理设备告警、检测异常、系统异常和质量异常。" emptyTitle="暂无告警记录" emptyDescription="当前尚未接入设备与真实检测任务。" />;
  const users = <PlaceholderPage title="用户与权限" eyebrow="ACCESS CONTROL · ROLE MANAGEMENT" description="预留管理员、质检员和查看人员的角色与权限边界。" emptyTitle="暂无用户权限配置" emptyDescription="后续将把设备、模型配置与复核、判定、查询权限按角色分配。" />;
  const logs = <PlaceholderPage title="操作日志" eyebrow="OPERATION LOG · AUDIT TRAIL" description="记录关键配置、复核、质量判定和系统操作，支持后续审计追溯。" emptyTitle="暂无操作日志" emptyDescription="系统进入真实业务运行后，将自动记录关键操作。" />;
  const settings = <PlaceholderPage title="系统设置" eyebrow="SYSTEM SETTINGS · FOUNDATION" description="配置基础字典、状态定义、设备接口和系统参数。" emptyTitle="系统配置待接入" emptyDescription="当前原型只提供业务框架，不写入任何生产系统配置。" />;

  const views: Record<View, React.ReactNode> = { overview, detect, batches, coils, review, trace, analysis, reports, knowledge, devices, models, alerts, users, logs, settings };
  if (!ready) return <main className="loading">正在进入 SteelVision…</main>;

  return <main className="app-shell"><aside className="sidebar industrial-sidebar"><div className="brand"><span>SV</span><div><b>SteelVision</b><small>钢材 AI 质检平台</small></div></div><nav>{navigation.map(({ group, items }) => <div className="nav-group" key={group}><p>{group}</p>{items.map((item) => <button key={item.id} className={active === item.id ? "nav-active" : ""} onClick={() => setActive(item.id)}><i>{item.icon}</i>{item.label}</button>)}</div>)}</nav><div className="side-note">SYSTEM FOUNDATION<br /><small>真实空状态 · 可扩展架构</small></div></aside><section className="main"><header><div><span>钢材 AI 质检平台</span><b> / {pageTitles[active]}</b></div><span className="api-state offline">● 模型未部署</span><button className="signout" onClick={() => { sessionStorage.removeItem("steelvision_demo_account"); window.location.assign("/login"); }}>退出</button></header><div className="content">{views[active]}</div></section></main>;
}
