"use client";
/* eslint-disable @next/next/no-img-element -- Authenticated media and Blob frames must be fetched directly by the browser. */

import { useCallback, useEffect, useRef, useState, type InputHTMLAttributes } from "react";
import { requestDetection, resultsCsv, retainResult, runBatch, runContinuous, selectImages, type BatchItem, type DetectionResult } from "./detection";
import NetworkCamera from "./NetworkCamera";
import "./camera.css";

type Mode = "batch" | "camera";
const statusLabels = { pending: "待处理", running: "处理中", success: "成功", error: "失败" };
const directoryProps = { webkitdirectory: "" } as InputHTMLAttributes<HTMLInputElement> & { webkitdirectory: string };

function ResultView({ result, title }: { result: DetectionResult | null; title: string }) {
  return <section className="detection-result" aria-label="检测结果">
    <h3>{title}</h3>
    {result ? <>
      <p>检测到 <strong>{result.count}</strong> 个缺陷目标 · {result.model}</p>
      {result.record_id && <p className="detection-help">{result.review_status==="auto_confirmed"?"AI 自动确认：全部框置信度超过 90%，可到复核页抽检。":"已归档，等待人工复检。"}</p>}
      {/* Model-generated images use local data/blob URLs. */}

      <img src={result.annotated_image} alt="模型标注结果" />
      <div className="detection-details">{result.detections.map((item, index) => <p key={index}>{index + 1}. {item.class_name} · 置信度 {(item.confidence * 100).toFixed(1)}%</p>)}</div>
      {result.count === 0 && <p>当前阈值下未检测到目标，不代表表面一定没有缺陷。</p>}
    </> : <div className="detection-empty">完成检测后，在这里查看模型标注图片和缺陷信息。</div>}
  </section>;
}

function cameraError(error: unknown): string {
  const name = error instanceof Error ? error.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") return "摄像头权限被拒绝，请在浏览器网站权限中允许摄像头访问后重试。";
  if (name === "NotFoundError" || name === "OverconstrainedError") return "所选摄像头不可用，请刷新设备列表并重新选择。";
  if (name === "NotReadableError") return "无法读取摄像头，请关闭占用它的会议或相机软件后重试。";
  return error instanceof Error ? error.message : "摄像头启动失败";
}

