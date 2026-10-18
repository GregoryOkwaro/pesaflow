"use client";
/**
 * Shows the exact price Paddle will charge this visitor (their currency, incl. tax)
 * once Paddle.js answers; until then (and in mock mode) it shows the fallback:
 * the USD list price with an approximate local amount.
 */
import { useEffect, useState, type ReactNode } from "react";
import { loadPaddle } from "./app/paddle";

const cache = new Map<string, string>();

export function PaddlePrice({ priceId, country, token, env, fallback }: {
  priceId: string | null; country: string; token: string | null; env: string; fallback: ReactNode;
}) {
  const key = `${priceId}|${country}`;
  const [exact, setExact] = useState<string | null>(cache.get(key) ?? null);
  useEffect(() => {
    if (!priceId || !token || env === "mock" || cache.has(key)) return;
    let alive = true;
    loadPaddle(token, env)
      .then((P) => P.PricePreview?.({ items: [{ priceId, quantity: 1 }], address: { countryCode: country } }))
      .then((res) => {
        const total = res?.data?.details?.lineItems?.[0]?.formattedTotals?.total;
        if (total && alive) { cache.set(key, total); setExact(total); }
      })
      .catch(() => { /* keep the fallback */ });
    return () => { alive = false; };
  }, [priceId, country, token, env, key]);
  return <>{exact ?? fallback}</>;
}
