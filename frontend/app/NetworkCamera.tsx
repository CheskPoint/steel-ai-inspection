"use client";
/* eslint-disable @next/next/no-img-element -- Authenticated media and Blob frames must be fetched directly by the browser. */

import { useEffect, useRef, useState } from "react";
import { api, API_BASE } from "./api";
import { requestDetection, runContinuous, type DetectionResult } from "./detection";
import "./camera.css";

export type CameraDevice = { id: string; name: string; url: string; enabled: boolean; has_password: boolean; status: string; error?: string; last_seen?: string };
export function safeCameraError(error: unknown) {
  const text = error instanceof Error ? error.message : String(error || "设备请求失败");
  return text.replace(/(?:rtsp|rtsps|https?):\/\/[^\s"'<>]+/gi, "[视频地址]");
}
export const cameraStatus = (status: string) => ({ connected: "已连接", connecting: "连接中", disconnected: "未连接", error: "连接失败", stopped: "已停止", disabled: "已停用" }[status] || status || "未连接");

export default function NetworkCamera({ threshold, intervalMs, coilId, onArchived, onBusyChange, active = true }: { active?:boolean; threshold: number; intervalMs: number; coilId?: string; onArchived?: () => void; onBusyChange?: (busy: boolean) => void }) {
  const [devices, setDevices] = useState<CameraDevice[]>([]);
  const [selected, setSelected] = useState("");
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState("");
  const [result, setResult] = useState<DetectionResult | null>(null);
  const [frames, setFrames] = useState(0);
  const alive = useRef(false);
  const generation = useRef(0);
  const activeDevice = useRef("");
  const pendingConnect = useRef<Promise<unknown> | null>(null);
  const polling = useRef<AbortController | null>(null);
  const loop = useRef<AbortController | null>(null);
  const request = useRef<AbortController | null>(null);
  const latest = useRef<File | null>(null);
  const resultFrame = useRef<File | null>(null);
  const resultThreshold = useRef(threshold);
  const previewUrl = useRef("");
  const callback = useRef(onBusyChange);
  useEffect(() => { callback.current = onBusyChange; }, [onBusyChange]);

  useEffect(() => { onBusyChange?.(connecting || busy); }, [connecting, busy, onBusyChange]);
  useEffect(() => {
    alive.current = true;
    const controller = new AbortController();
    void api<CameraDevice[]>("/devices", { signal: controller.signal }).then(value => { if (alive.current) setDevices(value); }).catch(e => { if (!controller.signal.aborted) setError(safeCameraError(e)); });
    return () => {
      // Invalidate the latest async generation, not the generation captured at mount.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      alive.current = false; generation.current++; controller.abort(); polling.current?.abort(); loop.current?.abort(); request.current?.abort();
      const id = activeDevice.current;
      const connect = pendingConnect.current;
      if (id) void Promise.resolve(connect).catch(() => {}).then(() => api(`/devices/${id}/disconnect`, { method: "POST" })).catch(() => {});
      if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
      callback.current?.(false);
    };
  }, []);

  const disconnectRef=useRef<()=>Promise<void>>(async()=>{});
  useEffect(()=>{disconnectRef.current=disconnect;});
  useEffect(()=>{if(!active) void disconnectRef.current();},[active]);

  async function disconnect() {
    generation.current++; polling.current?.abort(); loop.current?.abort();
    const id = activeDevice.current;
    activeDevice.current = "";
    latest.current = null;
    setConnected(false);
    if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
    previewUrl.current = ""; setPreview("");
    if (id) {
      setConnecting(true);
      try { await pendingConnect.current?.catch(() => {}); await api(`/devices/${id}/disconnect`, { method: "POST" }); }
      catch (e) { if (alive.current) setError(safeCameraError(e)); }
      finally { if (alive.current) setConnecting(false); }
    }
  }

  async function pollFrames(id: string, token: number, signal: AbortSignal) {
    let failures = 0;
    while (!signal.aborted && generation.current === token) {
      try {
        const response = await fetch(`${API_BASE}/api/v1/devices/${id}/frame?t=${Date.now()}`, { credentials: "include", cache: "no-store", signal: AbortSignal.any([signal, AbortSignal.timeout(8000)]) });
        if (response.status === 401) window.dispatchEvent(new Event("steelvision:unauthorized"));
        if (!response.ok) {
          const body = await response.json().catch(() => null) as {detail?:unknown}|null;
          throw new Error(typeof body?.detail === "string" ? body.detail : `预览暂不可用（${response.status}）`);
        }
        const blob = await response.blob();
        if (signal.aborted || generation.current !== token) break;
        latest.current = new File([blob], `network-${Date.now()}.jpg`, { type: "image/jpeg" });
        const url = URL.createObjectURL(blob);
        const old = previewUrl.current; previewUrl.current = url; setPreview(url);
        if (old) URL.revokeObjectURL(old);
        failures = 0;
      } catch (e) {
        if (signal.aborted || generation.current !== token) break;
        if (++failures >= 3) { setError(safeCameraError(e)); void disconnect(); break; }
      }
      await new Promise<void>(resolve => {
        const done = () => { clearTimeout(timer); signal.removeEventListener("abort", done); resolve(); };
        const timer = setTimeout(done, 500); signal.addEventListener("abort", done, { once: true });
        if (signal.aborted) done();
      });
    }
  }

  async function connect() {
    if (!selected || connecting || activeDevice.current) return;
    const token = ++generation.current;
    activeDevice.current = selected; setConnecting(true); setError(""); setResult(null); resultFrame.current = null; setFrames(0);
    try {
      const operation = api<CameraDevice>(`/devices/${selected}/connect`, { method: "POST" });
      pendingConnect.current = operation;
      let device = await operation;
      const deadline = Date.now() + 15000;
      while (device.status === "connecting" && alive.current && token === generation.current && Date.now() < deadline) {
        await new Promise(resolve => setTimeout(resolve, 500));
        if (!alive.current || token !== generation.current) return;
        device = await api<CameraDevice>(`/devices/${selected}/status`);
      }
      if (!alive.current || token !== generation.current) return;
      if (device.status !== "connected") throw new Error(device.error || "设备未能在限定时间内连接，请检查视频地址后重试");
      setConnected(true);
      const controller = new AbortController(); polling.current = controller;
      void pollFrames(selected, token, controller.signal);
    } catch (e) {
      if (alive.current && token === generation.current) { setError(safeCameraError(e)); await disconnect(); }
    } finally { if (alive.current && token === generation.current) setConnecting(false); }
  }

  async function detect() {
    if (loop.current || !latest.current) return;
    const control = new AbortController(); const network = new AbortController();
    loop.current = control; request.current = network; setBusy(true); setError("");
    try {
      await runContinuous(async () => {
        const frame = latest.current;
        if (!frame) throw new Error("视频画面尚未准备好");
        const detection = await requestDetection(frame, threshold, "camera", network.signal, { coilId, archive: false });
        return { frame, detection };
      }, ({ frame, detection }) => {
        if (!alive.current) return;
        resultFrame.current = frame; resultThreshold.current = threshold; setResult(detection); setFrames(value => value + 1);
      }, control.signal, intervalMs);
    } catch (e) { if (alive.current && !control.signal.aborted) setError(safeCameraError(e)); }
    finally { loop.current = null; request.current = null; if (alive.current) setBusy(false); }
  }

  async function saveFrame() {
    const frame = resultFrame.current;
    if (!frame || busy || result?.record_id) return;
    const controller = new AbortController(); request.current = controller; setBusy(true); setError("");
    try {
      const saved = await requestDetection(frame, resultThreshold.current, "camera", controller.signal, { coilId, archive: true });
      if (alive.current) { setResult(saved); if (saved.record_id) onArchived?.(); }
    } catch (e) { if (alive.current) setError(safeCameraError(e)); }
    finally { request.current = null; if (alive.current) setBusy(false); }
  }

  return <div className="cam-network">
    <div className="cam-toolbar">
      <label>网络摄像头<select aria-label="网络摄像头" value={selected} disabled={connected || connecting || busy} onChange={e => setSelected(e.target.value)}><option value="">选择已配置设备</option>{devices.filter(d => d.enabled).map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label>
      <button className="quiet" disabled={!selected || connected || connecting || busy} onClick={() => void connect()}>{connecting ? "连接处理中…" : "连接设备"}</button>
      <button className="primary" disabled={!preview || !connected || busy || connecting} onClick={() => void detect()}>开始网络连续检测</button>
      <button className="quiet" disabled={!busy} onClick={() => loop.current?.abort()}>停止网络检测</button>
      <button className="quiet" disabled={!connected && !connecting} onClick={() => void disconnect()}>断开设备</button>
      <button className="quiet" disabled={!result || busy || !!result?.record_id} onClick={() => void saveFrame()}>{result?.record_id ? "当前结果已归档" : "保存当前结果"}</button>
    </div>
    {!devices.some(d => d.enabled) && <p className="detection-help">请先在设备管理中添加并启用网络摄像头。</p>}
    <div className="detection-columns"><section><h3>网络视频预览</h3><div className="cam-preview">{preview ? <img src={preview} alt="网络摄像头实时预览" /> : <p>选择设备并连接后显示实时画面</p>}</div></section><section className="detection-result"><h3>最近一帧的检测结果</h3>{result ? <><img src={result.annotated_image} alt="网络摄像头模型标注结果" /><p>检测到 {result.count} 个目标 · {result.record_id ? "已归档" : "未归档"}</p><details><summary>缺陷明细</summary>{result.detections.map((d, i) => <p key={i}>{d.class_name} · {(d.confidence * 100).toFixed(1)}%</p>)}</details></> : <p className="detection-empty">开始检测后显示结果</p>}</section></div>
    <p role="status">{connected ? "设备连接已建立" : "设备未连接"} · 已处理 {frames} 帧。停止检测后，可保存右侧结果对应的原始帧。</p>
    {error && <p className="warning" role="alert">{error}</p>}
  </div>;
}
