"use client";
/* eslint-disable @next/next/no-img-element -- Authenticated media and Blob frames must be fetched directly by the browser. */

import { useEffect, useRef, useState, type FormEvent } from "react";
import { api, API_BASE } from "./api";
import { cameraStatus, safeCameraError, type CameraDevice } from "./NetworkCamera";
import "./camera.css";
import { Drawer } from "./ui";

type DeviceForm = { name: string; url: string; username: string; password: string; enabled: boolean; clearPassword: boolean };
const emptyForm: DeviceForm = { name: "", url: "", username: "", password: "", enabled: true, clearPassword: false };

export default function DevicesView({ canManage, onChange }: { canManage: boolean; onChange?: () => void }) {
  const [devices, setDevices] = useState<CameraDevice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<CameraDevice | "new" | null>(null);
  const [form, setForm] = useState<DeviceForm>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState("");
  const [preview, setPreview] = useState("");
  const [localDevices, setLocalDevices] = useState<MediaDeviceInfo[]>([]);
  const [discovering, setDiscovering] = useState(false);
  const alive = useRef(false);
  const generation = useRef(0);
  const active = useRef("");
  const connection = useRef<Promise<unknown> | null>(null);
  const previewUrl = useRef("");

  async function load() {
    setLoading(true); setError("");
    try { const data = await api<CameraDevice[]>("/devices"); if (alive.current) setDevices(data); }
    catch (e) { if (alive.current) setError(safeCameraError(e)); }
    finally { if (alive.current) setLoading(false); }
  }

  useEffect(() => {
    alive.current = true;
    void api<CameraDevice[]>("/devices").then(value => { if(alive.current) setDevices(value); }).catch(e => { if(alive.current) setError(safeCameraError(e)); }).finally(() => { if(alive.current) setLoading(false); });
    return () => {
      // Invalidate the latest async generation, not the generation captured at mount.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      alive.current = false; generation.current++;
      if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
      const id = active.current;
      if (id) void Promise.resolve(connection.current).catch(() => {}).then(() => api(`/devices/${id}/disconnect`, { method: "POST" })).catch(() => {});
    };
  }, []);

  function edit(device: CameraDevice | "new") {
    setEditing(device); setError("");
    setForm(device === "new" ? emptyForm : { ...emptyForm, name: device.name, url: device.url, enabled: device.enabled });
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!editing || saving) return;
    setSaving(true); setError("");
    const data: Record<string, unknown> = { name: form.name.trim(), url: form.url.trim(), enabled: form.enabled };
    if (form.username || editing === "new") data.username = form.username;
    if (form.password || form.clearPassword || editing === "new") data.password = form.clearPassword ? "" : form.password;
    try {
      await api(editing === "new" ? "/devices" : `/devices/${editing.id}`, { method: editing === "new" ? "POST" : "PATCH", body: JSON.stringify(data) });
      if (alive.current) { setEditing(null); await load(); onChange?.(); }
    } catch (e) { if (alive.current) setError(safeCameraError(e)); }
    finally { if (alive.current) setSaving(false); }
  }

  async function stopTest() {
    generation.current++; const id = active.current; active.current = "";
    if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
    previewUrl.current = ""; setPreview("");
    try { await connection.current?.catch(() => {}); if (id) await api(`/devices/${id}/disconnect`, { method: "POST" }); }
    catch (e) { if (alive.current) setError(safeCameraError(e)); }
    finally { if (alive.current) { setTesting(""); await load(); } }
  }

  async function testDevice(device: CameraDevice) {
    if (active.current) return;
    const token = ++generation.current;
    active.current = device.id; setTesting(device.id); setError("");
    try {
      const operation = api<CameraDevice>(`/devices/${device.id}/connect`, { method: "POST" }); connection.current = operation;
      let status = await operation;
      const deadline = Date.now() + 15000;
      while (alive.current && generation.current === token) {
        setDevices(items => items.map(item => item.id === device.id ? status : item));
        if (status.status === "error" || status.status === "disconnected") throw new Error(status.error || "设备连接已断开");
        if (status.status === "connecting" && Date.now() > deadline) throw new Error("连接超时，请检查设备地址及网络");
        if (status.status === "connected") {
          const response = await fetch(`${API_BASE}/api/v1/devices/${device.id}/frame`, { credentials: "include", cache: "no-store", signal: AbortSignal.timeout(8000) });
          if (!response.ok) throw new Error(`视频帧读取失败（${response.status}）`);
          const blob = await response.blob();
          if (!alive.current || generation.current !== token) break;
          const old = previewUrl.current; previewUrl.current = URL.createObjectURL(blob); setPreview(previewUrl.current); if (old) URL.revokeObjectURL(old);
        }
        await new Promise(resolve => setTimeout(resolve, 700));
        if (!alive.current || generation.current !== token) break;
        status = await api<CameraDevice>(`/devices/${device.id}/status`);
      }
    } catch (e) {
      if (alive.current && generation.current === token) { await stopTest(); setError(safeCameraError(e)); }
    }
  }

  async function discover() {
    if (discovering) return;
    setDiscovering(true); setError("");
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error("请通过 localhost 或 HTTPS 访问以发现本机摄像头");
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      stream.getTracks().forEach(track => track.stop());
      const found = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === "videoinput");
      if (alive.current) setLocalDevices(found);
    } catch (e) { if (alive.current) setError(e instanceof Error && e.name === "NotAllowedError" ? "摄像头权限被拒绝，请在浏览器网站权限中允许后重试。" : safeCameraError(e)); }
    finally { if (alive.current) setDiscovering(false); }
  }

  return <div className="cam-devices-view">
    <div className="cam-heading"><div/><div className="cam-toolbar"><button className="quiet" disabled={loading || !!testing} onClick={() => void load()}>刷新状态</button>{canManage && <button className="primary" disabled={!!testing} onClick={() => edit("new")}>添加网络设备</button>}</div></div>
    {error && <p role="alert" className="warning">{error}</p>}
    <section className="panel cam-local-discovery"><div><h3>本机 / USB 摄像头</h3><p>设备名称和编号仅适用于当前浏览器。进入实时检测选择设备后开始采集。</p></div><button className="quiet" disabled={discovering} onClick={() => void discover()}>{discovering ? "等待授权…" : "发现本机摄像头"}</button>{localDevices.length > 0 && <div className="cam-local-tags">{localDevices.map((d, i) => <span key={d.deviceId || i}>{d.label || `摄像头 ${i + 1}`}</span>)}</div>}</section>
    {loading ? <p role="status">正在加载设备…</p> : devices.length ? <div className="cam-device-grid">{devices.map(device => <article className="panel cam-device-card" key={device.id}><div className="cam-heading"><h3>{device.name}</h3><span className={device.status === "connected" ? "cam-state-on" : "cam-state"}>{device.enabled ? cameraStatus(device.status) : "已停用"}</span></div><p className="cam-device-url" title={device.url}>{device.url}</p><p>{device.has_password ? "已保存连接凭据" : "未保存密码"}</p>{device.error && <p className="warning">{safeCameraError(device.error)}</p>}{device.last_seen && <small>最近接收：{new Date(device.last_seen).toLocaleString()}</small>}{canManage && <div className="cam-toolbar"><button className="quiet" disabled={!!testing} onClick={() => edit(device)}>编辑配置</button><button className="quiet" disabled={!!testing || !device.enabled} onClick={() => void testDevice(device)}>测试连接</button></div>}</article>)}</div> : <section className="panel"><h3>尚未配置网络摄像头</h3><p>添加 RTSP 或 HTTP 视频源后，即可测试连接并在检测工作台使用。</p><button className="quiet" onClick={() => void load()}>重新加载</button></section>}
    {testing && <section className="panel"><div className="cam-heading"><h3>连接测试</h3><button className="quiet" onClick={() => void stopTest()}>停止测试并断开</button></div>{preview ? <img className="cam-test-preview" src={preview} alt="设备连接测试实时画面" /> : <p role="status">正在等待设备画面…</p>}</section>}
    {editing && <Drawer title={editing === "new" ? "添加网络设备" : "编辑设备配置"} onClose={() => { if (!saving) setEditing(null); }}><div className="cam-drawer-form"><form onSubmit={save}><label>设备名称<input aria-label="设备名称" required maxLength={100} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></label><label>视频地址<input aria-label="视频地址" required placeholder="rtsp://设备地址/视频路径" value={form.url} onChange={e => setForm({ ...form, url: e.target.value })} /></label><p>支持 RTSP 和 HTTP 视频流。请将用户名和密码填写在下方独立字段中。</p><label>连接用户名<input aria-label="连接用户名" autoComplete="off" value={form.username} placeholder={editing === "new" ? "可选" : "留空保留现有用户名"} onChange={e => setForm({ ...form, username: e.target.value })} /></label><label>连接密码<input aria-label="连接密码" type="password" autoComplete="new-password" value={form.password} placeholder={editing === "new" ? "可选" : "留空保留现有密码"} onChange={e => setForm({ ...form, password: e.target.value, clearPassword: false })} /></label>{editing !== "new" && <label className="cam-check"><input type="checkbox" checked={form.clearPassword} onChange={e => setForm({ ...form, clearPassword: e.target.checked })} />清除已保存的密码</label>}<label className="cam-check"><input type="checkbox" checked={form.enabled} onChange={e => setForm({ ...form, enabled: e.target.checked })} />启用设备</label>{error && <p role="alert" className="warning">{error}</p>}<button className="primary" disabled={saving}>{saving ? "正在保存…" : "保存配置"}</button></form></div></Drawer>}
  </div>;
}
