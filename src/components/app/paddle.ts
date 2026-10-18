"use client";
/** Lazy Paddle.js (v2) loader. Initialize may only run once per page, so the event handler is swappable. */

interface PaddleEvent { name?: string; data?: unknown }
interface PaddleJs {
  Environment: { set: (env: "sandbox") => void };
  Initialize: (opts: { token: string; eventCallback?: (e: PaddleEvent) => void }) => void;
  Checkout: { open: (opts: Record<string, unknown>) => void; close: () => void };
}
declare global { interface Window { Paddle?: PaddleJs } }

let ready: Promise<PaddleJs> | null = null;
let onEvent: ((e: PaddleEvent) => void) | null = null;

export function setPaddleEventHandler(fn: ((e: PaddleEvent) => void) | null) {
  onEvent = fn;
}

export function loadPaddle(token: string, env: string): Promise<PaddleJs> {
  ready ??= new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://cdn.paddle.com/paddle/v2/paddle.js";
    script.async = true;
    script.onload = () => {
      const P = window.Paddle;
      if (!P) return reject(new Error("Paddle.js failed to load"));
      if (env === "sandbox") P.Environment.set("sandbox");
      P.Initialize({ token, eventCallback: (e) => onEvent?.(e) });
      resolve(P);
    };
    script.onerror = () => { ready = null; reject(new Error("Paddle.js failed to load")); };
    document.head.appendChild(script);
  });
  return ready;
}

/** Paddle checkout languages; anything else (e.g. Swahili) falls back to English. */
export const paddleLocale = (l: string) => (["en", "fr", "de", "es", "pt", "it", "nl", "pl", "ja", "ko", "zh-Hans", "ru", "tr", "sv", "da", "no"].includes(l) ? l : "en");
