import type { Inspection } from "./platform-types";

export function summarizeRecords(records: Inspection[]) {
  const categories: Record<string, number> = {};
  const days: Record<string, number> = {};
  let pending = 0;
  let confirmedTargets = 0;
  for (const record of records) {
    const day = inspectionDate(record.created_at);
    days[day] = (days[day] || 0) + 1;
    if (record.review_status === "pending") { pending++; continue; }
    const boxes = record.reviewed_detections ?? (record.review_status === "false_positive" ? [] : record.detections);
    for (const box of boxes) { categories[box.class_name] = (categories[box.class_name] || 0) + 1; confirmedTargets++; }
  }
  return { total: records.length, pending, reviewed: records.length - pending, confirmedTargets,
    classes: Object.entries(categories).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
    days: Object.entries(days).map(([date, count]) => ({ date, count })).sort((a, b) => a.date.localeCompare(b.date)) };
}

export type Filters = { query?: string; coil?: string; status?: string; from?: string; to?: string; category?: string };
export function searchRecords(records: Inspection[], filters: Filters) {
  return records.filter(record => {
    if (filters.query && !`${record.filename} ${record.id}`.toLowerCase().includes(filters.query.toLowerCase())) return false;
    if (filters.coil === "unassigned" && record.coil_id) return false;
    if (filters.coil && filters.coil !== "unassigned" && record.coil_id !== filters.coil) return false;
    if (filters.status === "completed" ? record.review_status === "pending" : filters.status && record.review_status !== filters.status) return false;
    const day = inspectionDate(record.created_at);
    if (filters.from && day < filters.from) return false;
    if (filters.to && day > filters.to) return false;
    if (filters.category && !(record.reviewed_detections ?? record.detections).some(box => box.class_name === filters.category)) return false;
    return true;
  });
}

export function validBox(box: number[], width: number, height: number) {
  return box.length === 4 && box.every(Number.isFinite) && box[0] >= 0 && box[1] >= 0 && box[2] > box[0] && box[3] > box[1] && box[2] <= width && box[3] <= height;
}


const dateFormat = new Intl.DateTimeFormat("en-CA", {timeZone:"Asia/Shanghai",year:"numeric",month:"2-digit",day:"2-digit"});
export function inspectionDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "未知日期" : dateFormat.format(date);
}

export function groupInspectionFolders(records: Inspection[]) {
  const folders = new Map<string, Inspection[]>();
  for (const record of records) {
    const date = inspectionDate(record.created_at);
    if (!folders.has(date)) folders.set(date, []);
    folders.get(date)!.push(record);
  }
  return [...folders.entries()].sort(([a],[b])=>b.localeCompare(a)).map(([date,items])=>({
    date, records:items.sort((a,b)=>Date.parse(b.created_at)-Date.parse(a.created_at)),
    pending:items.filter(item=>item.review_status==="pending").length,
  }));
}
