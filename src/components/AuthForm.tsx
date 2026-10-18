"use client";

import Link from "next/link";
import Script from "next/script";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { api } from "@/lib/api";

type Mode = "signup" | "login" | "reset";

export function AuthForm({ mode, turnstileSiteKey }: { mode: Mode; turnstileSiteKey?: string }) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [resetEmail, setResetEmail] = useState("");
  const [sentMessage, setSentMessage] = useState("");

  const turnstileToken = (form: HTMLFormElement) =>
    (form.querySelector('input[name="cf-turnstile-response"]') as HTMLInputElement | null)?.value || undefined;

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = Object.fromEntries(new FormData(form)) as Record<string, string>;
    setBusy(true);
    setError("");
    try {
      if (mode === "signup") {
        await api("POST", "/api/auth/signup", { name: f.name, email: f.email, phone: f.phone, password: f.password, turnstileToken: turnstileToken(form) });
        router.replace("/app");
      } else if (mode === "login") {
        await api("POST", "/api/auth/login", { email: f.email, password: f.password });
        router.replace("/app");
      } else if (!sentMessage) {
        const res = await api<{ message: string }>("POST", "/api/auth/reset/request", { email: f.email, turnstileToken: turnstileToken(form) });
        setResetEmail(f.email!.trim());
        setSentMessage(res.message);
        setBusy(false);
      } else {
        await api("POST", "/api/auth/reset/confirm", { email: resetEmail, code: f.code, newPassword: f.newPassword });
        router.replace("/app?reset=1");
      }
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  const title = mode === "signup" ? "Know today if you'll run short next week." : mode === "login" ? "Welcome back" : "Reset your password";
  const lead = mode === "signup"
    ? "A day-by-day cash flow budget for M-Pesa and bank accounts."
    : mode === "login" ? "Log in to see your cash flow."
    : sentMessage || "Enter your account email and we'll send you a 6-digit code.";

  return (
    <div className="auth"><div className="auth-card">
      <Link href="/" className="brand no-underline text-inherit"><img src="/icon.svg" alt="" /> PesaFlow</Link>
      <h1>{title}</h1>
      <p className="lead">{lead}</p>
      <div className="card">
        {mode !== "reset" && (
          <div className="tabs" role="tablist">
            <Link href="/signup" className={`tab ${mode === "signup" ? "on" : ""}`}>Create account</Link>
            <Link href="/login" className={`tab ${mode === "login" ? "on" : ""}`}>Log in</Link>
          </div>
        )}
        <form onSubmit={submit} noValidate key={sentMessage ? "step2" : "step1"}>
          {error && <div className="form-error" role="alert">{error}</div>}
          {mode === "signup" && (
            <>
              <label className="field"><span>Your name</span><input name="name" type="text" autoComplete="name" required /></label>
              <label className="field"><span>M-Pesa phone number</span><input name="phone" type="tel" inputMode="tel" placeholder="07XX XXX XXX" autoComplete="tel" /></label>
            </>
          )}
          <label className="field"><span>Email</span>
            <input name="email" type="email" autoComplete="email" required defaultValue={resetEmail} readOnly={!!sentMessage} autoFocus={mode !== "signup" && !sentMessage} />
          </label>
          {mode !== "reset" && (
            <label className="field"><span>Password</span>
              <input name="password" type="password" autoComplete={mode === "signup" ? "new-password" : "current-password"} minLength={8} required />
              {mode === "signup" && <div className="hint">At least 8 characters.</div>}
            </label>
          )}
          {mode === "reset" && sentMessage && (
            <>
              <label className="field"><span>6-digit code</span><input name="code" type="text" inputMode="numeric" autoComplete="one-time-code" maxLength={7} required autoFocus /></label>
              <label className="field"><span>New password</span><input name="newPassword" type="password" autoComplete="new-password" minLength={8} required />
                <div className="hint">At least 8 characters. You&apos;ll be logged out everywhere else.</div></label>
            </>
          )}
          {turnstileSiteKey && (mode === "signup" || (mode === "reset" && !sentMessage)) && (
            <>
              <Script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer />
              <div className="cf-turnstile mb-3" data-sitekey={turnstileSiteKey} />
            </>
          )}
          <button className="btn primary full" type="submit" disabled={busy}>
            {mode === "signup" ? "Start free trial" : mode === "login" ? "Log in" : sentMessage ? "Set new password" : "Send code"}
          </button>
          <p className="center small">
            {mode === "login" && <Link href="/reset">Forgot password?</Link>}
            {mode === "reset" && (
              <>
                {sentMessage && <><a href="#" onClick={(e) => { e.preventDefault(); setSentMessage(""); setError(""); }}>Send a new code</a> · </>}
                <Link href="/login">Back to log in</Link>
              </>
            )}
          </p>
        </form>
      </div>
      {mode === "signup" && (
        <ul className="perks">
          <li>Free trial: no payment needed to start</li>
          <li>Then pay monthly or yearly with M-Pesa</li>
          <li>See every day&apos;s balance for the next month</li>
        </ul>
      )}
    </div></div>
  );
}
