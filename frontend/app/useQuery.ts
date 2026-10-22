"use client";
import { useEffect, useState } from "react";
import { api } from "./api";
import { messageOf } from "./ui";

/** Cancels stale filters and never shows a previous page as the current result. */
export function useQuery<T>(path: string, revision = 0, enabled = true) {
  const [state, setState] = useState<{key:string;data?:T;error?:string}>({key:""});
  const [refresh,setRefresh] = useState(0);
  const key = `${path}|${revision}|${refresh}|${enabled}`;
  useEffect(()=>{
    const update=()=>setRefresh(value=>value+1);
    window.addEventListener("steelvision:workspace-updated",update);
    return ()=>window.removeEventListener("steelvision:workspace-updated",update);
  },[]);
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void api<T>(path, {signal:controller.signal}).then(data => {
        if (!controller.signal.aborted) setState({key, data});
      }).catch(error => {if (!controller.signal.aborted) setState({key,error:messageOf(error)});});
    }, 180);
    return () => {clearTimeout(timer);controller.abort();};
  }, [path, key, enabled]);
  return state.key === key ? {...state,loading:false} : {key,loading:enabled,data:undefined,error:undefined};
}

export function queryString(values: Record<string, string | number | undefined | null>) {
  const params = new URLSearchParams();
  for (const [key,value] of Object.entries(values)) if (value !== undefined && value !== null && value !== "") params.set(key,String(value));
  return params.toString();
}
