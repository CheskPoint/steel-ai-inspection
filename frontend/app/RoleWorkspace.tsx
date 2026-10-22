"use client";

import type { User, Workspace, View } from "./platform-types";
import { displayStatus } from "./platform-types";
import { ActivityList } from "./AuditView";
import { roleDescriptions } from "./roles";
import { Badge, SectionHeading } from "./ui";

export default function RoleWorkspace({ data, user, navigate }: { data: Workspace; user: User; navigate: (view: View) => void }) {
  const admin = user.role === "admin";
  const pending = Number(data.stats?.pending_reviews||0);
  const openAlerts = data.alerts.filter(item => item.status !== "resolved").length;
  const enabled = data.users.filter(item => item.active);
  const today = Number(data.stats?.today_inspections||0);
  const judgments = Number(data.stats?.pending_judgments||0);
  const metrics: Array<[string, number, string, View]> = [
    ["今日检测", today, "北京时间 · 今日归档图像", "trace"],
    ["待人工复核", pending, "团队待办 · 需人工确认", "review"],
    ["待质量判定", judgments, "检测已完成 · 等待最终结论", "coils"],
    ["待处理告警", openAlerts, "设备与质量异常", "alerts"],
  ];
  return <>
    <section className={`sv-workspace-hero ${admin ? "is-admin" : "is-employee"}`}>
      <div><div className="sv-workspace-kicker">CR7 VISION <span>/</span> {admin ? "ADMINISTRATION" : "WORKSPACE"}</div>
        <h1>{admin ? "管理工作台" : "我的工作台"}</h1>
        <p>{user.display_name}，欢迎回来。{admin ? "在一个地方掌握团队、权限与质检进展。" : "从检测到复核，继续今天的质检工作。"}</p>
        <div className="sv-actions"><button className="primary" onClick={() => navigate("detect")}>开始检测 <span>↗</span></button><button className="quiet" onClick={() => navigate("batches")}>进入生产</button></div>
      </div>
      <div className="sv-access-card"><span className="sv-access-icon" aria-hidden="true">{admin ? "⌘" : "◎"}</span><small>当前身份</small><h3>{displayStatus(user.role)}</h3><p>{roleDescriptions[user.role]}</p><span className="sv-access-status"><i/>账号已启用</span></div>
    </section>
    <div className="sv-workspace-metrics">{metrics.map(([label, count, note, view]) => <button key={label} onClick={() => navigate(view)}><span>{label}<i aria-hidden="true">↗</i></span><strong>{count}</strong><small>{note}</small></button>)}</div>
    <div className="sv-workspace-columns"><section className="sv-card"><SectionHeading title={admin ? "业务进展" : "工作入口"} description="生产数据在团队内共享，业务操作自动留痕。"/>
      <div className="sv-task-list">{([
        ["生产批次与钢板", `${data.batches.length} 个批次 · ${data.coils.length} 张钢板`, "batches", "▦"],
        ["缺陷复核", pending ? `${pending} 条检测等待人工确认` : "当前没有待复核检测", "review", "▧"],
        ["质量追溯与报告", `${data.reports.length} 份已保存报告`, "reports", "▤"],
      ] as Array<[string, string, View, string]>).map(([title, note, view, icon]) => <button key={view} onClick={() => navigate(view)}><i aria-hidden="true">{icon}</i><div><b>{title}</b><small>{note}</small></div><span aria-hidden="true">→</span></button>)}</div>
    </section><section className="sv-card"><SectionHeading title={admin ? "团队与访问" : "我的权限"} action={admin&&<button className="sv-text-button" onClick={() => navigate("users")}>管理 →</button>}/>
      {admin ? <><div className="sv-team-breakdown">{["admin", "inspector"].map(role => <div key={role}><Badge value={role}/><b>{enabled.filter(u => u.role === role).length}<small>人</small></b></div>)}</div><p className="sv-note">{enabled.length} 个启用账号 · {data.users.filter(u => !u.active).length} 个账号已停用。角色变更、重设密码或停用账号后，原登录会话自动失效。</p></> : <><div className="sv-personal-role"><Badge value={user.role}/><b>@{user.username}</b></div><p className="sv-role-copy">{roleDescriptions[user.role]}</p><ul className="sv-permission-notes"><li>生产数据与团队共享</li><li>AI 自动确认结果可抽检，其他结果进入人工复核</li><li>账号与系统配置由管理员维护</li></ul></>}
    </section></div>
    {admin&&<section className="sv-card sv-workspace-recent"><SectionHeading title={admin ? "团队最近操作" : "我的最近操作"} description={admin ? "关键业务和账号变更的最近 5 条记录。" : "登录与业务操作的最近 5 条记录。"} action={<button className="sv-text-button" onClick={() => navigate("logs")}>查看全部 →</button>}/><ActivityList logs={data.logs.slice(0, 5)}/></section>}
  </>;
}
