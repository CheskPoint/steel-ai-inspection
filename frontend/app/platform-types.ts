export const LEGACY_MODEL_CLASSES = ["crazing", "inclusion", "patches", "pitted_surface", "rolled-in_scale", "scratches"];

export type Role = "admin" | "inspector";
export type User = { id: string; username: string; display_name: string; role: Role; active: boolean; last_login_at?:string };
export type Batch = { id: string; code: string; line: string; production_date: string; status: string; notes: string; created_at: string };
export type Coil = { id: string; code: string; batch_id: string; grade: string; specification: string; status: string; notes: string; created_at: string; judgment?: {status:string; note:string; username:string; created_at:string} };
export type Box = { class_id: number; class_name: string; confidence: number; bbox: number[] };
export type Inspection = {
  id: string; filename: string; source: string; coil_id: string | null; model: string; threshold: number;
  model_classes?: string[];
  model_sha256?: string;
  inference_device?: string;
  inference_image_size?: number;
  runtime?: {device?:string;image_size?:number;threshold?:number;[key:string]:unknown};
  count: number; detections: Box[]; image_width: number; image_height: number; created_at: string;
  review_status: string; review_note: string; reviewed_detections: Box[] | null;
  original_image_url: string; annotated_image_url: string;
  review_events?: Array<{ id?: string; status?: string; note?: string; created_at: string; actor?: string; username?: string }>;
};
export type Knowledge = { key: string; name: string; description: string; features: string; notes: string; image_url?: string };
export type Alert = { id: string; kind: string; message: string; status: string; note?: string; created_at: string };
export type Log = { id: string; action: string; user_id?: string; actor?: string; username?: string; target?: string; entity_id?: string; detail?: string | Record<string, unknown>; created_at: string };
export type Settings = { threshold: number; interval_ms: number; report_title: string; company_name: string };
export type Report = {
  id: string; title: string; kind: string; created_at: string; coil_id?: string; company_name?: string;
  coil?: Coil; batch?: Batch; inspections?: Inspection[]; summary?: Record<string, unknown>;
};
export type Workspace = {
  model_classes?: string[];
  batches: Batch[]; coils: Coil[]; inspections: Inspection[]; knowledge: Knowledge[];
  alerts: Alert[]; logs: Log[]; reports: Report[]; settings: Settings; users: User[];
  stats?: Record<string, unknown>;
  inspection_counts?: Record<string, {total:number;pending:number}>;
};
export type View = "overview" | "detect" | "batches" | "coils" | "review" | "trace" | "analysis" | "reports" | "knowledge" | "devices" | "models" | "alerts" | "users" | "logs" | "settings";
export const statusNames: Record<string, string> = {
  planned: "待开始", active: "进行中", completed: "已完成", archived: "已归档",
  registered: "已登记", inspecting: "检测中", pending_review: "待复核", qualified: "合格", unqualified: "不合格",
  auto_confirmed: "AI 自动确认", inspection_auto_completed: "AI 自动确认",
  pending: "待复核", confirmed: "人工已确认", corrected: "人工已修正", false_positive: "人工已排除误检",
  open: "待处理", acknowledged: "已确认", resolved: "已处理", draft: "草稿", final: "正式报告",
  admin: "总管理员", inspector: "员工", viewer: "原只读角色（已合并）", manual: "单图", batch: "图片检测", camera: "摄像头", network: "网络摄像头",
  login: "登录系统", logout: "退出系统", password_changed: "修改密码", batch_created: "新建批次", batch_updated: "更新批次", coil_created: "登记钢板", coil_updated: "更新钢板", coil_judged: "质量判定", inspection_archived: "归档检测", inspection_linked: "关联钢板", inspection_reviewed: "复核检测", report_created: "生成报告", knowledge_updated: "更新知识条目", knowledge_image_updated: "更新示例图", settings_updated: "更新系统设置", user_created: "创建用户", user_updated: "更新用户", alert_created: "生成告警", alert_updated: "处理告警", device_created: "添加摄像头", device_updated: "更新摄像头", device_connect: "连接摄像头", device_disconnect: "断开摄像头", quality: "质量告警", inference: "检测异常", device: "设备异常",
};
export const displayStatus = (value: string) => statusNames[value] || value;
export function dateText(value: string) { if (!value) return "—"; const parsed = new Date(value); return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString("zh-CN", { hour12: false, timeZone:"Asia/Shanghai" }); }
