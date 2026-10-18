/**
 * ISO 3166-1 alpha-2 countries with their main ISO 4217 currency. Display names
 * come from Intl.DisplayNames in the user's language, so nothing to translate here.
 *
 * Deliberately excluded: uninhabited territories, and countries under broad
 * sanctions that our payment providers (Paddle, Safaricom) cannot serve
 * (Iran, North Korea, Cuba, Syria, Russia). Review with counsel before changing.
 */
const DATA =
  "AD:EUR AE:AED AF:AFN AG:XCD AI:XCD AL:ALL AM:AMD AO:AOA AR:ARS AS:USD AT:EUR AU:AUD AW:AWG AX:EUR AZ:AZN " +
  "BA:BAM BB:BBD BD:BDT BE:EUR BF:XOF BG:BGN BH:BHD BI:BIF BJ:XOF BL:EUR BM:BMD BN:BND BO:BOB BQ:USD BR:BRL " +
  "BS:BSD BT:BTN BW:BWP BY:BYN BZ:BZD CA:CAD CC:AUD CD:CDF CF:XAF CG:XAF CH:CHF CI:XOF CK:NZD CL:CLP CM:XAF " +
  "CN:CNY CO:COP CR:CRC CV:CVE CW:ANG CX:AUD CY:EUR CZ:CZK DE:EUR DJ:DJF DK:DKK DM:XCD DO:DOP DZ:DZD EC:USD " +
  "EE:EUR EG:EGP EH:MAD ER:ERN ES:EUR ET:ETB FI:EUR FJ:FJD FK:FKP FM:USD FO:DKK FR:EUR GA:XAF GB:GBP GD:XCD " +
  "GE:GEL GF:EUR GG:GBP GH:GHS GI:GIP GL:DKK GM:GMD GN:GNF GP:EUR GQ:XAF GR:EUR GT:GTQ GU:USD GW:XOF GY:GYD " +
  "HK:HKD HN:HNL HR:EUR HT:HTG HU:HUF ID:IDR IE:EUR IL:ILS IM:GBP IN:INR IO:USD IQ:IQD IS:ISK IT:EUR JE:GBP " +
  "JM:JMD JO:JOD JP:JPY KE:KES KG:KGS KH:KHR KI:AUD KM:KMF KN:XCD KR:KRW KW:KWD KY:KYD KZ:KZT LA:LAK LB:LBP " +
  "LC:XCD LI:CHF LK:LKR LR:LRD LS:LSL LT:EUR LU:EUR LV:EUR LY:LYD MA:MAD MC:EUR MD:MDL ME:EUR MF:EUR MG:MGA " +
  "MH:USD MK:MKD ML:XOF MM:MMK MN:MNT MO:MOP MP:USD MQ:EUR MR:MRU MS:XCD MT:EUR MU:MUR MV:MVR MW:MWK MX:MXN " +
  "MY:MYR MZ:MZN NA:NAD NC:XPF NE:XOF NF:AUD NG:NGN NI:NIO NL:EUR NO:NOK NP:NPR NR:AUD NU:NZD NZ:NZD OM:OMR " +
  "PA:PAB PE:PEN PF:XPF PG:PGK PH:PHP PK:PKR PL:PLN PM:EUR PN:NZD PR:USD PS:ILS PT:EUR PW:USD PY:PYG QA:QAR " +
  "RE:EUR RO:RON RS:RSD RW:RWF SA:SAR SB:SBD SC:SCR SD:SDG SE:SEK SG:SGD SH:SHP SI:EUR SK:EUR SL:SLE SM:EUR " +
  "SN:XOF SO:SOS SR:SRD SS:SSP ST:STN SV:USD SX:ANG SZ:SZL TC:USD TD:XAF TG:XOF TH:THB TJ:TJS TK:NZD TL:USD " +
  "TM:TMT TN:TND TO:TOP TR:TRY TT:TTD TV:AUD TW:TWD TZ:TZS UA:UAH UG:UGX US:USD UY:UYU UZ:UZS VA:EUR VC:XCD " +
  "VE:VES VG:USD VI:USD VN:VND VU:VUV WF:XPF WS:WST XK:EUR YE:YER YT:EUR ZA:ZAR ZM:ZMW ZW:USD";

export const COUNTRY_CURRENCY: Record<string, string> = Object.fromEntries(DATA.split(" ").map((p) => p.split(":") as [string, string]));
export const COUNTRY_CODES = Object.keys(COUNTRY_CURRENCY);

export const isCountry = (c: unknown): c is string => typeof c === "string" && c in COUNTRY_CURRENCY;
export const currencyForCountry = (c: string): string => COUNTRY_CURRENCY[c] ?? "USD";

/** Countries sorted by their name in `locale`. */
export function countryOptions(locale: string): { code: string; name: string }[] {
  let names: Intl.DisplayNames | null = null;
  try {
    names = new Intl.DisplayNames([locale, "en"], { type: "region" });
  } catch { /* very old runtimes */ }
  return COUNTRY_CODES.map((code) => ({ code, name: names?.of(code) ?? code }))
    .sort((a, b) => a.name.localeCompare(b.name, locale));
}

/** Currencies to offer: every country's currency, de-duplicated, sorted by code. */
export const CURRENCY_CODES = [...new Set(Object.values(COUNTRY_CURRENCY))].sort();

export function currencyName(code: string, locale: string): string {
  try {
    return new Intl.DisplayNames([locale, "en"], { type: "currency" }).of(code) ?? code;
  } catch {
    return code;
  }
}
