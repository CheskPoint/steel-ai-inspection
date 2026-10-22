// Kept dependency-free so the sequential runner is also usable in Node's native tests.
export const API_BASE = (process.env.NEXT_PUBLIC_API_BASE_URL || (typeof window === "undefined" ? "http://localhost:8000" : `${window.location.protocol}//${window.location.hostname}:8000`)).replace(/\/$/, "");
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

export type Detection = { class_id: number; class_name: string; confidence: number; bbox: number[] };
export type DetectionResult = {
  model: string; count: number; detections: Detection[]; annotated_image: string;
  image_width: number; image_height: number; record_id?: string; review_status?: string;
};
export type ServiceInfo = {
  service: string; mode: "ready" | "not_deployed"; version?: string;
  model_name?: string; classes?: string[]; device?: string; image_size?: number;
  model_sha256?: string;
  evaluation?: {status:string;reason?:string;dataset?:string;split?:string;sample_count?:number;evaluated_at?:string;device?:string;image_size?:number;precision?:number;recall?:number;map50?:number;map50_95?:number;inference_ms?:number;inference_timing_scope?:string;source?:string;model_sha256?:string;per_class?:Array<{name:string;precision:number;recall:number;map50:number;map50_95:number}>};
};
export type BatchUpdate<T> = { status: "running" | "success" | "error"; result?: T; error?: string };
export type BatchItem = {
  file: File; name: string; status: "pending" | "running" | "success" | "error";
  result?: DetectionResult; error?: string;
};

export function imageError(file: Pick<File, "name" | "size">): string {
  if (!/\.(jpe?g|png)$/i.test(file.name)) return "仅支持 JPG、JPEG 或 PNG 图片";
  if (file.size === 0) return "图片为空";
  if (file.size > MAX_IMAGE_BYTES) return "图片超过 10 MB";
  return "";
}

export function selectImages(files: Iterable<File>) {
  const all = Array.from(files);
  const items: BatchItem[] = all.filter(file => /\.(jpe?g|png)$/i.test(file.name))
    .map(file => {
      const error = imageError(file);
      return { file, name: file.webkitRelativePath || file.name, status: error ? "error" as const : "pending" as const, error };
    }).sort((a, b) => a.name.localeCompare(b.name, "zh-CN", { numeric: true }));
  return { items, skipped: all.length - items.length };
}

export async function requestDetection(file: File, threshold: number, source: string, signal?: AbortSignal, options: { coilId?: string; archive?: boolean } = {}): Promise<DetectionResult> {
  const invalid = imageError(file);
  if (invalid) throw new Error(invalid);
  const form = new FormData();
  // Some folder pickers return an empty MIME type; infer it from the accepted suffix.
  form.append("file", new File([file], file.name, { type: /\.png$/i.test(file.name) ? "image/png" : "image/jpeg" }));
  form.append("threshold", String(threshold));
  form.append("source", source);
  form.append("archive", String(options.archive ?? source !== "camera"));
  if (options.coilId) form.append("coil_id", options.coilId);
  const timeout = AbortSignal.timeout(60000);
  try {
    const response = await fetch(`${API_BASE}/api/v1/inferences`, {
      method: "POST", credentials: "include", body: form, signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
    const data = await response.json().catch(() => null) as (Partial<DetectionResult> & {detail?:unknown})|null;
    if (response.status === 401 && typeof window !== "undefined") window.dispatchEvent(new Event("steelvision:unauthorized"));
    if (!response.ok) throw new Error(typeof data?.detail === "string" ? data.detail : `检测失败：HTTP ${response.status}`);
    if (!data || !Array.isArray(data.detections) || typeof data.count !== "number" ||
        typeof data.annotated_image !== "string" || !data.annotated_image.startsWith("data:image/jpeg;base64,")) {
      throw new Error("后端返回的检测结果格式不正确");
    }
    return data as DetectionResult;
  } catch (error) {
    if (timeout.aborted) throw new Error("检测超时，请检查后端后重试");
    if (error instanceof TypeError) throw new Error("无法连接检测服务，请确认后端正在运行");
    throw error;
  }
}

export async function readServiceInfo(signal?: AbortSignal): Promise<ServiceInfo> {
  const timeout = AbortSignal.timeout(5000);
  const response = await fetch(`${API_BASE}/api/v1/system/info`, {
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout, cache: "no-store", credentials: "include",
  });
  if (!response.ok) throw new Error(`状态查询失败：HTTP ${response.status}`);
  const data = await response.json() as Partial<ServiceInfo>|null;
  if (data?.service !== "steelvision-backend" || !["ready", "not_deployed"].includes(data.mode||"")) {
    throw new Error("后端状态响应不正确");
  }
  return data as ServiceInfo;
}

// Stop is graceful: keep the in-flight result, then never start another item.
export async function runBatch<T, R>(items: T[], processItem: (item: T) => Promise<R>, onUpdate: (index: number, update: BatchUpdate<R>) => void, signal: AbortSignal) {
  for (let index = 0; index < items.length && !signal.aborted; index++) {
    onUpdate(index, { status: "running" });
    try {
      onUpdate(index, { status: "success", result: await processItem(items[index]) });
    } catch (error) {
      onUpdate(index, { status: "error", error: error instanceof Error ? error.message : "检测失败" });
    }
  }
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise(resolve => {
    if (signal.aborted) { resolve(); return; }
    const done = () => { clearTimeout(timer); signal.removeEventListener("abort", done); resolve(); };
    const timer = setTimeout(done, ms);
    signal.addEventListener("abort", done, { once: true });
  });
}

export async function runContinuous<R>(processFrame: () => Promise<R>, onResult: (result: R) => void, signal: AbortSignal, intervalMs = 500) {
  while (!signal.aborted) {
    const result = await processFrame();
    if (signal.aborted) break;
    onResult(result);
    await delay(intervalMs, signal);
  }
}

export function resultsCsv(items: Array<Pick<BatchItem, "name" | "status" | "result" | "error">>): string {
  const cell = (value: unknown) => {
    let text = String(value ?? "");
    if (/^[\s]*[=+@-]/.test(text)) text = `'${text}`;
    return `"${text.replace(/"/g, '""')}"`;
  };
  const status = { pending: "待处理", running: "处理中", success: "成功", error: "失败" };
  const rows = [["文件", "状态", "缺陷数量", "检测明细（类别、置信度、坐标）", "错误"]];
  for (const item of items) rows.push([item.name, status[item.status], String(item.result?.count ?? ""), item.result ? JSON.stringify(item.result.detections) : "", item.error || ""]);
  return "\uFEFF" + rows.map(row => row.map(cell).join(",")).join("\r\n");
}

// Release these object URLs when replacing a batch or leaving the workbench.
export function retainResult(result: DetectionResult): DetectionResult {
  const binary = atob(result.annotated_image.split(",")[1]);
  const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
  return { ...result, annotated_image: URL.createObjectURL(new Blob([bytes], { type: "image/jpeg" })) };
}
