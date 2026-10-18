"use client";

import { useEffect, useMemo, useRef, type ReactNode } from "react";
import { useT } from "@/i18n/client";
import { formatDate } from "@/lib/dates";
import { formatAmount, formatMoney } from "@/lib/money";

export const tone = (v: number) => (v < 0 ? "neg" : v > 0 ? "pos" : "");

/** Locale + currency aware formatters for the active budget. */
export function useFmt(currency: string) {
  const { locale } = useT();
  return useMemo(() => ({
    money: (minor: number, sign = false) => formatMoney(minor, currency, locale, { sign }),
    amount: (minor: number) => formatAmount(minor, currency, locale),
    date: (iso: string, opts?: Intl.DateTimeFormatOptions) => formatDate(iso, opts, locale),
    longDate: (iso: string) => formatDate(iso, { day: "numeric", month: "long", year: "numeric" }, locale),
    locale,
  }), [currency, locale]);
}

export function Money({ minor, currency, sign, className = "" }: { minor: number; currency: string; sign?: boolean; className?: string }) {
  const f = useFmt(currency);
  return <span className={`num ${tone(minor)} ${className}`}>{f.money(minor, sign)}</span>;
}

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const { t } = useT();
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
        <h3>{title} <button className="close" onClick={onClose} aria-label={t("common.close")}>×</button></h3>
        {children}
      </div>
    </div>
  );
}

export function Confirm({ message, okLabel, onOk, onClose }: { message: string; okLabel: string; onOk: () => void; onClose: () => void }) {
  const { t } = useT();
  return (
    <Modal title={t("common.areYouSure")} onClose={onClose}>
      <p>{message}</p>
      <div className="actions">
        <button className="btn primary" onClick={() => { onClose(); onOk(); }}>{okLabel}</button>
        <button className="btn" onClick={onClose}>{t("common.cancel")}</button>
      </div>
    </Modal>
  );
}

export function FormError({ message }: { message: string }) {
  return message ? <div className="form-error" role="alert">{message}</div> : null;
}
