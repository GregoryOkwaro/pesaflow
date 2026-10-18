/* PesaFlow frontend — vanilla JS single-page app talking to the JSON API. */
(() => {
  "use strict";

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const app = $("#app");
  const modalRoot = $("#modal-root");

  const state = {
    me: null,
    plans: [],
    appName: "PesaFlow",
    mpesaEnv: "mock",
    budgets: [],
    budgetId: null,
    data: null,          // { budget, accounts, items, projection }
    tab: "dashboard",
    itemFilter: "",
    showDone: true,
    openDay: null,
  };

  // ------------------------------------------------------------------ utils
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const nf = new Intl.NumberFormat("en-KE", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  const kes = (v, sign = false) => {
    const n = Number(v) || 0;
    const s = nf.format(Math.abs(n));
    return (n < 0 ? "−" : sign && n > 0 ? "+" : "") + "KES " + s;
  };
  const cls = (v) => (v < 0 ? "neg" : v > 0 ? "pos" : "");
  const parseDate = (iso) => { const [y, m, d] = iso.split("-").map(Number); return new Date(y, m - 1, d); };
  const fmtDate = (iso, opts = { weekday: "short", day: "numeric", month: "short" }) =>
    iso ? parseDate(iso).toLocaleDateString("en-GB", opts) : "";
  const fmtDay = (iso) => fmtDate(iso, { weekday: "short" });
  const isWeekend = (iso) => [0, 6].includes(parseDate(iso).getDay());
  const LS_BUDGET = "pf.budget";
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
  };

  let toastTimer;
  function toast(msg) {
    const t = $("#toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove("show"), 2600);
  }

  class ApiError extends Error {
    constructor(status, body) { super(body.error || "Request failed"); this.status = status; this.body = body; }
  }

  async function api(method, path, body) {
    const opts = { method, credentials: "same-origin", headers: { "X-Requested-With": "fetch" } };
    if (body !== undefined) { opts.headers["Content-Type"] = "application/json"; opts.body = JSON.stringify(body); }
    let res;
    try { res = await fetch(path, opts); } catch { throw new ApiError(0, { error: "You appear to be offline. Check your connection." }); }
    const data = res.headers.get("content-type")?.includes("json") ? await res.json() : {};
    if (!res.ok) {
      if (res.status === 401 && !path.startsWith("/api/auth/")) { state.me = null; renderAuth(); }
      if (res.status === 402) { openBilling(data.error); }
      throw new ApiError(res.status, data);
    }
    return data;
  }

  // Wrap a mutating call: show errors as a toast, refresh budget data on success.
  async function mutate(method, path, body, okMsg) {
    try {
      const data = await api(method, path, body);
      if (data.projection) { state.data = data; renderMain(); }
      if (okMsg) toast(okMsg);
      return data;
    } catch (e) {
      if (e.status !== 402 && e.status !== 401) toast(e.message);
      throw e;
    }
  }

  // ------------------------------------------------------------------ boot
  async function boot() {
    try {
      const me = await api("GET", "/api/me");
      applyMe(me);
      await loadBudgets();
      renderShell();
    } catch (e) {
      if (e.status === 401) renderAuth(); else app.innerHTML = `<div class="boot">${esc(e.message)}</div>`;
    }
  }

  function applyMe(me) {
    state.me = me.user;
    state.plans = me.plans || state.plans;
    state.appName = me.app_name || state.appName;
    state.mpesaEnv = me.mpesa_env || state.mpesaEnv;
    document.title = `${state.appName} — Cash Flow Budget`;
  }

  async function loadBudgets(selectId) {
    const { budgets } = await api("GET", "/api/budgets");
    state.budgets = budgets;
    const saved = Number(selectId || state.budgetId || store.get(LS_BUDGET));
    state.budgetId = budgets.some((b) => b.id === saved) ? saved : budgets[0]?.id;
    if (state.budgetId) await loadBudget(state.budgetId);
  }

  async function loadBudget(id) {
    state.data = await api("GET", `/api/budgets/${id}`);
    state.budgetId = id;
    state.openDay = null;
    store.set(LS_BUDGET, String(id));
  }

  // ------------------------------------------------------------------ auth screen
  function renderAuth(mode = "signup") {
    closeModal();
    app.innerHTML = `
      <div class="auth"><div class="auth-card">
        <div class="brand"><img src="/static/icon.svg" alt=""> ${esc(state.appName)}</div>
        <h1>Know today if you'll run short next week.</h1>
        <p class="lead">A day-by-day cash flow budget for M-Pesa and bank accounts.</p>
        <div class="card">
          <div class="tabs" role="tablist">
            <button type="button" data-mode="signup" class="${mode === "signup" ? "on" : ""}">Create account</button>
            <button type="button" data-mode="login" class="${mode === "login" ? "on" : ""}">Log in</button>
          </div>
          <form id="auth-form" novalidate>
            <div class="form-error hidden" id="auth-error"></div>
            ${mode === "signup" ? `
              <label class="field"><span>Your name</span><input name="name" type="text" autocomplete="name" required></label>
              <label class="field"><span>M-Pesa phone number</span><input name="phone" type="tel" inputmode="tel" placeholder="07XX XXX XXX" autocomplete="tel"></label>` : ""}
            <label class="field"><span>Email</span><input name="email" type="email" autocomplete="email" required></label>
            <label class="field"><span>Password</span><input name="password" type="password" autocomplete="${mode === "signup" ? "new-password" : "current-password"}" minlength="8" required>
              ${mode === "signup" ? `<div class="hint">At least 8 characters.</div>` : ""}</label>
            <button class="btn primary block" type="submit">${mode === "signup" ? "Start free trial" : "Log in"}</button>
            ${mode === "login" ? `<p class="center small"><a href="#" id="forgot-link">Forgot password?</a></p>` : ""}
          </form>
        </div>
        ${mode === "signup" ? `<ul class="perks">
          <li>Free trial — no payment needed to start</li>
          <li>Then pay monthly or yearly with M-Pesa</li>
          <li>See every day's balance for the next month</li></ul>` : ""}
      </div></div>`;
    $$(".tabs button", app).forEach((b) => b.addEventListener("click", () => renderAuth(b.dataset.mode)));
    $("#forgot-link")?.addEventListener("click", (e) => { e.preventDefault(); renderReset($("#auth-form").email.value); });
    $("#auth-form").addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const f = ev.target;
      const body = Object.fromEntries(new FormData(f));
      const btn = $("button[type=submit]", f);
      btn.disabled = true;
      try {
        await api("POST", mode === "signup" ? "/api/auth/signup" : "/api/auth/login", body);
        await boot();
      } catch (e) {
        const box = $("#auth-error");
        box.textContent = e.message;
        box.classList.remove("hidden");
        btn.disabled = false;
      }
    });
  }

  // Two steps: ask for a code by email, then enter code + new password (which also logs in).
  function renderReset(email = "", sentMessage = "") {
    const step2 = Boolean(sentMessage);
    app.innerHTML = `
      <div class="auth"><div class="auth-card">
        <div class="brand"><img src="/static/icon.svg" alt=""> ${esc(state.appName)}</div>
        <h1>Reset your password</h1>
        <p class="lead">${step2 ? esc(sentMessage) : "Enter your account email and we'll send you a 6-digit code."}</p>
        <div class="card">
          <form id="reset-form" novalidate>
            <div class="form-error hidden" id="auth-error"></div>
            <label class="field"><span>Email</span><input name="email" type="email" autocomplete="email" value="${esc(email)}" ${step2 ? "readonly" : ""} required></label>
            ${step2 ? `
              <label class="field"><span>6-digit code</span><input name="code" type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="7" required></label>
              <label class="field"><span>New password</span><input name="new_password" type="password" autocomplete="new-password" minlength="8" required>
                <div class="hint">At least 8 characters. You'll be logged out everywhere else.</div></label>` : ""}
            <button class="btn primary block" type="submit">${step2 ? "Set new password" : "Send code"}</button>
            <p class="center small">${step2 ? `<a href="#" id="resend-link">Send a new code</a> · ` : ""}<a href="#" id="back-link">Back to log in</a></p>
          </form>
        </div>
      </div></div>`;
    const f = $("#reset-form");
    $("#back-link").addEventListener("click", (e) => { e.preventDefault(); renderAuth("login"); });
    $("#resend-link")?.addEventListener("click", (e) => { e.preventDefault(); renderReset(email); });
    (step2 ? f.code : f.email).focus();
    f.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const btn = $("button[type=submit]", f);
      btn.disabled = true;
      try {
        if (!step2) {
          const res = await api("POST", "/api/auth/reset/request", { email: f.email.value });
          renderReset(f.email.value.trim(), res.message);
        } else {
          await api("POST", "/api/auth/reset/confirm", { email: f.email.value, code: f.code.value, new_password: f.new_password.value });
          toast("Password changed. You're logged in.");
          await boot();
        }
      } catch (e) {
        const box = $("#auth-error");
        box.textContent = e.message;
        box.classList.remove("hidden");
        btn.disabled = false;
      }
    });
  }

  // ------------------------------------------------------------------ shell
  function subBadge() {
    const s = state.me.subscription;
    if (!s.active) return `<button class="badge bad" data-act="billing">Expired · Renew</button>`;
    if (s.on_trial) return `<button class="badge ${s.days_left <= 3 ? "warn" : ""}" data-act="billing">Trial · ${s.days_left}d left</button>`;
    return `<button class="badge ${s.days_left <= 5 ? "warn" : ""}" data-act="billing">Active · ${s.days_left}d</button>`;
  }

  const TABS = [
    ["dashboard", "▦", "Overview"],
    ["items", "☰", "Items"],
    ["days", "▤", "Daily"],
    ["settings", "⚙", "Settings"],
  ];

  function renderShell() {
    app.innerHTML = `
      <header class="topbar">
        <div class="brand"><img src="/static/icon.svg" alt=""><span>${esc(state.appName)}</span></div>
        <select class="budget-select" id="budget-select" aria-label="Budget">
          ${state.budgets.map((b) => `<option value="${b.id}" ${b.id === state.budgetId ? "selected" : ""}>${esc(b.name)}</option>`).join("")}
        </select>
        <div class="spacer"></div>
        <span id="sub-badge">${subBadge()}</span>
      </header>
      <nav class="nav" aria-label="Sections">
        ${TABS.map(([k, ico, label]) => `<button type="button" data-tab="${k}" class="${state.tab === k ? "on" : ""}"><span class="ico" aria-hidden="true">${ico}</span>${label}</button>`).join("")}
      </nav>
      <main id="main"></main>`;
    $("#budget-select").addEventListener("change", async (e) => {
      await loadBudget(Number(e.target.value));
      renderMain();
    });
    $$(".nav button").forEach((b) => b.addEventListener("click", () => {
      state.tab = b.dataset.tab;
      $$(".nav button").forEach((x) => x.classList.toggle("on", x === b));
      renderMain();
      window.scrollTo({ top: 0 });
    }));

    renderMain();
  }

  function refreshBadge() { const el = $("#sub-badge"); if (el) el.innerHTML = subBadge(); }

  function onAction(e) {
    const el = e.target.closest("[data-act]");
    if (!el || !app.contains(el)) return;
    if (el.tagName === "A") e.preventDefault();
    const act = el.dataset.act;
    const id = Number(el.dataset.id) || null;
    if (act === "billing") openBilling();
    else if (act === "add-item") openItem();
    else if (act === "edit-item") openItem(state.data.items.find((i) => i.id === id));
    else if (act === "toggle-done") toggleDone(id);
    else if (act === "add-account") openAccount();
    else if (act === "edit-account") openAccount(state.data.accounts.find((a) => a.id === id));
    else if (act === "day") { state.openDay = state.openDay === el.dataset.date ? null : el.dataset.date; renderMain(); }
    else if (act === "goto") { state.tab = el.dataset.tab; renderShell(); }
  }

  function renderMain() {
    const main = $("#main");
    if (!main || !state.data) return;
    refreshBadge();
    const sel = $("#budget-select");
    if (sel) sel.innerHTML = state.budgets.map((b) => `<option value="${b.id}" ${b.id === state.budgetId ? "selected" : ""}>${esc(b.name)}</option>`).join("");
    ({ dashboard: renderDashboard, items: renderItems, days: renderDays, settings: renderSettings })[state.tab](main);
  }

  // ------------------------------------------------------------------ overview
  function trialBanner() {
    const s = state.me.subscription;
    if (!s.active) return `<div class="alert bad">Your subscription has ended — your budget is read-only. <button class="btn sm primary" data-act="billing">Renew with M-Pesa</button></div>`;
    if (s.on_trial && s.days_left <= 3) return `<div class="alert warn">Your free trial ends in ${s.days_left} day${s.days_left === 1 ? "" : "s"}. <button class="btn sm primary" data-act="billing">Subscribe</button></div>`;
    return "";
  }

  function renderDashboard(main) {
    const { projection: p, accounts } = state.data;
    const neg = p.first_negative_date;
    main.innerHTML = `
      ${trialBanner()}
      ${neg
        ? `<div class="alert bad">⚠ Your balance goes negative on ${fmtDate(neg)} and bottoms out at ${kes(p.lowest_balance)} on ${fmtDate(p.lowest_date)}.</div>`
        : `<div class="alert ok">✓ You stay above zero for the next ${p.horizon} days. Lowest point: ${kes(p.lowest_balance)} on ${fmtDate(p.lowest_date)}.</div>`}
      <div class="kpis">
        <div class="kpi"><div class="label">Cash today</div><div class="value num ${cls(p.opening_balance)}">${kes(p.opening_balance)}</div><div class="sub">${accounts.filter((a) => a.include_in_total).length} account(s)</div></div>
        <div class="kpi"><div class="label">Budget surplus / deficit</div><div class="value num ${cls(p.net_flow)}">${kes(p.net_flow, true)}</div><div class="sub">In ${kes(p.total_in)} · Out ${kes(Math.abs(p.total_out))}</div></div>
        <div class="kpi"><div class="label">Bottom line</div><div class="value num ${cls(p.closing_balance)}">${kes(p.closing_balance)}</div><div class="sub">on ${fmtDate(p.days.at(-1).date)}</div></div>
        <div class="kpi"><div class="label">Lowest balance</div><div class="value num ${cls(p.lowest_balance)}">${kes(p.lowest_balance)}</div><div class="sub">on ${fmtDate(p.lowest_date)}</div></div>
      </div>
      <div class="grid-2">
        <section class="card">
          <h2>Balance, next ${p.horizon} days</h2>
          <div id="chart-box"></div>
          <div class="chart-tip num" id="chart-tip">Tap or hover the chart to see a day.</div>
        </section>
        <section class="card">
          <h2>Accounts <button class="btn sm" data-act="add-account">+ Add</button></h2>
          <ul class="list">
            ${accounts.map((a) => `
              <li class="clickable" data-act="edit-account" data-id="${a.id}">
                <div class="grow"><div class="title">${esc(a.name)}</div>
                  <div class="meta">${a.include_in_total ? "Counted in cash today" : "Not counted (e.g. savings)"}${a.details ? " · " + esc(a.details) : ""}</div></div>
                <div class="num ${cls(a.balance)}">${kes(a.balance)}</div>
              </li>`).join("") || `<li class="muted">No accounts yet.</li>`}
          </ul>
          <div class="total-row"><span>Cash today</span><span class="num ${cls(p.opening_balance)}">${kes(p.opening_balance)}</span></div>
        </section>
      </div>
      <section class="card">
        <h2>Coming up <button class="btn sm" data-act="goto" data-tab="days">See all days</button></h2>
        ${upcoming(p)}
      </section>`;
    drawChart($("#chart-box"), p);
  }

  function upcoming(p) {
    const names = Object.fromEntries(state.data.items.map((i) => [String(i.id), i.name]));
    const rows = [];
    for (const d of p.days) {
      for (const [id, amt] of Object.entries(d.flows)) if (amt) rows.push({ date: d.date, id, amt });
      if (rows.length >= 8) break;
    }
    if (!rows.length) return `<div class="empty">Nothing scheduled. <a href="#" data-act="add-item">Add an item</a>.</div>`;
    return `<ul class="list">${rows.slice(0, 8).map((r) => `
      <li class="clickable" data-act="edit-item" data-id="${r.id}"><div class="grow"><div class="title">${esc(names[r.id])}</div>
      <div class="meta">${fmtDate(r.date)}${r.date === p.today ? " · today" : ""}</div></div>
      <div class="num ${cls(r.amt)}">${kes(r.amt, true)}</div></li>`).join("")}</ul>`;
  }

  function drawChart(box, p) {
    const W = Math.max(280, box.clientWidth || 600), H = 220, padL = 8, padR = 8, padT = 14, padB = 24;
    const vals = p.days.map((d) => d.balance);
    let min = Math.min(0, ...vals), max = Math.max(0, ...vals);
    if (min === max) { max += 1; min -= 1; }
    const span = max - min;
    min -= span * 0.08; max += span * 0.08;
    const n = vals.length;
    const x = (i) => padL + (n === 1 ? 0 : (i * (W - padL - padR)) / (n - 1));
    const y = (v) => padT + ((max - v) * (H - padT - padB)) / (max - min);
    const pts = vals.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`);
    // Step line: balance holds all day, so draw horizontal then vertical.
    let d = `M${pts[0]}`;
    for (let i = 1; i < n; i++) d += ` L${x(i).toFixed(1)},${y(vals[i - 1]).toFixed(1)} L${pts[i]}`;
    const zeroY = y(0).toFixed(1);
    const area = `${d} L${x(n - 1).toFixed(1)},${zeroY} L${x(0).toFixed(1)},${zeroY} Z`;
    const lowIdx = vals.indexOf(Math.min(...vals));
    const ticks = [0, Math.floor((n - 1) / 2), n - 1].filter((v, i, a) => a.indexOf(v) === i);
    box.innerHTML = `
      <svg class="chart" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Projected balance chart">
        <clipPath id="above"><rect x="0" y="0" width="${W}" height="${zeroY}"/></clipPath>
        <clipPath id="below"><rect x="0" y="${zeroY}" width="${W}" height="${H}"/></clipPath>
        <path class="area" d="${area}" clip-path="url(#above)"/>
        <path class="neg-area" d="${area}" clip-path="url(#below)"/>
        <line class="zero" x1="${padL}" x2="${W - padR}" y1="${zeroY}" y2="${zeroY}"/>
        <path class="line" d="${d}"/>
        <circle class="dot" cx="${x(lowIdx)}" cy="${y(vals[lowIdx])}" r="4"/>
        ${ticks.map((i) => `<text x="${x(i)}" y="${H - 6}" text-anchor="${i === 0 ? "start" : i === n - 1 ? "end" : "middle"}">${fmtDate(p.days[i].date, { day: "numeric", month: "short" })}</text>`).join("")}
        <line class="hover-line hidden" id="hover-line" y1="${padT}" y2="${H - padB}"/>
      </svg>`;
    const svg = $("svg", box), tip = $("#chart-tip"), hl = $("#hover-line", box);
    const show = (clientX) => {
      const r = svg.getBoundingClientRect();
      const rel = ((clientX - r.left) / r.width) * W;
      const i = Math.max(0, Math.min(n - 1, Math.round(((rel - padL) / (W - padL - padR)) * (n - 1))));
      const day = p.days[i];
      hl.setAttribute("x1", x(i)); hl.setAttribute("x2", x(i)); hl.classList.remove("hidden");
      tip.innerHTML = `<b>${fmtDate(day.date)}</b> · balance <span class="${cls(day.balance)}">${kes(day.balance)}</span> · net <span class="${cls(day.net)}">${kes(day.net, true)}</span>`;
    };
    svg.addEventListener("pointermove", (e) => show(e.clientX));
    svg.addEventListener("pointerdown", (e) => show(e.clientX));
  }

  let resizeTimer;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { if (state.tab === "dashboard" && $("#chart-box")) drawChart($("#chart-box"), state.data.projection); }, 150);
  });

  // ------------------------------------------------------------------ items
  function schedule(item) {
    const eff = state.data.projection.effective_dates[String(item.id)];
    const parts = [];
    if (item.every_days > 0) parts.push(`Every ${item.every_days === 1 ? "day" : item.every_days + " days"}`);
    else parts.push("Once");
    if (eff) parts.push(`${item.every_days > 0 ? "from" : "on"} ${fmtDate(eff)}`);
    if (item.end_date) parts.push(`until ${fmtDate(item.end_date)}`);
    return parts.join(" ");
  }

  function renderItems(main) {
    const { items, accounts } = state.data;
    const q = state.itemFilter.trim().toLowerCase();
    const shown = items.filter((i) => (state.showDone || !i.done) && (!q || i.name.toLowerCase().includes(q) || i.note.toLowerCase().includes(q)));
    const acct = Object.fromEntries(accounts.map((a) => [a.id, a.name]));
    const names = Object.fromEntries(items.map((i) => [i.id, i.name]));
    const totIn = items.filter((i) => !i.done && i.amount > 0).reduce((s, i) => s + i.amount, 0);
    const totOut = items.filter((i) => !i.done && i.amount < 0).reduce((s, i) => s + i.amount, 0);
    main.innerHTML = `
      ${trialBanner()}
      <div class="toolbar">
        <input type="search" id="item-search" placeholder="Search items…" value="${esc(state.itemFilter)}" aria-label="Search items">
        <label class="check small"><input type="checkbox" id="show-done" ${state.showDone ? "checked" : ""}> Show paid</label>
        <button class="btn primary" data-act="add-item">+ Add item</button>
      </div>
      <p class="small muted">Pending per occurrence: in <b class="pos">${kes(totIn)}</b> · out <b class="neg">${kes(Math.abs(totOut))}</b>. Tick an item when it's paid — it stops counting.</p>
      <div id="item-list">
        ${shown.map((i) => `
          <div class="item ${i.done ? "done" : ""}">
            <button class="tick" data-act="toggle-done" data-id="${i.id}" aria-label="${i.done ? "Mark as not paid" : "Mark as paid"}" title="${i.done ? "Paid — tap to undo" : "Mark as paid"}">✓</button>
            <div class="body" data-act="edit-item" data-id="${i.id}">
              <div class="title">${esc(i.name)}</div>
              <div class="meta"><span>${esc(schedule(i))}</span>
                ${i.account_id && acct[i.account_id] ? `<span class="chip">${esc(acct[i.account_id])}</span>` : ""}
                ${i.tie_to && names[i.tie_to] ? `<span class="chip tie">waits for ${esc(names[i.tie_to])}</span>` : ""}
                ${i.note ? `<span>${esc(i.note)}</span>` : ""}</div>
            </div>
            <div class="amt num ${cls(i.amount)}">${kes(i.amount, true)}</div>
          </div>`).join("") || `<div class="empty">${items.length ? "No items match." : "No items yet. Add your income and bills to see your cash flow."}</div>`}
      </div>`;
    const search = $("#item-search");
    search.addEventListener("input", () => { state.itemFilter = search.value; renderItems(main); const s = $("#item-search"); s.focus(); s.setSelectionRange(s.value.length, s.value.length); });
    $("#show-done").addEventListener("change", (e) => { state.showDone = e.target.checked; renderItems(main); });
  }

  async function toggleDone(id) {
    const item = state.data.items.find((i) => i.id === id);
    if (!item) return;
    await mutate("PUT", `/api/items/${id}`, { done: !item.done }, item.done ? "Marked as not paid" : "Marked as paid").catch(() => {});
  }

  // ------------------------------------------------------------------ daily grid
  function renderDays(main) {
    const { projection: p, items } = state.data;
    const wide = window.matchMedia("(min-width: 900px)").matches;
    const cols = items.filter((i) => p.days.some((d) => d.flows[String(i.id)]));
    const names = Object.fromEntries(items.map((i) => [String(i.id), i.name]));
    const head = `<tr><th class="l sticky">Date</th>${wide ? cols.map((i) => `<th class="item-col" title="${esc(i.name)}">${esc(i.name)}</th>`).join("") : ""}<th>Day's net flow</th><th>Balance</th></tr>`;
    const rows = p.days.map((d) => {
      const r = `<tr class="clickable ${d.date === p.today ? "today" : ""} ${isWeekend(d.date) ? "weekend" : ""} ${d.balance < 0 ? "negative" : ""}" data-act="day" data-date="${d.date}">
        <td class="l sticky">${fmtDate(d.date)}</td>
        ${wide ? cols.map((i) => { const v = d.flows[String(i.id)]; return `<td class="num ${v ? cls(v) : "muted"}">${v ? nf.format(v) : ""}</td>`; }).join("") : ""}
        <td class="num net ${cls(d.net)}">${d.net ? kes(d.net, true) : "—"}</td>
        <td class="num bal">${kes(d.balance)}</td></tr>`;
      if (state.openDay !== d.date) return r;
      const flows = Object.entries(d.flows).filter(([, v]) => v);
      return r + `<tr class="detail"><td colspan="${(wide ? cols.length : 0) + 3}">
        ${flows.length ? flows.map(([id, v]) => `<div class="flow-line"><span>${esc(names[id])}</span><span class="num ${cls(v)}">${kes(v, true)}</span></div>`).join("") : `<span class="muted">No money moves this day.</span>`}
      </td></tr>`;
    }).join("");
    main.innerHTML = `
      <div class="toolbar">
        <div class="small muted">Opening cash <b class="num ${cls(p.opening_balance)}">${kes(p.opening_balance)}</b> · tap a day for details</div>
        <div class="spacer"></div>
        <a class="btn sm" href="/api/budgets/${state.budgetId}/export.csv">⬇ Export CSV</a>
        <button class="btn sm" id="print-btn">Print</button>
      </div>
      <div class="table-wrap"><table class="grid"><thead>${head}</thead><tbody>${rows}</tbody>
        <tfoot><tr><td class="l sticky"><b>Total</b></td>${wide ? cols.map((i) => { const s = p.days.reduce((a, d) => a + (d.flows[String(i.id)] || 0), 0); return `<td class="num ${cls(s)}"><b>${nf.format(s)}</b></td>`; }).join("") : ""}
        <td class="num ${cls(p.net_flow)}"><b>${kes(p.net_flow, true)}</b></td><td class="num ${cls(p.closing_balance)}"><b>${kes(p.closing_balance)}</b></td></tr></tfoot>
      </table></div>`;
    $("#print-btn").addEventListener("click", () => window.print());
  }

  // ------------------------------------------------------------------ settings
  function renderSettings(main) {
    const { budget } = state.data;
    const me = state.me;
    main.innerHTML = `
      <section class="card">
        <h2>This budget</h2>
        <form id="budget-form">
          <label class="field"><span>Name</span><input name="name" type="text" value="${esc(budget.name)}" required maxlength="80"></label>
          <label class="field"><span>Days to project</span><input name="horizon_days" type="number" min="7" max="120" value="${budget.horizon_days}">
            <div class="hint">The original spreadsheet looks 31 days ahead.</div></label>
          <button class="btn primary" type="submit">Save</button>
        </form>
      </section>
      <section class="card">
        <h2>Budgets</h2>
        <p class="small muted">Start next month's budget as a copy of this one, or a blank one.</p>
        <div class="toolbar">
          <button class="btn" id="copy-budget">Copy this budget</button>
          <button class="btn" id="new-budget">New blank budget</button>
          <div class="spacer"></div>
          <button class="btn danger" id="delete-budget" ${state.budgets.length <= 1 ? "disabled" : ""}>Delete this budget</button>
        </div>
      </section>
      <section class="card">
        <h2>Subscription</h2>
        <p>${me.subscription.active ? `Access until <b>${fmtDate(me.subscription.access_until, { day: "numeric", month: "long", year: "numeric" })}</b>${me.subscription.on_trial ? " (free trial)" : ""}.` : `<span class="neg">Expired.</span> Your data is safe but read-only.`}</p>
        <div class="toolbar"><button class="btn primary" data-act="billing">Pay with M-Pesa</button><button class="btn" id="history-btn">Payment history</button></div>
        <div id="history"></div>
      </section>
      <section class="card">
        <h2>Your profile</h2>
        <form id="profile-form">
          <div class="row2">
            <label class="field"><span>Name</span><input name="name" type="text" value="${esc(me.name)}" required></label>
            <label class="field"><span>M-Pesa number</span><input name="phone" type="tel" value="${esc(me.phone ? "0" + me.phone.slice(3) : "")}" placeholder="07XX XXX XXX"></label>
          </div>
          <p class="small muted">Signed in as ${esc(me.email)}</p>
          <button class="btn" type="submit">Save profile</button>
        </form>
      </section>
      <section class="card">
        <h2>Change password</h2>
        <form id="pw-form">
          <div class="row2">
            <label class="field"><span>Current password</span><input name="current" type="password" autocomplete="current-password" required></label>
            <label class="field"><span>New password</span><input name="new" type="password" autocomplete="new-password" minlength="8" required></label>
          </div>
          <button class="btn" type="submit">Change password</button>
        </form>
      </section>
      <div class="toolbar"><div class="spacer"></div><button class="btn danger" id="logout">Log out</button></div>`;

    $("#budget-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const body = Object.fromEntries(new FormData(e.target));
      await mutate("PUT", `/api/budgets/${state.budgetId}`, body, "Budget saved").then(() => loadBudgets(state.budgetId)).then(renderMain).catch(() => {});
    });
    $("#copy-budget").addEventListener("click", () => newBudget(true));
    $("#new-budget").addEventListener("click", () => newBudget(false));
    $("#delete-budget").addEventListener("click", () => confirmModal(`Delete “${budget.name}” and all its items? This can't be undone.`, "Delete", async () => {
      await mutate("DELETE", `/api/budgets/${state.budgetId}`, undefined, "Budget deleted");
      state.budgetId = null;
      await loadBudgets();
      renderShell();
    }));
    $("#history-btn").addEventListener("click", async () => {
      const { payments } = await api("GET", "/api/billing/payments");
      $("#history").innerHTML = payments.length ? `<ul class="list">${payments.map((p) => `
        <li><div class="grow"><div class="title">${esc(planLabel(p.plan))} · KES ${nf.format(p.amount)}</div>
        <div class="meta">${esc(p.created_at.slice(0, 16).replace("T", " "))} · ${esc(p.phone)}${p.receipt ? " · " + esc(p.receipt) : ""}${p.status === "failed" && p.result_desc ? " · " + esc(p.result_desc) : ""}</div></div>
        <span class="chip ${p.status === "success" ? "" : "tie"}">${esc(p.status)}</span></li>`).join("")}</ul>` : `<p class="muted small">No payments yet.</p>`;
    });
    $("#profile-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      try { const { user } = await api("PUT", "/api/me", Object.fromEntries(new FormData(e.target))); state.me = user; toast("Profile saved"); } catch (err) { toast(err.message); }
    });
    $("#pw-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      try { await api("POST", "/api/me/password", Object.fromEntries(new FormData(e.target))); e.target.reset(); toast("Password changed"); } catch (err) { toast(err.message); }
    });
    $("#logout").addEventListener("click", async () => { await api("POST", "/api/auth/logout").catch(() => {}); state.me = null; renderAuth("login"); });
  }

  function newBudget(copy) {
    const nextMonth = new Date(); nextMonth.setMonth(nextMonth.getMonth() + 1);
    const suggested = copy ? `${state.data.budget.name} (copy)` : nextMonth.toLocaleDateString("en-GB", { month: "long", year: "numeric" });
    openModal(`
      <h3>${copy ? "Copy budget" : "New budget"} <button class="close" data-close aria-label="Close">×</button></h3>
      <form id="nb-form"><label class="field"><span>Name</span><input name="name" type="text" value="${esc(suggested)}" required maxlength="80"></label>
      <div class="actions"><button class="btn primary" type="submit">Create</button><button class="btn" type="button" data-close>Cancel</button></div></form>`);
    $("#nb-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const body = { name: new FormData(e.target).get("name") };
      if (copy) body.copy_from = state.budgetId;
      try {
        const data = await api("POST", "/api/budgets", body);
        closeModal();
        await loadBudgets(data.budget.id);
        state.tab = "items";
        renderShell();
        toast("Budget created");
      } catch (err) { if (err.status !== 402) toast(err.message); }
    });
  }

  // ------------------------------------------------------------------ modals
  function openModal(html, onClose) {
    modalRoot.innerHTML = `<div class="overlay"><div class="modal" role="dialog" aria-modal="true">${html}</div></div>`;
    const overlay = $(".overlay", modalRoot);
    const close = () => { closeModal(); onClose?.(); };
    overlay.addEventListener("click", (e) => { if (e.target === overlay || e.target.closest("[data-close]")) close(); });
    document.addEventListener("keydown", escClose);
    const first = $("input:not([type=hidden]), select, textarea, button.primary", overlay);
    first?.focus();
  }
  function escClose(e) { if (e.key === "Escape") closeModal(); }
  function closeModal() {
    modalRoot.innerHTML = "";
    document.removeEventListener("keydown", escClose);
    clearInterval(pollTimer);
  }

  function confirmModal(message, okLabel, onOk) {
    openModal(`<h3>Are you sure?</h3><p>${esc(message)}</p>
      <div class="actions"><button class="btn primary" id="confirm-ok">${esc(okLabel)}</button><button class="btn" data-close>Cancel</button></div>`);
    $("#confirm-ok").addEventListener("click", async () => { closeModal(); try { await onOk(); } catch { /* toast shown */ } });
  }

  function formError(form, msg) {
    let box = $(".form-error", form);
    if (!box) { box = document.createElement("div"); box.className = "form-error"; form.prepend(box); }
    box.textContent = msg;
    box.scrollIntoView({ block: "nearest" });
  }

  const PRESETS = [["0", "Once"], ["1", "Daily"], ["7", "Weekly"], ["14", "Every 2 weeks"], ["30", "Monthly (30 days)"]];

  function openItem(item) {
    const isNew = !item;
    const today = state.data.projection.today;
    const it = item || { name: "", amount: 0, every_days: 0, value_date: today, end_date: null, tie_to: null, done: false, account_id: state.data.accounts[0]?.id ?? null, note: "" };
    let dir = it.amount > 0 ? "in" : "out";
    const others = state.data.items.filter((i) => i.id !== it.id);
    openModal(`
      <h3>${isNew ? "Add item" : "Edit item"} <button class="close" data-close aria-label="Close">×</button></h3>
      <form id="item-form" novalidate>
        <label class="field"><span>What is it?</span><input name="name" type="text" value="${esc(it.name)}" placeholder="e.g. Rent, Salary, School fees" required maxlength="120"></label>
        <div class="field"><span class="small muted"><b>Money</b></span>
          <div class="toolbar">
            <div class="seg" role="group" aria-label="Direction">
              <button type="button" data-dir="out" class="out ${dir === "out" ? "on" : ""}">− Money out</button>
              <button type="button" data-dir="in" class="in ${dir === "in" ? "on" : ""}">+ Money in</button>
            </div>
          </div>
          <input name="amount" type="text" inputmode="decimal" value="${it.amount ? nf.format(Math.abs(it.amount)).replace(/,/g, "") : ""}" placeholder="Amount in KES" aria-label="Amount in KES">
        </div>
        <div class="row2">
          <label class="field"><span>Date due</span><input name="value_date" type="date" value="${esc(it.value_date || "")}">
            <div class="hint">Past and blank dates count as due today.</div></label>
          <label class="field"><span>Repeats</span>
            <select name="preset">${PRESETS.map(([v, l]) => `<option value="${v}" ${String(it.every_days) === v ? "selected" : ""}>${l}</option>`).join("")}
              <option value="custom" ${PRESETS.some(([v]) => v === String(it.every_days)) ? "" : "selected"}>Every N days…</option></select></label>
        </div>
        <div class="row2">
          <label class="field ${PRESETS.some(([v]) => v === String(it.every_days)) ? "hidden" : ""}" id="every-wrap"><span>Every (days)</span><input name="every_days" type="number" min="0" max="366" value="${it.every_days}"></label>
          <label class="field ${it.every_days > 0 ? "" : "hidden"}" id="end-wrap"><span>Stop after</span><input name="end_date" type="date" value="${esc(it.end_date || "")}"><div class="hint">Optional end date.</div></label>
        </div>
        <div class="row2">
          <label class="field"><span>Account</span><select name="account_id"><option value="">—</option>
            ${state.data.accounts.map((a) => `<option value="${a.id}" ${a.id === it.account_id ? "selected" : ""}>${esc(a.name)}</option>`).join("")}</select></label>
          <label class="field"><span>Wait for income</span><select name="tie_to"><option value="">— Not tied</option>
            ${others.map((o) => `<option value="${o.id}" ${o.id === it.tie_to ? "selected" : ""}>${esc(o.name)}</option>`).join("")}</select>
            <div class="hint">Pay this only once the chosen income arrives.</div></label>
        </div>
        <label class="field"><span>Note</span><textarea name="note" maxlength="500" placeholder="Phone, paybill, account no…">${esc(it.note)}</textarea></label>
        <label class="check"><input type="checkbox" name="done" ${it.done ? "checked" : ""}> Already paid / received (stop counting it)</label>
        <div class="actions">
          <button class="btn primary" type="submit">${isNew ? "Add item" : "Save"}</button>
          <button class="btn" type="button" data-close>Cancel</button>
          <div class="spacer"></div>
          ${isNew ? "" : `<button class="btn danger" type="button" id="del-item">Delete</button>`}
        </div>
      </form>`);
    const f = $("#item-form");
    $$(".seg button", f).forEach((b) => b.addEventListener("click", () => {
      dir = b.dataset.dir;
      $$(".seg button", f).forEach((x) => x.classList.toggle("on", x === b));
    }));
    const syncRepeat = () => {
      const v = f.preset.value;
      $("#every-wrap", f).classList.toggle("hidden", v !== "custom");
      if (v !== "custom") f.every_days.value = v;
      $("#end-wrap", f).classList.toggle("hidden", Number(f.every_days.value) <= 0);
    };
    f.preset.addEventListener("change", syncRepeat);
    f.every_days.addEventListener("input", syncRepeat);
    f.addEventListener("submit", async (e) => {
      e.preventDefault();
      const raw = f.amount.value.replace(/[,\s]/g, "");
      if (raw && !/^\d*\.?\d+$/.test(raw)) return formError(f, "Enter the amount as a number, e.g. 2500.");
      const every = Number(f.every_days.value) || 0;
      const body = {
        name: f.name.value,
        amount: raw ? (dir === "out" ? -1 : 1) * Number(raw) : 0,
        value_date: f.value_date.value || null,
        every_days: every,
        end_date: every > 0 ? f.end_date.value || null : null,
        account_id: f.account_id.value ? Number(f.account_id.value) : null,
        tie_to: f.tie_to.value ? Number(f.tie_to.value) : null,
        note: f.note.value,
        done: f.done.checked,
      };
      try {
        const data = await api(isNew ? "POST" : "PUT", isNew ? `/api/budgets/${state.budgetId}/items` : `/api/items/${it.id}`, body);
        state.data = data;
        closeModal();
        renderMain();
        toast(isNew ? "Item added" : "Item saved");
      } catch (err) { if (err.status !== 402) formError(f, err.message); }
    });
    $("#del-item")?.addEventListener("click", () => confirmModal(`Delete “${it.name}”?`, "Delete", () => mutate("DELETE", `/api/items/${it.id}`, undefined, "Item deleted")));
  }

  function openAccount(acc) {
    const isNew = !acc;
    const a = acc || { name: "", details: "", balance: 0, include_in_total: true };
    openModal(`
      <h3>${isNew ? "Add account" : "Edit account"} <button class="close" data-close aria-label="Close">×</button></h3>
      <form id="acct-form" novalidate>
        <label class="field"><span>Account name</span><input name="name" type="text" value="${esc(a.name)}" placeholder="e.g. M-Pesa, Equity, KCB" required maxlength="60"></label>
        <label class="field"><span>Balance right now (KES)</span><input name="balance" type="text" inputmode="decimal" value="${a.balance}">
          <div class="hint">Use a minus sign for an overdraft or Fuliza, e.g. -1652.</div></label>
        <label class="field"><span>Details (optional)</span><input name="details" type="text" value="${esc(a.details)}" maxlength="200" placeholder="Account no., paybill…"></label>
        <label class="check"><input type="checkbox" name="include_in_total" ${a.include_in_total ? "checked" : ""}> Count this in my cash today</label>
        <p class="hint">Untick savings accounts — putting money into savings is a budget expense, not cash you can spend.</p>
        <div class="actions">
          <button class="btn primary" type="submit">${isNew ? "Add account" : "Save"}</button>
          <button class="btn" type="button" data-close>Cancel</button>
          <div class="spacer"></div>
          ${isNew ? "" : `<button class="btn danger" type="button" id="del-acct">Delete</button>`}
        </div>
      </form>`);
    const f = $("#acct-form");
    f.addEventListener("submit", async (e) => {
      e.preventDefault();
      const raw = f.balance.value.replace(/[,\s]/g, "");
      if (raw && !/^-?\d*\.?\d+$/.test(raw)) return formError(f, "Enter the balance as a number, e.g. 12500 or -1652.");
      const body = { name: f.name.value, balance: raw || 0, details: f.details.value, include_in_total: f.include_in_total.checked };
      try {
        state.data = await api(isNew ? "POST" : "PUT", isNew ? `/api/budgets/${state.budgetId}/accounts` : `/api/accounts/${a.id}`, body);
        closeModal();
        renderMain();
        toast("Account saved");
      } catch (err) { if (err.status !== 402) formError(f, err.message); }
    });
    $("#del-acct")?.addEventListener("click", () => confirmModal(`Delete account “${a.name}”? Items using it will be kept.`, "Delete", () => mutate("DELETE", `/api/accounts/${a.id}`, undefined, "Account deleted")));
  }

  // ------------------------------------------------------------------ billing
  let pollTimer;
  const planLabel = (k) => state.plans.find((p) => p.key === k)?.label || k;

  function openBilling(reason) {
    if (!state.me) return;
    const s = state.me.subscription;
    let plan = state.plans[0]?.key;
    const phone = state.me.phone ? "0" + state.me.phone.slice(3) : "";
    openModal(`
      <h3>Pay with M-Pesa <button class="close" data-close aria-label="Close">×</button></h3>
      <div id="bill-body">
        ${reason ? `<div class="alert warn">${esc(reason)}</div>` : ""}
        <p class="small muted">${s.active ? `You have access until ${fmtDate(s.access_until, { day: "numeric", month: "long", year: "numeric" })}. Paying now adds time on top.` : "Choose a plan to unlock editing again."}</p>
        <form id="bill-form" novalidate>
          <div class="plans" role="radiogroup">
            ${state.plans.map((p, i) => `<label class="plan ${i === 0 ? "on" : ""}"><input type="radio" name="plan" value="${p.key}" ${i === 0 ? "checked" : ""}>
              <div><b>${esc(p.label)}</b><div class="small muted">${p.days} days${p.key === "yearly" ? " · best value" : ""}</div></div>
              <div class="price num">KES ${nf.format(p.amount)}</div></label>`).join("")}
          </div>
          <label class="field"><span>M-Pesa number</span><input name="phone" type="tel" inputmode="tel" value="${esc(phone)}" placeholder="07XX XXX XXX" required></label>
          <button class="btn primary block" type="submit">Send M-Pesa prompt</button>
          <p class="hint">You'll get a prompt on your phone. Enter your M-Pesa PIN to pay.${state.mpesaEnv === "mock" ? " <b>(Test mode: no real money is charged.)</b>" : state.mpesaEnv === "sandbox" ? " <b>(Sandbox mode.)</b>" : ""}</p>
        </form>
      </div>`);
    const f = $("#bill-form");
    $$(".plan input", f).forEach((r) => r.addEventListener("change", () => {
      plan = r.value;
      $$(".plan", f).forEach((l) => l.classList.toggle("on", $("input", l).checked));
    }));
    f.addEventListener("submit", async (e) => {
      e.preventDefault();
      const btn = $("button[type=submit]", f);
      btn.disabled = true;
      try {
        const { payment, message } = await api("POST", "/api/billing/subscribe", { plan, phone: f.phone.value });
        waitForPayment(payment, message);
      } catch (err) { formError(f, err.message); btn.disabled = false; }
    });
  }

  function waitForPayment(payment, message) {
    const body = $("#bill-body");
    body.innerHTML = `<div class="mpesa-wait"><div class="spinner"></div>
      <p><b>${esc(message)}</b></p><p class="small muted">Sent to ${esc(payment.phone)} · KES ${nf.format(payment.amount)}</p>
      <p class="small muted" id="pay-status">Waiting for confirmation…</p></div>`;
    const started = Date.now();
    clearInterval(pollTimer);
    pollTimer = setInterval(async () => {
      try {
        const res = await api("GET", `/api/billing/payments/${payment.id}`);
        if (res.payment.status === "pending") {
          if (Date.now() - started > 150000) { clearInterval(pollTimer); $("#pay-status").textContent = "Still waiting. If you paid, it will apply automatically — check back shortly."; }
          return;
        }
        clearInterval(pollTimer);
        state.me = res.user;
        refreshBadge();
        if (res.payment.status === "success") {
          body.innerHTML = `<div class="mpesa-wait"><div class="alert ok">✓ Payment received${res.payment.receipt ? " · " + esc(res.payment.receipt) : ""}</div>
            <p>You're all set until <b>${fmtDate(res.user.subscription.access_until, { day: "numeric", month: "long", year: "numeric" })}</b>. Thank you!</p>
            <button class="btn primary block" data-close>Continue</button></div>`;
          renderMain();
        } else {
          body.innerHTML = `<div class="mpesa-wait"><div class="alert bad">Payment didn't go through.</div>
            <p class="small muted">${esc(res.payment.result_desc || "The request was cancelled or timed out.")}</p>
            <button class="btn primary block" id="retry-pay">Try again</button></div>`;
          $("#retry-pay").addEventListener("click", () => openBilling());
        }
      } catch { /* transient — keep polling */ }
    }, 3000);
  }

  app.addEventListener("click", (e) => { if (state.data) onAction(e); });
  boot();
})();
