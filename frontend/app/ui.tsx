"use client";

import { useEffect, useRef, useId, useState, cloneElement, isValidElement, type ReactElement, type ReactNode, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { displayStatus } from "./platform-types";

export function Empty({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return <div className="sv-empty"><span className="sv-empty-symbol">◇</span><h3>{title}</h3>{children && <p>{children}</p>}{action}</div>;
}
export function Badge({ value }: { value: string }) { return <span className={`sv-badge sv-state-${value}`}>{displayStatus(value)}</span>; }
export function SectionHeading({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return <div className="sv-section-heading"><div><h2>{title}</h2>{description && <p>{description}</p>}</div>{action}</div>;
}
export function Drawer({ title, subtitle, children, onClose, wide = false, dirty, onSave }: { title: string; subtitle?: string; children: ReactNode; onClose: () => void; wide?: boolean; dirty?: boolean; onSave?:()=>void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [changed, setChanged] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const unsaved = dirty ?? changed;
  function requestClose() {
    if (dialog.current?.querySelector('fieldset:disabled')) return;
    if (unsaved) setConfirm(true); else onClose();
  }
  useEffect(() => {
    if (!unsaved) return;
    const guard = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [unsaved]);
  useEffect(() => {
    const element = dialog.current;
    const previous = document.activeElement as HTMLElement | null;
    element?.showModal();
    const scroll = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { element?.close(); document.body.style.overflow = scroll; previous?.focus(); };
  }, []);
  return createPortal(<dialog ref={dialog} className={"sv-drawer" + (wide ? " sv-drawer-wide" : "")} aria-label={title} onCancel={event => { event.preventDefault(); requestClose(); }} onClick={event => { if (event.target === event.currentTarget) { const rect = event.currentTarget.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) requestClose(); } }}><div className="sv-drawer-head"><div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div><button className="sv-icon-button" aria-label="关闭详情" onClick={requestClose}>×</button></div>{confirm&&<div className="sv-unsaved" role="alertdialog" aria-label="未保存的修改"><b>还有未保存的修改</b><p>关闭将丢失本次编辑，已保存的记录不受影响。</p><div className="sv-actions"><button className="primary" onClick={()=>setConfirm(false)}>继续编辑</button><button className="quiet" onClick={()=>{setConfirm(false);if(onSave)onSave();else dialog.current?.querySelector('form')?.requestSubmit();}}>保存修改</button><button className="sv-danger-text" onClick={onClose}>放弃修改</button></div></div>}<div className="sv-drawer-body" onChangeCapture={event=>{if(dirty===undefined&&(event.target as HTMLElement).closest("form"))setChanged(true);}}>{children}</div></dialog>, document.body);
}
export function Field({ label, children, wide = false }: { label: string; children: ReactNode; wide?: boolean }) { const id=useId(); return <label className={"sv-field" + (wide ? " sv-field-wide" : "")}><span id={id}>{label}</span>{isValidElement(children) ? cloneElement(children as ReactElement<Record<string, unknown>>, {"aria-labelledby":id}) : children}</label>; }
export function ErrorNote({ text }: { text: string }) { return text ? <div className="sv-error" role="alert">{text}</div> : null; }
export function Form({ children, onSubmit, busy, error, submit = "保存", onCancel }: { children: ReactNode; onSubmit: (event: FormEvent<HTMLFormElement>) => void; busy: boolean; error: string; submit?: string; onCancel?: () => void }) {
  return <form className="sv-form" onSubmit={onSubmit}><fieldset disabled={busy}>{children}</fieldset><ErrorNote text={error} /><div className="sv-form-footer">{onCancel && <button type="button" className="quiet" disabled={busy} onClick={onCancel}>取消</button>}<button className="primary" type="submit" disabled={busy}>{busy ? "正在保存…" : submit}</button></div></form>;
}
export function getForm(event: FormEvent<HTMLFormElement>) { event.preventDefault(); return Object.fromEntries(new FormData(event.currentTarget).entries()) as Record<string, string>; }
export const messageOf = (error: unknown) => error instanceof Error ? error.message : "操作失败，请重试";
