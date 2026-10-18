"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { formatDate } from "@/lib/dates";
import { formatKes } from "@/lib/money";

export const tone = (v: number) => (v < 0 ? "neg" : v > 0 ? "pos" : "");
export const longDate = (iso: string) => formatDate(iso, { day: "numeric", month: "long", year: "numeric" });

export function Kes({ cents, sign, className = "" }: { cents: number; sign?: boolean; className?: string }) {
  return <span className={`num ${tone(cents)} ${className}`}>{formatKes(cents, { sign })}</span>;
}

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    ref.current?.querySelector<HTMLElement>("input:not([readonly]), select, textarea, button.primary")?.focus();
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title} ref={ref}>
        <h3>{title} <button className="close" onClick={onClose} aria-label="Close">×</button></h3>
        {children}
      </div>
    </div>
  );
}

export function Confirm({ message, okLabel, onOk, onClose }: { message: string; okLabel: string; onOk: () => void; onClose: () => void }) {
  return (
    <Modal title="Are you sure?" onClose={onClose}>
      <p>{message}</p>
      <div className="actions">
        <button className="btn primary" onClick={() => { onClose(); onOk(); }}>{okLabel}</button>
        <button className="btn" onClick={onClose}>Cancel</button>
      </div>
    </Modal>
  );
}

export function FormError({ message }: { message: string }) {
  return message ? <div className="form-error" role="alert">{message}</div> : null;
}
