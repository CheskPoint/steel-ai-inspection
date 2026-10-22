"use client";

import { useEffect, useState } from "react";
import { readServiceInfo, type ServiceInfo } from "./detection";

type ModelState = { kind: "checking" | "offline" | "ready" | "not_deployed"; info?: ServiceInfo; error?: string };

export function useModelStatus(enabled = true) {
  const [state, setState] = useState<ModelState>({ kind: "checking" });
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    const control = new AbortController();
    let pending = false;
    async function check() {
      if (pending) return;
      pending = true;
      try {
        const info = await readServiceInfo(control.signal);
        if (!control.signal.aborted) setState({ kind: info.mode, info });
      } catch (error) {
        if (!control.signal.aborted) setState({ kind: "offline", error: error instanceof Error ? error.message : "连接失败" });
      } finally { pending = false; }
    }
    void check();
    const interval = setInterval(() => void check(), 15000);
    const onFocus = () => void check();
    window.addEventListener("focus", onFocus);
    return () => { control.abort(); clearInterval(interval); window.removeEventListener("focus", onFocus); };
  }, [revision, enabled]);

  const label = { checking: "正在检查模型", ready: "模型已加载", not_deployed: "模型未部署", offline: "后端未连接" }[state.kind];
  function refresh() { setState({ kind: "checking" }); setRevision(value => value + 1); }
  return { ...state, label, refresh };
}
