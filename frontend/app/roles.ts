import type { Role, View } from "./platform-types";

export const roleDescriptions: Record<Role, string> = {
  admin: "管理全部账号与权限、查看全员操作，并拥有全部业务和系统配置权限。",
  inspector: "执行检测、登记批次与钢板、复核、判定、生成报告和处理告警；不能修改账号权限或系统配置。",
};

export const permissionRows = [
  ["查看生产数据、质量分析与报告", "允许", "允许"],
  ["检测、归档、批次与钢板登记", "允许", "允许"],
  ["缺陷复核、质量判定、生成报告", "允许", "允许"],
  ["使用已配置摄像头、处理告警", "允许", "允许"],
  ["设备配置、知识库、系统设置", "允许", "不可修改"],
  ["创建账号、调整角色、重设密码", "允许", "不允许"],
  ["操作记录", "全员记录", "不显示入口"],
  ["修改本人密码", "允许", "允许"],
];

export function canAccessView(role: Role, view: View): boolean {
  return role === "admin" || !["users", "settings", "logs"].includes(view);
}

export function viewLabel(view: View, original: string, role: Role, roleLayout: boolean): string {
  if (roleLayout && view === "overview" && role !== "admin") return "我的工作台";
  if (role !== "admin" && view === "devices") return "设备状态";
  if (role !== "admin" && view === "models") return "模型状态";
  return original;
}
