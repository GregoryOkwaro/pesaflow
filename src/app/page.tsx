import Link from "next/link";
import { planList } from "@/server/env";

export const dynamic = "force-dynamic";

const features = [
  ["Every day, mapped", "See your balance for each of the next 31 days across M-Pesa, bank and cash."],
  ["Warned before you're short", "Know the exact day your money runs out, while there's still time to act."],
  ["Bills that wait for pay day", "Tie rent or school fees to your salary so they land when the money does."],
  ["Pay with M-Pesa", "No card needed. Renew monthly or yearly with an M-Pesa prompt on your phone."],
];

export default function Landing() {
  const plans = planList();
  return (
    <div className="min-h-screen">
      <header className="mx-auto flex max-w-5xl items-center gap-3 px-4 py-4">
        <div className="brand"><img src="/icon.svg" alt="" /> PesaFlow</div>
        <div className="flex-1" />
        <Link className="btn ghost" href="/login">Log in</Link>
        <Link className="btn primary" href="/signup">Start free</Link>
      </header>

      <main className="mx-auto max-w-5xl px-4 pb-20">
        <section className="py-12 md:py-20">
          <h1 className="max-w-2xl text-4xl font-extrabold leading-tight md:text-5xl">Know today if you&apos;ll run short next week.</h1>
          <p className="muted mt-4 max-w-xl text-lg">
            PesaFlow is a day-by-day cash flow budget built for Kenya. Add your income and bills once and see every
            day&apos;s balance for the month ahead.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link className="btn primary" href="/signup">Start your free trial</Link>
            <a className="btn" href="#pricing">See pricing</a>
          </div>
          <p className="muted small mt-3">14 days free. No card, no M-Pesa needed to start.</p>
        </section>

        <section className="grid gap-4 md:grid-cols-2">
          {features.map(([title, text]) => (
            <div key={title} className="card">
              <h2>{title}</h2>
              <p className="muted m-0">{text}</p>
            </div>
          ))}
        </section>

        <section id="pricing" className="py-16">
          <h2 className="mb-6 text-2xl font-extrabold">Simple pricing, paid with M-Pesa</h2>
          <div className="grid gap-4 md:grid-cols-3">
            {plans.map((p) => (
              <div key={p.key} className={`card ${p.key === "yearly" ? "ring-2 ring-[var(--brand)]" : ""}`}>
                <div className="small muted font-bold uppercase">{p.label}{p.key === "yearly" ? " · best value" : ""}</div>
                <div className="num mt-2 text-3xl font-extrabold">KES {p.amount.toLocaleString("en-KE")}</div>
                <div className="muted small">{p.days} days of access</div>
                <Link className="btn primary full mt-4" href="/signup">Start free trial</Link>
              </div>
            ))}
          </div>
        </section>
      </main>

      <footer className="muted small mx-auto max-w-5xl px-4 pb-10">
        © {new Date().getFullYear()} PesaFlow · Your data stays yours: read-only, never deleted, if your plan lapses.
      </footer>
    </div>
  );
}