export default function DetectionPanel({ coilId, onArchived, readOnly = false, defaultThreshold = .25, defaultInterval = 500, active = true, onBusyChange }: { coilId?: string; onArchived?: () => void; readOnly?: boolean; defaultThreshold?: number; defaultInterval?: number; active?:boolean; onBusyChange?:(busy:boolean)=>void } = {}) {
  const [mode, setMode] = useState<Mode>("camera");
  const [threshold, setThreshold] = useState(defaultThreshold);
  const [busy, setBusy] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<DetectionResult | null>(null);
  const [items, setItems] = useState<BatchItem[]>([]);
  const [skipped, setSkipped] = useState(0);
  const [selected, setSelected] = useState(0);
  const [opening, setOpening] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  const [intervalMs, setIntervalMs] = useState(defaultInterval);
  const [cameraKind, setCameraKind] = useState("local");
  const [networkBusy, setNetworkBusy] = useState(false);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState("");
  const [batchFilter, setBatchFilter] = useState("all");
  const [dragging,setDragging] = useState(false);
  const [selectionName,setSelectionName] = useState("");
  const [thumbnails, setThumbnails] = useState<string[]>([]);
  const lastFrame = useRef<File | null>(null);
  const frameThreshold = useRef(defaultThreshold);
  const discoveryAllowed = useRef(false);
  const [frameInfo, setFrameInfo] = useState({ count: 0, elapsed: 0, time: "" });
  const mounted = useRef(false);
  const job = useRef<AbortController | null>(null);
  const network = useRef<AbortController | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const cameraGeneration = useRef({ value: 0 });
  const openingRef = useRef(false);
  const video = useRef<HTMLVideoElement | null>(null);
  const urls = useRef(new Set<string>());
  const [appliedDefaults,setAppliedDefaults] = useState({threshold:defaultThreshold,interval:defaultInterval});
  // Adopt changed system defaults between jobs without remounting the file queue.
  if (!busy && !networkBusy && !opening && (appliedDefaults.threshold!==defaultThreshold || appliedDefaults.interval!==defaultInterval)) {
    if (appliedDefaults.threshold!==defaultThreshold) setThreshold(defaultThreshold);
    if (appliedDefaults.interval!==defaultInterval) setIntervalMs(defaultInterval);
    setAppliedDefaults({threshold:defaultThreshold,interval:defaultInterval});
  }

  useEffect(() => {
    mounted.current = true;
    const retainedUrls = urls.current;
    const generation = cameraGeneration.current;
    return () => {
      mounted.current = false;
      generation.value++;
      job.current?.abort();
      network.current?.abort();
      stream.current?.getTracks().forEach(track => track.stop());
      stream.current = null;
      retainedUrls.forEach(url => URL.revokeObjectURL(url));
      retainedUrls.clear();
    };
  }, []);




  const stop = useCallback(() => {
    job.current?.abort();
    if (job.current) setStopping(true);
  }, []);

  const closeCamera = useCallback(() => {
    stop();
    cameraGeneration.current.value++;
    openingRef.current = false;
    stream.current?.getTracks().forEach(track => track.stop());
    stream.current = null;
    if (video.current) video.current.srcObject = null;
    setCameraOpen(false);
    setCameraReady(false);
    setOpening(false);
  }, [stop]);

  useEffect(() => { onBusyChange?.(busy || networkBusy || opening); }, [busy,networkBusy,opening,onBusyChange]);
  useEffect(() => {
    // Visibility owns the hardware lifetime; the component retains its queue.
    if (!active) return;
    return () => closeCamera();
  }, [active,closeCamera]);
  useEffect(() => {
    if (!busy && !networkBusy && !items.some(item=>item.status==="pending")) return;
    const guard=(event:BeforeUnloadEvent)=>{event.preventDefault();event.returnValue="";};
    window.addEventListener("beforeunload",guard);
    return ()=>window.removeEventListener("beforeunload",guard);
  },[busy,networkBusy,items]);

  useEffect(() => {
    const media = navigator.mediaDevices;
    if (!media) return;
    const changed = () => {
      if (!discoveryAllowed.current) return;
      void media.enumerateDevices().then(all => {
        if (!mounted.current) return;
        const cameras = all.filter(d => d.kind === "videoinput"); setDevices(cameras);
        if (deviceId && !cameras.some(d => d.deviceId === deviceId)) { closeCamera(); setError("所选摄像头已移除，请重新选择设备。"); }
      }).catch(() => { if (mounted.current) setError("无法刷新摄像头列表，请手动重试。"); });
    };
    media.addEventListener("devicechange", changed);
    return () => media.removeEventListener("devicechange", changed);
  }, [deviceId, closeCamera]);

  function changeMode(next: Mode) {
    if (job.current) return;
    closeCamera();
    setMode(next);
    setResult(null);
    setError("");
    setFrameInfo({ count: 0, elapsed: 0, time: "" });
  }

  async function startJob(work: (signal: AbortSignal, requestSignal: AbortSignal) => Promise<void>) {
    if (job.current || readOnly) return;
    const control = new AbortController();
    const requestControl = new AbortController();
    job.current = control;
    network.current = requestControl;
    setBusy(true);
    setStopping(false);
    setError("");
    try { await work(control.signal, requestControl.signal); }
    catch (caught) {
      if (mounted.current && !control.signal.aborted) setError(caught instanceof Error ? caught.message : "检测失败");
    } finally {
      if (job.current === control) {
        job.current = null;
        network.current = null;
        if (mounted.current) { setBusy(false); setStopping(false); }
      }
    }
  }

  function chooseFolder(files: FileList | File[] | null) {
    if (!files?.length || job.current) return;
    if(items.some(item=>item.status==="pending") && !window.confirm("替换当前待检测队列？已归档的结果会保留。")) return;
    urls.current.forEach(url => URL.revokeObjectURL(url));
    urls.current.clear();
    const selectedFiles=Array.from(files);
    const selection = selectImages(selectedFiles);
    setSelectionName(selectedFiles[0]?.webkitRelativePath?.split("/")[0] || `${selectedFiles.length} 个文件`);
    setThumbnails(selection.items.map(item => { const url = URL.createObjectURL(item.file); urls.current.add(url); return url; }));
    setItems(selection.items);
    setSkipped(selection.skipped);
    setSelected(0);
    setError(selection.items.length ? "" : "所选内容中没有 JPG 或 PNG 图片");
  }

  function detectBatch(retryErrors=false) {
    const pending = items.map((item, index) => ({ item, index })).filter(({ item }) => retryErrors ? item.status === "error" : item.status === "pending");
    void startJob(async (signal, requestSignal) => {
      await runBatch(pending, async ({ item }) => requestDetection(item.file, threshold, "batch", requestSignal, { coilId }), (queueIndex, update) => {
        if (!mounted.current) return;
        const index = pending[queueIndex].index;
        const retained = update.result ? retainResult(update.result) : undefined;
        if (retained) urls.current.add(retained.annotated_image);

        setItems(previous => previous.map((item, i) => i === index ? { ...item, ...update, result: retained, error:update.error } : item));
        if (update.status === "running") setSelected(index);
      }, signal);
      onArchived?.();
    });
  }

  async function refreshDevices() {
    if (openingRef.current || readOnly) return;
    if (!navigator.mediaDevices?.getUserMedia) { setError("请使用 Chrome 或 Edge，通过 localhost 或 HTTPS 访问摄像头。"); return; }
    const generation = ++cameraGeneration.current.value;
    openingRef.current = true; setOpening(true); setError("");
    try {
      discoveryAllowed.current = true;
      if (!stream.current) {
        const permission = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        permission.getTracks().forEach(track => track.stop());
      }
      const cameras = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === "videoinput");
      if (!mounted.current || generation !== cameraGeneration.current.value) return;
      setDevices(cameras);
      if (!deviceId && cameras.length) setDeviceId(cameras[0].deviceId);
      else if (deviceId && !cameras.some(d => d.deviceId === deviceId)) { closeCamera(); setError("所选摄像头不可用，请重新选择。"); }
      if (!cameras.length) setError("未发现摄像头，请检查连接。");
    } catch (e) { if (mounted.current && generation === cameraGeneration.current.value) setError(cameraError(e)); }
    finally { if (mounted.current && generation === cameraGeneration.current.value) { openingRef.current = false; setOpening(false); } }
  }

  async function openCamera() {
    if (openingRef.current || stream.current) return;
    if (!navigator.mediaDevices?.getUserMedia) {
      setError("当前浏览器无法访问摄像头，请使用 Chrome 或 Edge，通过 localhost 或 HTTPS 打开页面。");
      return;
    }
    const generation = ++cameraGeneration.current.value;
    openingRef.current = true;
    setOpening(true);
    setError("");
    try {
      if (!deviceId) throw new Error("请先点击发现摄像头并选择设备");
      const next = await navigator.mediaDevices.getUserMedia({ video: { deviceId: { exact: deviceId }, width: { ideal: 640 }, height: { ideal: 480 } }, audio: false });
      if (!mounted.current || generation !== cameraGeneration.current.value) {
        next.getTracks().forEach(track => track.stop());
        return;
      }
      stream.current = next;
      setCameraOpen(true);
      const player = video.current;
      if (!player) throw new Error("摄像头预览区域未准备好，请重试");
      player.srcObject = next;
      next.getVideoTracks().forEach(track => track.addEventListener("ended", () => {
        if (mounted.current && stream.current === next) {
          closeCamera();
          setError("摄像头连接已断开，请重新打开摄像头。");
        }
      }, { once: true }));
      await player.play();
    } catch (caught) {
      if (mounted.current && generation === cameraGeneration.current.value) {
        closeCamera();
        setError(cameraError(caught));
      }
    } finally {
      if (mounted.current && generation === cameraGeneration.current.value) {
        openingRef.current = false;
        setOpening(false);
      }
    }
  }

  async function captureFrame(): Promise<File> {
    const player = video.current;
    if (!player || player.readyState < 2 || !player.videoWidth) throw new Error("摄像头画面尚未准备好，请稍后重试");
    const canvas = document.createElement("canvas");
    const scale = Math.min(1, 1280 / player.videoWidth);
    canvas.width = Math.round(player.videoWidth * scale);
    canvas.height = Math.round(player.videoHeight * scale);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("浏览器无法截取摄像头画面");
    context.drawImage(player, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error("截帧失败，请重试")), "image/jpeg", 0.9));
    return new File([blob], "camera-" + Date.now() + ".jpg", { type: "image/jpeg" });
  }

  function detectCamera() {
    setResult(null);
    setFrameInfo({ count: 0, elapsed: 0, time: "" });
    void startJob(async (signal, requestSignal) => {
      await runContinuous(async () => {
        const start = performance.now();
        const frame = await captureFrame();
        if (signal.aborted) throw new DOMException("已停止", "AbortError");
        const detection = await requestDetection(frame, threshold, "camera", requestSignal, { coilId, archive: false });
        return { frame, detection, elapsed: Math.round(performance.now() - start) };
      }, ({ frame, detection, elapsed }) => {
        if (!mounted.current) return;
        lastFrame.current = frame; frameThreshold.current = threshold;
        setResult(detection);
        setFrameInfo(previous => ({ count: previous.count + 1, elapsed, time: new Date().toLocaleTimeString() }));
      }, signal, intervalMs);
    });
  }

  function saveCameraFrame() {
    const frame = lastFrame.current;
    if (!frame || result?.record_id) return;
    void startJob(async (_, signal) => {
      const saved = await requestDetection(frame, frameThreshold.current, "camera", signal, { coilId, archive: true });
      if (mounted.current) { setResult(saved); if (saved.record_id) onArchived?.(); }
    });
  }

  function exportCsv() {
    const url = URL.createObjectURL(new Blob([resultsCsv(items)], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "steelvision-" + Date.now() + ".csv";
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  const finished = items.filter(item => item.status === "success" || item.status === "error").length;
  const pendingCount = items.filter(item => item.status === "pending").length;
  const batchResult = items[selected];

  if (readOnly) return <section className="panel"><h2>检测工作台</h2><p>当前账号没有检测权限。请联系总管理员检查账号状态。</p></section>;

  return <section className="panel detection-workbench">
    <div className="detection-tabs" role="tablist" aria-label="检测模式">
      {([["camera", "实时监测"], ["batch", "图片/批量检测"]] as const).map(([id, label]) => <button key={id} id={"tab-" + id} role="tab" aria-selected={mode === id} aria-controls="detection-content" className={mode === id ? "selected" : ""} disabled={busy || networkBusy} onClick={() => changeMode(id)}>{label}</button>)}
    </div>
    <details className="sv-advanced"><summary>检测参数 · 当前阈值 {threshold.toFixed(2)}</summary><div className="detection-toolbar">
      <label>置信度阈值：<strong>{threshold.toFixed(2)}</strong><input aria-label="置信度阈值" type="range" min="0.1" max="0.95" step="0.05" value={threshold} disabled={busy || networkBusy} onChange={event => setThreshold(Number(event.target.value))} /></label>
      <span>JPG / PNG · 每张最大 10 MB · {coilId ? "归档至所选钢板" : "未关联钢板"}</span>
    </div>
          <label>帧间等待<select aria-label="帧间等待" value={intervalMs} disabled={busy||networkBusy} onChange={event => setIntervalMs(Number(event.target.value))}>{![250,500,1000,2000].includes(intervalMs)&&<option value={intervalMs}>{intervalMs / 1000} 秒</option>}<option value={250}>0.25 秒</option><option value={500}>0.5 秒</option><option value={1000}>1 秒</option><option value={2000}>2 秒</option></select></label>
    </details>
    <div id="detection-content" role="tabpanel" aria-labelledby={"tab-" + mode}>
      {mode === "batch" && <>
        <div className={"sv-upload-zone "+(dragging?"is-dragging":"")} onDragOver={e=>{e.preventDefault();if(!busy)setDragging(true);}} onDragLeave={()=>setDragging(false)} onDrop={e=>{e.preventDefault();setDragging(false);if(!busy)chooseFolder(Array.from(e.dataTransfer.files));}}>
          <strong>拖入图片，或选择图片 / 文件夹</strong><p>JPG、PNG · 每张最大 10 MB · 文件夹选择支持子目录</p>
          <div className="detection-actions"><label className="file-picker">选择图片<input aria-label="选择图片" type="file" accept=".jpg,.jpeg,.png" multiple disabled={busy} onChange={event => { chooseFolder(event.target.files); event.target.value = ""; }} /></label>
          <label className="file-picker">选择文件夹<input aria-label="选择图片文件夹" type="file" multiple {...directoryProps} disabled={busy} onChange={event => { chooseFolder(event.target.files); event.target.value = ""; }} /></label>
          </div><span>{selectionName ? `${selectionName} · ${items.length} 张图片已选择` : "尚未选择图片"}</span></div><div className="detection-actions">
          <button className="primary" disabled={!pendingCount || busy} onClick={()=>detectBatch()}>{busy ? "图片检测中…" : finished && pendingCount ? "继续图片检测" : "开始图片检测"}</button>
          <button className="quiet" disabled={!busy || stopping} onClick={stop}>{stopping ? "正在停止…" : "停止后续任务"}</button>
          <button className="quiet" disabled={busy||!items.some(item=>item.status==="error")} onClick={()=>detectBatch(true)}>重试失败项</button>
          <button className="quiet" disabled={!items.length || busy} onClick={exportCsv}>导出 CSV 明细</button>
        </div>
        <p role="status">完成 {finished} / {items.length} · 成功 {items.filter(item => item.status === "success").length} · 失败 {items.filter(item => item.status === "error").length} · 已跳过 {skipped} 个非图片文件</p>
        <progress aria-label="批图片检测测进度" value={finished} max={items.length || 1} />
        <div className="detection-columns">
          <div><label className="cam-filter">状态筛选<select aria-label="批量状态筛选" value={batchFilter} onChange={e => setBatchFilter(e.target.value)}><option value="all">全部图片</option>{Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><div className="cam-batch-grid">{items.map((item, index) => batchFilter !== "all" && item.status !== batchFilter ? null : <button key={`${item.name}-${index}`} className={"cam-thumbnail " + (selected === index ? "cam-selected" : "")} onClick={() => setSelected(index)}><img src={item.result?.annotated_image || thumbnails[index]} alt={item.name} /><strong title={item.name}>{item.name}</strong><span>{statusLabels[item.status]} · {item.result ? `${item.result.count} 个目标` : "等待结果"}</span>{item.result?.record_id && <small>{item.result.review_status==="auto_confirmed"?"AI 自动确认 · 可抽检":"已归档 · 待复检"}</small>}</button>)}</div>{!items.length && <p className="detection-empty">选择一张、多张图片或整个文件夹，按文件名依次检测；支持子文件夹。</p>}{items.length > 0 && batchFilter !== "all" && !items.some(i => i.status === batchFilter) && <p>没有此状态的图片。</p>}</div>
          <div>{batchResult?.error && <p className="warning">{batchResult.name}：{batchResult.error}</p>}<ResultView result={batchResult?.result ?? null} title={batchResult?.name || "批图片检测测结果"} /></div>
        </div>
      </>}
      {mode === "camera" && <>
        <div className="cam-toolbar"><label>摄像头来源<select aria-label="摄像头来源" value={cameraKind} disabled={busy || networkBusy} onChange={e => { closeCamera(); setResult(null); lastFrame.current = null; setCameraKind(e.target.value); }}><option value="local">本机 / USB 摄像头</option><option value="network">网络摄像头</option></select></label></div>
        {cameraKind === "network" ? <NetworkCamera active={active} threshold={threshold} intervalMs={intervalMs} coilId={coilId} onArchived={onArchived} onBusyChange={setNetworkBusy} /> : <>
        <div className="detection-actions cam-setup">
          <button className="quiet" disabled={busy || opening} onClick={() => void refreshDevices()}>发现 / 刷新摄像头</button>
          <label>本机设备<select aria-label="本机摄像头设备" value={deviceId} disabled={busy || opening} onChange={e => { closeCamera(); setDeviceId(e.target.value); setResult(null); lastFrame.current = null; }}><option value="">请选择摄像头</option>{devices.map((d, i) => <option key={d.deviceId || i} value={d.deviceId}>{d.label || `摄像头 ${i + 1}`}</option>)}</select></label>
          <button className="quiet" disabled={opening || cameraOpen || busy} onClick={() => void openCamera()}>{opening ? "等待摄像头授权…" : "打开摄像头"}</button>
        </div><div className="detection-actions cam-primary-actions">
          <button className="primary" disabled={!cameraReady || busy} onClick={detectCamera}>{busy ? "连续检测中…" : "开始连续检测"}</button>
          <button className="quiet" disabled={!busy || stopping} onClick={stop}>{stopping ? "正在停止…" : "停止检测"}</button>
          <button className="quiet" disabled={!cameraOpen && !opening} onClick={closeCamera}>关闭摄像头</button>
          <button className="quiet" disabled={!result || busy || !!result.record_id} onClick={saveCameraFrame}>{result?.record_id ? "当前结果已归档" : "保存当前结果"}</button>

        </div>
        <p className="detection-help">每帧完成后再等待设定时间并采集下一帧。右侧显示已处理帧，实际检测速度取决于 CPU 推理耗时。</p>
        <div className="detection-columns"><section><h3>摄像头实时预览</h3><div className="live-preview"><video ref={video} muted playsInline autoPlay onLoadedData={() => { if (stream.current) setCameraReady(true); }} />{!cameraOpen && <div>点击“打开摄像头”并允许浏览器访问</div>}</div></section><ResultView result={result} title="最近一帧的检测结果" /></div>
        <p role="status">已检测 {frameInfo.count} 帧{frameInfo.time && (" · 最近结果 " + frameInfo.time + " · 截帧与检测耗时 " + frameInfo.elapsed + " ms")}{!busy && frameInfo.count > 0 && " · 检测已停止"}</p>
        </>}
      </>}
    </div>
    {stopping && <p role="status">已停止安排新任务，等待当前请求结束后即可继续操作。</p>}
    {error && <p className="warning" role="alert">{error}</p>}
    <p className="detection-help">图片检测成功后按检测日期自动归档。至少含一个目标且全部检测框置信度超过 90% 的图片标记为 AI 自动确认，其余进入人工复检。摄像头帧仅在点击“保存当前结果”后归档；连续预览不计入质量统计。</p>
  </section>;
}
