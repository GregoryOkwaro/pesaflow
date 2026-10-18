/**
 * Every prepaid payment rail (M-Pesa via Daraja; MTN MoMo, Airtel Money and other
 * mobile money via Flutterwave) implements this interface, so billing logic never
 * changes when a new country or provider is added.
 */
export interface StartPaymentInput {
  phone: string; // 2547XXXXXXXX (empty for hosted checkouts, which ask for it)
  amount: number; // major units of `currency` (whole KES for M-Pesa)
  reference: string; // shown to the customer (Daraja: max 12 chars); our tx_ref for Flutterwave
  description: string;
  // Hosted checkouts (Flutterwave) also need these.
  currency?: string;
  country?: string;
  email?: string;
  name?: string;
  returnUrl?: string;
  paymentOptions?: string; // which methods the hosted page offers, e.g. "mobilemoneyuganda"
}

export interface StartPaymentResult {
  providerRef: string; // id we match the callback / status query on
  merchantRef?: string;
  customerMessage: string;
  redirectUrl?: string; // hosted checkout page to send the customer to
}

export type PaymentState = "pending" | "success" | "failed";

export interface StatusResult {
  state: PaymentState;
  code: string;
  description: string;
  receipt?: string;
  amount?: number; // major units actually paid, when the provider reports it
  currency?: string;
}

export interface CallbackResult {
  providerRef: string;
  success: boolean;
  code: string;
  description: string;
  amount?: number;
  currency?: string;
  receipt?: string;
  phone?: string;
}

export interface PaymentProvider {
  readonly name: string;
  startPayment(input: StartPaymentInput): Promise<StartPaymentResult>;
  queryStatus(providerRef: string): Promise<StatusResult>;
  parseCallback(payload: unknown): CallbackResult | null;
}

export class PaymentError extends Error {}
