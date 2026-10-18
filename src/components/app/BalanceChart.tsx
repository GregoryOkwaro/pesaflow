"use client";

import { useEffect, useRef, useState } from "react";
import type { Projection } from "@/engine/engine";
import { useT } from "@/i18n/client";
import { tone, useFmt } from "./ui";

/** Step chart of the projected balance (the balance holds all day, then jumps). Red below zero. */
export function BalanceChart({ projection: p, currency }: { projection: Projection; currency: string }) {
  const { t, tp } = useT();
  const f = useFmt(currency);
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(600);
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(280, Math.floor(e!.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const W = width, H = 220, padL = 8, padR = 8, padT = 14, padB = 24;
  const vals = p.days.map((d) => d.balance);
  let min = Math.min(0, ...vals), max = Math.max(0, ...vals);
  if (min === max) { max += 100; min -= 100; }
  const span = max - min;
  min -= span * 0.08; max += span * 0.08;
  const n = vals.length;
  const x = (i: number) => padL + (n === 1 ? 0 : (i * (W - padL - padR)) / (n - 1));
  const y = (v: number) => padT + ((max - v) * (H - padT - padB)) / (max - min);
  let d = `M${x(0)},${y(vals[0]!)}`;
  for (let i = 1; i < n; i++) d += ` L${x(i)},${y(vals[i - 1]!)} L${x(i)},${y(vals[i]!)}`;
  const zeroY = y(0);
  const area = `${d} L${x(n - 1)},${zeroY} L${x(0)},${zeroY} Z`;
  const lowIdx = vals.indexOf(Math.min(...vals));
  const ticks = [...new Set([0, Math.floor((n - 1) / 2), n - 1])];

  const pick = (clientX: number, rect: DOMRect) => {
    const rel = ((clientX - rect.left) / rect.width) * W;
    setHover(Math.max(0, Math.min(n - 1, Math.round(((rel - padL) / (W - padL - padR)) * (n - 1)))));
  };
  const day = hover !== null ? p.days[hover] : null;

  return (
    <div ref={box}>
      <svg className="chart" viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" aria-label={tp("overview.chartTitle", p.horizon)}
        onPointerMove={(e) => pick(e.clientX, e.currentTarget.getBoundingClientRect())}
        onPointerDown={(e) => pick(e.clientX, e.currentTarget.getBoundingClientRect())}>
        <clipPath id="pf-above"><rect x="0" y="0" width={W} height={Math.max(0, zeroY)} /></clipPath>
        <clipPath id="pf-below"><rect x="0" y={zeroY} width={W} height={H} /></clipPath>
        <path className="area" d={area} clipPath="url(#pf-above)" />
        <path className="neg-area" d={area} clipPath="url(#pf-below)" />
        <line className="zero" x1={padL} x2={W - padR} y1={zeroY} y2={zeroY} />
        <path className="line" d={d} />
        <circle className="dot" cx={x(lowIdx)} cy={y(vals[lowIdx]!)} r="4" />
        {ticks.map((i) => (
          <text key={i} x={x(i)} y={H - 6} textAnchor={i === 0 ? "start" : i === n - 1 ? "end" : "middle"}>
            {f.date(p.days[i]!.date, { day: "numeric", month: "short" })}
          </text>
        ))}
        {hover !== null && <line className="hover-line" x1={x(hover)} x2={x(hover)} y1={padT} y2={H - padB} />}
      </svg>
      <div className="chart-tip num">
        {day ? (
          <>
            <b>{f.date(day.date)}</b> · <span className={tone(day.balance)}>{f.money(day.balance)}</span> ·{" "}
            <span className={tone(day.net)}>{f.money(day.net, true)}</span>
          </>
        ) : t("overview.chartHint")}
      </div>
    </div>
  );
}
