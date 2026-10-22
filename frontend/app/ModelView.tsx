"use client";
import { dateText, type Workspace } from "./platform-types";
import type { useModelStatus } from "./useModelStatus";
import { ErrorNote, SectionHeading } from "./ui";

const percent=(n:number|undefined)=>typeof n==="number"?`${(n*100).toFixed(1)}%`:"未提供";
export default function ModelView({model,data,onKnowledge}:{model:ReturnType<typeof useModelStatus>;data:Workspace;onKnowledge:()=>void}) {
  const info=model.info;
  const evidence=info?.evaluation;
  const label=(key:string)=>data.knowledge.find(k=>k.key===key)?.name||key;
  return <><SectionHeading title="模型信息" description="查看部署版本、识别范围及可核验的评估结果。" action={<button className="quiet" onClick={model.refresh}>重新检查</button>}/><ErrorNote text={model.error||""}/>
    <div className="sv-split"><section className="sv-card"><h2>{info?.model_name||"等待模型服务"}</h2><p>{model.label}</p><dl className="sv-card-facts"><span>运行设备<b>{info?.device||"—"}</b></span><span>输入尺寸<b>{info?.image_size||"—"}</b></span><span>服务版本<b>{info?.version||"—"}</b></span></dl><p className="sv-note">权重 SHA-256</p><code className="sv-fingerprint">{info?.model_sha256||"尚未记录"}</code></section>
    <section className="sv-card"><SectionHeading title="识别范围"/><div className="sv-class-tags">{info?.classes?.map(c=><span key={c}>{label(c)}<small>{c}</small></span>)}</div><button className="quiet" onClick={onKnowledge}>查看缺陷知识库 →</button></section></div>
    <section className="sv-card sv-evaluation"><SectionHeading title="模型效果证据" description="数据集评估与现场表现分别验证；以下只展示有来源的测量结果。"/>
    {evidence?.status==="available"?<><div className="sv-metrics">{[["Precision",evidence.precision],["Recall",evidence.recall],["mAP@0.5",evidence.map50],["mAP@0.5:0.95",evidence.map50_95]].map(([name,value])=><div className="sv-metric" key={String(name)}><span>{name}</span><strong>{percent(value as number|undefined)}</strong></div>)}</div><dl className="sv-card-facts"><span>数据集 / 划分<b>{evidence.dataset||"未提供"} / {evidence.split||"未提供"}</b></span><span>评估图片<b>{evidence.sample_count??"未提供"}</b></span><span>评估设备 / 输入<b>{evidence.device||"未提供"} / {evidence.image_size||"未提供"}</b></span><span>单图推理耗时<b>{evidence.inference_ms!==undefined?`${evidence.inference_ms.toFixed(1)} ms`:"未提供"}</b></span></dl><p className="sv-note">来源：{evidence.source||"部署模型评估记录"}。{evidence.reason} {evidence.evaluated_at&&`评估时间：${dateText(evidence.evaluated_at)}（北京时间）`} 推理耗时不包含采集、上传、排队及业务归档。{evidence.inference_timing_scope&&<><br/>测量范围：{evidence.inference_timing_scope}</>}</p>
    {!!evidence.per_class?.length&&<div className="sv-table-scroll" role="region" aria-label="各类别评估指标，窄屏可横向滚动" tabIndex={0}><p className="sv-footnote">各类别指标 · 窄屏可左右滑动查看完整表格</p><table className="sv-evaluation-table"><thead><tr><th>缺陷类别</th><th>Precision</th><th>Recall</th><th>mAP@0.5</th><th>mAP@0.5:0.95</th></tr></thead><tbody>{evidence.per_class.map(c=><tr key={c.name}><td>{label(c.name)}</td><td>{percent(c.precision)}</td><td>{percent(c.recall)}</td><td>{percent(c.map50)}</td><td>{percent(c.map50_95)}</td></tr>)}</tbody></table></div>}</>:<p className="sv-note">{evidence?.reason||"当前尚无可核验的模型评估记录。部署成功不等于精度已经验证。"}</p>}
    </section></>;
}
