/** 07XXXXXXXX / 01XXXXXXXX / +2547XXXXXXXX / 7XXXXXXXX -> 2547XXXXXXXX (Safaricom/Airtel KE mobile), else null. */
export function normalizeKenyanPhone(raw: string | null | undefined): string | null {
  let d = (raw ?? "").replace(/\D/g, "");
  if (d.startsWith("0") && d.length === 10) d = "254" + d.slice(1);
  else if (d.length === 9 && /^[17]/.test(d)) d = "254" + d;
  return /^254[17]\d{8}$/.test(d) ? d : null;
}

/** 254712345678 -> 0712 345 678 for display. */
export function displayPhone(p: string | null | undefined): string {
  if (!p) return "";
  const local = "0" + p.slice(3);
  return `${local.slice(0, 4)} ${local.slice(4, 7)} ${local.slice(7)}`;
}
